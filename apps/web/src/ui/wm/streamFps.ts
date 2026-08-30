import { store } from "../../store/index.ts";

export function fpsTone(n: number): "ok" | "mid" | "low" {
  if (n >= 20) return "ok";
  if (n >= 10) return "mid";
  return "low";
}

let started = false;
const seen = new Map<string, number>();

export function listenStreamFps(): void {
  if (started) return;
  started = true;
  window.addEventListener("message", (e: MessageEvent) => {
    if (e.origin !== location.origin) return;
    const d = e.data as {
      source?: string;
      type?: string;
      id?: string;
      fps?: unknown;
    };
    if (!d || d.source !== "webmcp" || d.type !== "fps") return;
    const id = typeof d.id === "string" ? d.id : "";
    const fps =
      typeof d.fps === "number" && Number.isFinite(d.fps) ? Math.round(d.fps) : null;
    if (!id || fps == null || fps < 0) return;
    const iframe = document.querySelector<HTMLIFrameElement>(
      `iframe[title="${CSS.escape(id)}"]`,
    );
    if (!iframe || e.source !== iframe.contentWindow) return;
    seen.set(id, Date.now());
    store.getState().setStreamFps(id, fps);
  });
  window.setInterval(() => {
    const now = Date.now();
    const live = new Set(store.getState().computers.map((c) => c.id));
    for (const [id, at] of seen) {
      if (!live.has(id) || now - at > 2500) {
        seen.delete(id);
        store.getState().setStreamFps(id, null);
      }
    }
    for (const id of Object.keys(store.getState().streamFps)) {
      if (!live.has(id)) store.getState().setStreamFps(id, null);
    }
  }, 1000);
}
