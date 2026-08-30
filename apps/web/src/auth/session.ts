// Front-end session lifecycle. Talks to apps/auth (/auth/*), mirrors the
// authenticated email into the store (memory only), and starts/stops live sync
// so a logged-out page opens no WebSocket, registers no tools, and shows no
// desktop iframe.

import { setOnUnauthorized } from "../api/client.ts";
import { store } from "../store/index.ts";
import { setOnSocketDropped, startSync, stopSync } from "../store/sync.ts";

async function post(path: string, body?: unknown): Promise<Response> {
  return fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
}

/** GET /auth/me, with one /auth/refresh retry on 401. Null if unauthenticated. */
export async function fetchMe(): Promise<{ email: string } | null> {
  const me = async () => {
    const res = await fetch("/auth/me", {
      credentials: "include",
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? ((await res.json()) as { email: string }) : res.status;
  };
  try {
    const first = await me();
    if (typeof first !== "number") return first;
    if (first === 401 && (await post("/auth/refresh")).ok) {
      const second = await me();
      if (typeof second !== "number") return second;
    }
  } catch {
    /* offline */
  }
  return null;
}

export async function fetchConfig(): Promise<{ publicLogin: boolean }> {
  try {
    const res = await fetch("/auth/config", { signal: AbortSignal.timeout(10_000) });
    if (res.ok) return (await res.json()) as { publicLogin: boolean };
  } catch {
    /* default open */
  }
  return { publicLogin: true };
}

export async function login(
  email: string,
  password: string,
): Promise<{ email: string }> {
  const res = await post("/auth/login", { email, password });
  if (!res.ok) {
    let msg = "invalid email or password";
    try {
      const b = (await res.json()) as { error?: string };
      if (b?.error) msg = b.error;
    } catch {
      /* keep default */
    }
    throw new Error(msg);
  }
  const me = (await res.json()) as { email: string };
  applySession(me);
  return me;
}

export async function logout(): Promise<void> {
  try {
    await post("/auth/logout");
  } catch {
    /* best-effort */
  }
  clearSession();
}

export function applySession(session: { email: string }): void {
  store.getState().setSession(session);
  startSync();
}

export function clearSession(): void {
  stopSync();
  store.getState().setSession(null);
}

// A mid-session request that stays 401 after a refresh drops us to login.
setOnUnauthorized(() => clearSession());

// The event socket dropped: if we still think we're logged in, verify once
// (fetchMe includes a refresh retry). Gone → login; transient → reconnect.
let checkingDrop = false;
setOnSocketDropped(() => {
  if (checkingDrop || !store.getState().session) return;
  checkingDrop = true;
  void fetchMe()
    .then((me) => {
      if (!me) clearSession();
    })
    .finally(() => {
      checkingDrop = false;
    });
});
