import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { Computer, ComputerId } from "@webmcp-computer/contract";
import { useShallow } from "zustand/react/shallow";
import { store, useStore } from "../../store/index.ts";
import { overviewTarget } from "../../store/slices/wm.ts";
import type { Bounds, Rect } from "../../store/types.ts";
import { windowSlice } from "../../store/selectors.ts";

type Kind = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

type Props = {
  computer: Computer;
  index: number;
  canvasRef: RefObject<HTMLDivElement | null>;
  onMove: (x: number, y: number, kind: Kind) => void;
};

const BOOT_LINES = [
  "post ......... ok",
  "memory ....... ok",
  "vnc :1 ....... ok",
  "desktop ...... starting",
];

export function WindowFrame({ computer, index, canvasRef, onMove }: Props) {
  const id = computer.id;
  const wm = useStore(useShallow(windowSlice(id)));
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
  const [boot, setBoot] = useState<"in" | "out" | "off">(
    computer.status === "starting" ? "in" : "off",
  );

  useEffect(() => {
    if (computer.status === "starting") {
      setBoot("in");
      return;
    }
    if (boot === "in") {
      setBoot("out");
      const t = window.setTimeout(() => setBoot("off"), 340);
      return () => window.clearTimeout(t);
    }
  }, [computer.status, boot]);

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
      onMove(ev.clientX, ev.clientY, kind);
      store.getState().patchBounds(id, { x, y, w, h });
    };
    const up = () => {
      const s = store.getState();
      if (s.snap) s.applySnap(id, s.snap);
      s.setSnap(null);
      s.evenBounds(id);
      s.setDragging(null);
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

  if (!wm.bounds || wm.minimized) return null;

  const running = computer.status === "running";
  const cls = `wm-window${wm.selected || wm.acting ? " selected" : ""}${wm.acting ? " acting" : ""}${wm.maximized ? " maximized" : ""}${wm.lifecycle ? ` ${wm.lifecycle}` : ""}${target ? " overviewing" : ""}`;
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
      className={cls}
      style={style}
      onPointerDown={() => onFocus()}
      onAnimationEnd={(e) => {
        if (e.target !== e.currentTarget) return;
        const s = store.getState();
        const phase = s.lifecycle[id];
        if (phase === "minimizing") s.finishMinimize(id);
        else if (phase) s.clearPhase(id);
      }}
    >
      <div className="wm-chrome">
      <div
        className="wm-title"
        onPointerDown={(e) => pointerDrag(e, "move")}
        onDoubleClick={(e) => {
          e.preventDefault();
          store.getState().maximize(id);
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
              store.getState().startMinimize(id);
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
            }}
          />
        </span>
        <span className="wm-title-id">{computer.name}</span>
        {wm.acting && wm.actingVerb ? (
          <span className="wm-acting">AGENT  {wm.actingVerb}</span>
        ) : computer.status === "starting" ? (
          <span className="wm-acting">starting</span>
        ) : running ? null : (
          <span className="wm-acting">{computer.status}</span>
        )}
      </div>
      <div className="wm-body" ref={bodyRef}>
        {boot !== "off" ? (
          <div className={`wm-boot${boot === "out" ? " out" : ""}`} aria-hidden>
            <div className="wm-boot-progress">
              <span />
            </div>
            <div className="wm-boot-log">
              <p style={{ animationDelay: "0ms" }}>
                webmcp bios — {computer.name}
              </p>
              {BOOT_LINES.map((line, i) => (
                <p key={line} style={{ animationDelay: `${(i + 1) * 130}ms` }}>
                  {line}
                </p>
              ))}
              <p style={{ animationDelay: `${(BOOT_LINES.length + 1) * 130}ms` }}>
                <span className="bootseq-cursor" />
              </p>
            </div>
          </div>
        ) : null}
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
          allow="unload; tools"
          style={ice ? { width: ice.w, height: ice.h } : undefined}
          src={`/desktops/${encodeURIComponent(computer.id)}/?v=rfb`}
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
