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
      return;
  }
}

export function startSync(): void {
  void refresh();
  const proto = location.protocol === "https:" ? "wss" : "ws";
  window.setTimeout(() => {
    const ws = new WebSocket(`${proto}://${location.host}/api/ws`);
    ws.onmessage = (msg) => {
      try {
        applyWsEvent(JSON.parse(String(msg.data)) as WsEvent);
      } catch {
        void refresh();
      }
    };
  }, 100);
  window.setInterval(() => void refresh(), 30_000);
}

export function probeWebmcp(): void {
  const ready = Boolean(
    document.modelContext &&
      typeof document.modelContext.registerTool === "function",
  );
  store.getState().setWebmcpReady(ready);
}
