import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { WEBMCP_TOOLS, type HomeArchive } from "@webmcp-computer/contract";
import { api } from "../../api/client.ts";
import { store, useStore } from "../../store/index.ts";
import { snapRect } from "../../store/slices/wm.ts";
import { WindowFrame } from "./Window.tsx";

export function Canvas() {
  const computers = useStore((s) => s.computers);
  const snap = useStore((s) => s.snap);
  const draggingId = useStore((s) => s.draggingId);
  const canvas = useStore(useShallow((s) => s.canvas));
  const selectedComputer = useStore((s) => s.selectedComputer);
  const actingComputerId = useStore((s) => s.actingComputerId);
  const spawnComputer = useStore((s) => s.spawnComputer);
  const ref = useRef<HTMLDivElement>(null);
  const [archives, setArchives] = useState<HomeArchive[]>([]);
  useEffect(() => {
    void api<{ archives: HomeArchive[] }>("/api/archives")
      .then((d) => setArchives(d.archives ?? []))
      .catch(() => setArchives([]));
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pushSize = () => {
      store.getState().setCanvasSize(el.clientWidth, el.clientHeight);
    };
    pushSize();
    const ro = new ResizeObserver(pushSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    store.getState().reconcile(computers);
  }, [computers]);

  useEffect(() => {
    const id = actingComputerId ?? selectedComputer;
    if (id) store.getState().focus(id);
  }, [actingComputerId, selectedComputer]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const s = store.getState();
      if (e.key === "`") {
        e.preventDefault();
        s.toggleOverview();
      } else if (e.key === "Escape" && s.overview) {
        e.preventDefault();
        s.toggleOverview(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onDragMove = useCallback((x: number, y: number, kind: string) => {
    if (kind !== "move" || !ref.current) {
      store.getState().setSnap(null);
      return;
    }
    const r = ref.current.getBoundingClientRect();
    const edge = 16;
    const { setSnap } = store.getState();
    if (y - r.top < edge) setSnap("top");
    else if (x - r.left < edge) setSnap("left");
    else if (r.right - x < edge) setSnap("right");
    else setSnap(null);
  }, []);

  return (
    <div className="wm-stage">
      <div className="wm-canvas" ref={ref}>
        <div className="wm-wallpaper" aria-hidden />
        {computers.length === 0 ? (
          <div className="desk-blank">
            <div className="desk-onboard">
              <div className="desk-onboard-mark" />
              <h1>WebMCP Computer</h1>
              <p>
                Tools are already registered. Spawn a computer to drive one.
              </p>
              <button
                type="button"
                className="desk-new"
                onClick={() => void spawnComputer()}
              >
                New Computer
              </button>
              {archives.length > 0 ? (
                <button
                  type="button"
                  className="desk-new ghost"
                  onClick={() => {
                    const first = archives[0];
                    if (first) void spawnComputer(first.id);
                  }}
                >
                  Restore files…
                </button>
              ) : null}
              <span className="desk-onboard-hint">
                Dock = fleet · Timeline = tape · Recipes = teach. {WEBMCP_TOOLS.length} tools are live.
              </span>
            </div>
          </div>
        ) : null}
        {snap && draggingId ? (
          <div className="snap-ghost" style={snapRect(snap, canvas)} aria-hidden />
        ) : null}
        {computers.map((c, i) => (
          <WindowFrame
            key={c.id}
            computer={c}
            index={i}
            canvasRef={ref}
            onMove={onDragMove}
          />
        ))}
      </div>
    </div>
  );
}
