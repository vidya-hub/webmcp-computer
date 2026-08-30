import { useEffect, useRef } from "react";
import { useStore, store } from "../../store/index.ts";
import { ActionTimeline } from "../ActionTimeline.tsx";
import { RecipesPanel } from "./RecipesPanel.tsx";

const H_KEY = "webmcp.insp-h";
const MIN_H = 220;

function readH(): number {
  try {
    const n = Number(localStorage.getItem(H_KEY));
    if (Number.isFinite(n) && n >= MIN_H) return n;
  } catch {
    /* ignore */
  }
  return Math.round(window.innerHeight * 0.38);
}

function clampH(h: number): number {
  const max = Math.round(window.innerHeight * 0.6);
  return Math.min(max, Math.max(MIN_H, Math.round(h)));
}

export function Inspector() {
  const tab = useStore((s) => s.inspectorTab);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (el) el.style.height = `${clampH(readH())}px`;
  }, []);

  function onResize(e: React.PointerEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = root.current?.getBoundingClientRect().height ?? readH();
    const move = (ev: PointerEvent) => {
      const next = clampH(startH + (startY - ev.clientY));
      if (root.current) root.current.style.height = `${next}px`;
    };
    const up = (ev: PointerEvent) => {
      const next = clampH(startH + (startY - ev.clientY));
      try {
        localStorage.setItem(H_KEY, String(next));
      } catch {
        /* ignore */
      }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <aside className="insp" ref={root} aria-label="inspector">
      <div
        className="insp-handle"
        onPointerDown={onResize}
        role="separator"
        aria-orientation="horizontal"
        aria-label="resize inspector"
      />
      <div className="insp-bar">
        <button
          type="button"
          className={`insp-tab${tab === "tape" ? " on" : ""}`}
          onClick={() => store.getState().setInspectorTab("tape")}
        >
          Tape
        </button>
        <button
          type="button"
          className={`insp-tab${tab === "recipes" ? " on" : ""}`}
          onClick={() => store.getState().setInspectorTab("recipes")}
        >
          Recipes
        </button>
        <button
          type="button"
          className="tl-close"
          aria-label="close inspector"
          onClick={() => store.getState().closeInspector()}
        >
          Close
        </button>
      </div>
      <div className="insp-pane" hidden={tab !== "tape"}>
        <ActionTimeline active={tab === "tape"} />
      </div>
      <div className="insp-pane" hidden={tab !== "recipes"}>
        <RecipesPanel active={tab === "recipes"} />
      </div>
    </aside>
  );
}
