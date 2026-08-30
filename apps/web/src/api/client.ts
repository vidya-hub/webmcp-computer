// Registered by the auth layer: called when a request is still 401 after a
// refresh attempt, i.e. the session is truly gone → return to login.
let onUnauthorized: (() => void) | null = null;
export function setOnUnauthorized(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch("/auth/refresh", {
      method: "POST",
      credentials: "include",
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function doFetch(
  path: string,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  return fetch(path, {
    ...init,
    // Send the session cookie on every control-plane call (same-origin in
    // prod; the Vite dev proxy also forwards it).
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
  });
}

export async function api<T>(
  path: string,
  init?: RequestInit,
  timeoutMs = 30_000,
): Promise<T> {
  let res: Response;
  try {
    res = await doFetch(path, init, timeoutMs);
    // Session expired mid-use: refresh once, retry once, else fall to login.
    if (res.status === 401 && !path.startsWith("/auth/")) {
      if (await tryRefresh()) {
        res = await doFetch(path, init, timeoutMs);
      }
      if (res.status === 401) onUnauthorized?.();
    }
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error(
        "request timed out — the workspace may be busy or offline",
      );
    }
    throw err;
  }
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: text };
  }
  if (!res.ok) {
    const err =
      typeof body === "object" && body && "error" in body
        ? String((body as { error: unknown }).error)
        : res.statusText;
    throw new Error(err);
  }
  return body as T;
}

export function toolResult(
  data: unknown,
  image?: { mimeType: string; data: string },
) {
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image"; mimeType: string; data: string }
  > = [{ type: "text", text: JSON.stringify(data, null, 2) }];
  if (image) {
    content.unshift({
      type: "image",
      mimeType: image.mimeType,
      data: image.data,
    });
  }
  return { content };
}
