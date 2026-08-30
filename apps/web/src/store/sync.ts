import type { Computer, WsEvent } from "@webmcp-computer/contract";
import { store } from "./index.ts";
import { fetchSnapshot } from "./snapshot.ts";

export async function refresh(): Promise<void> {
  await fetchSnapshot(store.getState);
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

export function startSync(): void {
  void refresh();
  const proto = location.protocol === "https:" ? "wss" : "ws";

  // Self-rescheduling connect: a dropped socket must not leave the UI stuck on
  // 30s polling forever. Reconnect with capped exponential backoff + jitter.
  function connect(attempt = 0): void {
    let live = attempt;
    const ws = new WebSocket(`${proto}://${location.host}/api/ws`);
    ws.onopen = () => {
      live = 0;
      // Resync anything missed while the socket was down.
      void refresh();
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
      const delay = Math.min(30_000, 1000 * 2 ** live) + Math.random() * 500;
      window.setTimeout(() => connect(live + 1), delay);
    };
  }
  window.setTimeout(() => connect(0), 100);

  // Belt-and-braces poll in case the socket is silently half-open.
  window.setInterval(() => void refresh(), 30_000);
}

export function probeWebmcp(): void {
  const ready = Boolean(
    document.modelContext &&
      typeof document.modelContext.registerTool === "function",
  );
  store.getState().setWebmcpReady(ready);
}
