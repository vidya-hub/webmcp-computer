import type { Computer, TapeEvent, WsEvent } from "@webmcp-computer/contract";
import { api } from "../api/client.ts";
import { store } from "./index.ts";
import { fetchSnapshot } from "./snapshot.ts";

async function hydrateTape(): Promise<void> {
  try {
    const d = await api<{ events: TapeEvent[] }>("/api/tape");
    store.getState().hydrateTape(d.events ?? []);
  } catch {
    /* offline — keep whatever is already in the store */
  }
}

export async function refresh(): Promise<void> {
  await Promise.all([fetchSnapshot(store.getState), hydrateTape()]);
}

export function applyWsEvent(event: WsEvent): void {
  const s = store.getState();
  switch (event.type) {
    case "activity":
      s.prependActivity(event.event);
      if (event.event.verb === "destroyed" && event.event.computerId) {
        s.removeComputer(event.event.computerId);
      }
      return;
    case "approval":
      s.setPendingApproval(event.approval);
      return;
    case "selection":
      s.setSelectedComputer(event.computerId);
      return;
    case "computer":
      s.upsertComputer(event.computer as Computer);
      return;
    case "tape":
      s.prependTape(event.event);
      return;
    case "recording":
      s.setRecordingComputerId(event.computerId);
      return;
  }
}

// Live sync is started only once the user has a session and torn down on
// logout / session loss, so a logged-out page opens no socket and no poll.
let running = false;
let socket: WebSocket | null = null;
let pollTimer: number | null = null;
const connectTimers = new Set<number>();

// Called when the event socket drops, so the session layer can check whether
// the session is gone (→ login) vs a transient network blip (→ reconnect).
let onSocketDropped: (() => void) | null = null;
export function setOnSocketDropped(fn: (() => void) | null): void {
  onSocketDropped = fn;
}

export function startSync(): void {
  if (running) return;
  running = true;
  void refresh();
  const proto = location.protocol === "https:" ? "wss" : "ws";

  // Self-rescheduling connect: a dropped socket must not leave the UI stuck on
  // 30s polling forever. Reconnect with capped exponential backoff + jitter.
  function connect(attempt = 0): void {
    if (!running) return;
    let live = attempt;
    const ws = new WebSocket(`${proto}://${location.host}/api/ws`);
    socket = ws;
    ws.onopen = () => {
      live = 0;
      void refresh(); // resync anything missed while the socket was down
    };
    ws.onmessage = (msg) => {
      try {
        applyWsEvent(JSON.parse(String(msg.data)) as WsEvent);
      } catch {
        void refresh();
      }
    };
    ws.onerror = () => ws.close();
    ws.onclose = () => {
      if (!running) return;
      // A drop may mean the session expired; let the auth layer verify once.
      onSocketDropped?.();
      const delay = Math.min(30_000, 1000 * 2 ** live) + Math.random() * 500;
      const t = window.setTimeout(() => {
        connectTimers.delete(t);
        connect(live + 1);
      }, delay);
      connectTimers.add(t);
    };
  }
  const first = window.setTimeout(() => {
    connectTimers.delete(first);
    connect(0);
  }, 100);
  connectTimers.add(first);

  // Belt-and-braces poll in case the socket is silently half-open.
  pollTimer = window.setInterval(() => void refresh(), 30_000);
}

export function stopSync(): void {
  running = false;
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
  for (const t of connectTimers) window.clearTimeout(t);
  connectTimers.clear();
  if (socket) {
    socket.onclose = null;
    try {
      socket.close();
    } catch {
      /* already closed */
    }
    socket = null;
  }
}

export function probeWebmcp(): void {
  const ready = Boolean(
    document.modelContext &&
      typeof document.modelContext.registerTool === "function",
  );
  store.getState().setWebmcpReady(ready);
}
