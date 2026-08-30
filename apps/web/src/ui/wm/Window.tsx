import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import type { Computer, ComputerId } from "@webmcp-computer/contract";
import { useShallow } from "zustand/react/shallow";
import { store, useStore } from "../../store/index.ts";
import { overviewTarget } from "../../store/slices/wm.ts";
import type { Bounds, Rect } from "../../store/types.ts";
import { windowSlice } from "../../store/selectors.ts";
import { play } from "../sound.ts";
import { getDockTileRect } from "./dockTiles.ts";
import { ComputerBoot } from "./ComputerBoot.tsx";
import { flipFrom, flyTo } from "./motion.ts";
import { startRecording, stopRecording } from "./recording.ts";
import { RecordStopDialog } from "./RecordStopDialog.tsx";

type Kind = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

type Props = {
  computer: Computer;
  index: number;
  canvasRef: RefObject<HTMLDivElement | null>;
  onMove: (x: number, y: number, kind: Kind) => void;
};

export function WindowFrame({ computer, index, canvasRef, onMove }: Props) {
  const id = computer.id;
  const wm = useStore(useShallow(windowSlice(id)));
  const [showStop, setShowStop] = useState(false);
  const [resizing, setResizing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const target = useStore(
    useShallow((s): Rect | null => {
      if (!s.overview) return null;
      const visible = s.computers.filter(
        (c) =>
          s.windows[c.id] &&
          !s.minimized.includes(c.id) &&
          s.lifecycle[c.id] !== "closing",
      );
      const vi = visible.findIndex((v) => v.id === id);
      if (vi < 0) return null;
      return overviewTarget(vi, visible.length, s.canvas);
    }),
  );

  const start = useRef({ x: 0, y: 0, bx: 0, by: 0, bw: 0, bh: 0 });
  const cleanup = useRef<(() => void) | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const frozen = useRef<{ w: number; h: number } | null>(null);
  const flying = useRef(false);

  useLayoutEffect(() => {
    if (wm.lifecycle !== "restoring") return;
    const el = rootRef.current;
    if (!el) {
      store.getState().clearPhase(id);
      return;
    }
    flipFrom(el, getDockTileRect(id), () => store.getState().clearPhase(id));
  }, [wm.lifecycle, id]);

  useEffect(() => {
    if (wm.dragActive && bodyRef.current && !frozen.current) {
      frozen.current = {
        w: bodyRef.current.clientWidth,
        h: bodyRef.current.clientHeight,
      };
    }
    if (!wm.dragActive) frozen.current = null;
  }, [wm.dragActive]);

  useEffect(() => {
    if (!wm.lifecycle) return;
    const phase = wm.lifecycle;
    const t = window.setTimeout(() => {
      const s = store.getState();
      if (s.lifecycle[id] !== phase) return;
      if (phase === "minimizing") s.finishMinimize(id);
      else s.clearPhase(id);
    }, 800);
    return () => window.clearTimeout(t);
  }, [wm.lifecycle, id]);

  const overview = Boolean(target);
  const wantAttach =
    (computer.status === "starting" || computer.status === "running") &&
    wm.lifecycle !== "minimizing" &&
    wm.lifecycle !== "closing" &&
    !wm.minimized &&
    (computer.status === "starting" ||
      wm.recording ||
      overview ||
      wm.selected ||
      wm.acting);
  const [attached, setAttached] = useState(wantAttach);
  useEffect(() => {
    if (wantAttach) {
      setAttached(true);
      return;
    }
    const t = window.setTimeout(() => setAttached(false), 400);
    return () => window.clearTimeout(t);
  }, [wantAttach]);

  function onFocus() {
    const s = store.getState();
    s.focus(id);
    if (s.overview) s.toggleOverview(false);
    if (id !== s.selectedComputer) void s.selectComputer(id as ComputerId);
  }

  function restoreForDrag(clientX: number, clientY: number): Bounds | null {
    const origin = canvasRef.current?.getBoundingClientRect();
    return store.getState().restoreForDrag(id, clientX, clientY, {
      left: origin?.left ?? 0,
      top: origin?.top ?? 0,
    });
  }

  function pointerDrag(e: ReactPointerEvent, kind: Kind) {
    if (target) return;
    if (wm.maximized && kind !== "move") return;
    e.preventDefault();
    e.stopPropagation();
    onFocus();
    store.getState().setDragging(id);
    if (kind !== "move") setResizing(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    const bounds = store.getState().windows[id];
    if (!bounds) return;
    start.current = {
      x: e.clientX,
      y: e.clientY,
      bx: bounds.x,
      by: bounds.y,
      bw: bounds.w,
      bh: bounds.h,
    };
    let draggingMax = wm.maximized && kind === "move";
    let raf = 0;
    let pending: { x: number; y: number; w: number; h: number; cx: number; cy: number } | null =
      null;
    const flush = () => {
      raf = 0;
      if (!pending) return;
      const p = pending;
      pending = null;
      onMove(p.cx, p.cy, kind);
      store.getState().patchBounds(id, { x: p.x, y: p.y, w: p.w, h: p.h });
    };
    const move = (ev: PointerEvent) => {
      if (draggingMax) {
        const restored = restoreForDrag(ev.clientX, ev.clientY);
        draggingMax = false;
        if (restored) {
          start.current = {
            x: ev.clientX,
            y: ev.clientY,
            bx: restored.x,
            by: restored.y,
            bw: restored.w,
            bh: restored.h,
          };
        }
        onMove(ev.clientX, ev.clientY, kind);
        return;
      }
      const dx = ev.clientX - start.current.x;
      const dy = ev.clientY - start.current.y;
      const s = start.current;
      let x = s.bx;
      let y = s.by;
      let w = s.bw;
      let h = s.bh;
      if (kind === "move") {
        x = s.bx + dx;
        y = s.by + dy;
      }
      if (kind === "e" || kind === "ne" || kind === "se") w = Math.max(320, s.bw + dx);
      if (kind === "s" || kind === "se" || kind === "sw") h = Math.max(240, s.bh + dy);
      if (kind === "w" || kind === "nw" || kind === "sw") {
        w = Math.max(320, s.bw - dx);
        x = s.bx + s.bw - w;
      }
      if (kind === "n" || kind === "ne" || kind === "nw") {
        h = Math.max(240, s.bh - dy);
        y = s.by + s.bh - h;
      }
      pending = { x, y, w, h, cx: ev.clientX, cy: ev.clientY };
      if (!raf) raf = requestAnimationFrame(flush);
    };
    const up = () => {
      if (raf) {
        cancelAnimationFrame(raf);
        flush();
      }
      const s = store.getState();
      if (s.snap) {
        s.applySnap(id, s.snap);
        play("snap");
      }
      s.setSnap(null);
      s.evenBounds(id);
      s.setDragging(null);
      setResizing(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      cleanup.current = null;
    };
    cleanup.current?.();
    cleanup.current = up;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function minimize() {
    const el = rootRef.current;
    store.getState().startMinimize(id);
    if (!el || flying.current) {
      store.getState().finishMinimize(id);
      return;
    }
    flying.current = true;
    flyTo(el, getDockTileRect(id), () => {
      flying.current = false;
      store.getState().finishMinimize(id);
    });
  }

  if (!wm.bounds || wm.minimized) return null;

  const running = computer.status === "running";
  const cls = `wm-window${wm.selected || wm.acting ? " selected" : ""}${wm.acting ? " acting" : ""}${wm.recording ? " recording" : ""}${wm.maximized ? " maximized" : ""}${wm.lifecycle ? ` ${wm.lifecycle}` : ""}${target ? " overviewing" : ""}${wm.dragActive ? " dragging" : ""}${resizing ? " resizing" : ""}`;
  const ice = frozen.current;

  const style: CSSProperties & Record<string, string | number> = {
    left: wm.bounds.x,
    top: wm.bounds.y,
    width: wm.bounds.w,
    height: wm.bounds.h,
    zIndex: wm.bounds.z,
    "--i": index,
  };
  if (target) {
    const scale = Math.min(target.w / wm.bounds.w, target.h / wm.bounds.h);
    const dx = target.x - wm.bounds.x + (target.w - wm.bounds.w * scale) / 2;
    const dy = target.y - wm.bounds.y + (target.h - wm.bounds.h * scale) / 2;
    style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
    style.transformOrigin = "top left";
  }

  return (
    <div
      ref={rootRef}
      className={cls}
      style={style}
      onPointerDown={() => onFocus()}
      onAnimationEnd={(e) => {
        if (e.target !== e.currentTarget) return;
        const s = store.getState();
        const phase = s.lifecycle[id];
        if (phase === "minimizing") s.finishMinimize(id);
        else if (phase && phase !== "restoring") s.clearPhase(id);
      }}
    >
      <div className="wm-chrome">
        <div
          className="wm-title"
          onPointerDown={(e) => pointerDrag(e, "move")}
          onDoubleClick={(e) => {
            e.preventDefault();
            store.getState().maximize(id);
            play("snap");
          }}
        >
          <span className="wm-lights">
            <button
              type="button"
              className="wm-light close"
              aria-label="close"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                store.getState().close(id);
              }}
            />
            <button
              type="button"
              className="wm-light min"
              aria-label="minimize"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                minimize();
              }}
            />
            <button
              type="button"
              className="wm-light max"
              aria-label={wm.maximized ? "restore" : "maximize"}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                store.getState().maximize(id);
                play("snap");
              }}
            />
          </span>
          <span className="wm-title-id">
            {computer.name} · {computer.role} · {computer.os}
          </span>
          <span className="wm-title-right">
            {running ? (
              <button
                type="button"
                className={`wm-rec${wm.recording ? " on" : ""}`}
                aria-label={wm.recording ? "stop recording" : "record actions"}
                title={wm.recording ? "Stop recording" : "Record actions on this computer"}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  if (wm.recording) setShowStop(true);
                  else void startRecording(id);
                }}
              >
                <span className="wm-rec-dot" />
                {wm.recording ? "REC" : ""}
              </button>
            ) : null}
            <button
              type="button"
              className="wm-tl"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                void store.getState().selectComputer(id as ComputerId);
                store.getState().openInspector("tape", {
                  filter: id,
                  focusNewest: true,
                });
              }}
            >
              Timeline
            </button>
            {wm.acting && wm.actingVerb ? (
              <span className="wm-acting">AGENT · {wm.actingVerb}</span>
            ) : computer.status === "starting" ? (
              <span className="wm-acting">starting</span>
            ) : running ? null : (
              <span className="wm-acting">{computer.status}</span>
            )}
          </span>
        </div>
        {showStop ? (
          <RecordStopDialog
            onCancel={() => setShowStop(false)}
            onSave={async (name, description) => {
              setShowStop(false);
              await stopRecording(name, description);
            }}
          />
        ) : null}
        <div className="wm-body" ref={bodyRef}>
          <ComputerBoot computer={computer} />
          {(!wm.selected && !wm.dragActive) || target ? (
            <button
              type="button"
              className="wm-hit"
              aria-label={`focus ${computer.name}`}
            />
          ) : null}
          {wm.dragActive ? <div className="wm-hit" /> : null}
          <iframe
            title={computer.id}
            allow="unload; tools; autoplay; clipboard-read; clipboard-write"
            style={ice ? { width: ice.w, height: ice.h } : undefined}
            src={
              attached
                ? `/desktops/${encodeURIComponent(computer.id)}/`
                : "about:blank"
            }
          />
        </div>
      </div>
      {wm.maximized || target ? null : (
        <>
          <div className="wm-n" onPointerDown={(e) => pointerDrag(e, "n")} />
          <div className="wm-s" onPointerDown={(e) => pointerDrag(e, "s")} />
          <div className="wm-e" onPointerDown={(e) => pointerDrag(e, "e")} />
          <div className="wm-w" onPointerDown={(e) => pointerDrag(e, "w")} />
          <div className="wm-ne" onPointerDown={(e) => pointerDrag(e, "ne")} />
          <div className="wm-nw" onPointerDown={(e) => pointerDrag(e, "nw")} />
          <div className="wm-se" onPointerDown={(e) => pointerDrag(e, "se")} />
          <div className="wm-sw" onPointerDown={(e) => pointerDrag(e, "sw")} />
        </>
      )}
    </div>
  );
}
