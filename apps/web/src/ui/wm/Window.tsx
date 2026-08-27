import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Computer } from "@webmcp-computer/contract";

type Bounds = { x: number; y: number; w: number; h: number; z: number };
type Kind = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

type Props = {
  computer: Computer;
  bounds: Bounds;
  selected: boolean;
  acting: boolean;
  actingVerb: string | null;
  dragActive: boolean;
  maximized: boolean;
  onFocus: () => void;
  onBounds: (b: Partial<Bounds>) => void;
  onDrag: (v: boolean) => void;
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
};

export function WindowFrame({
  computer,
  bounds,
  selected,
  acting,
  actingVerb,
  dragActive,
  maximized,
  onFocus,
  onBounds,
  onDrag,
  onMinimize,
  onMaximize,
  onClose,
}: Props) {
  const start = useRef({ x: 0, y: 0, bx: 0, by: 0, bw: 0, bh: 0 });
  const cleanup = useRef<(() => void) | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const frozen = useRef<{ w: number; h: number } | null>(null);

  useEffect(() => {
    if (dragActive && bodyRef.current && !frozen.current) {
      frozen.current = {
        w: bodyRef.current.clientWidth,
        h: bodyRef.current.clientHeight,
      };
    }
    if (!dragActive) frozen.current = null;
  }, [dragActive]);

  function pointerDrag(e: React.PointerEvent, kind: Kind) {
    if (maximized && kind !== "move") return;
    e.preventDefault();
    e.stopPropagation();
    onFocus();
    onDrag(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = {
      x: e.clientX,
      y: e.clientY,
      bx: bounds.x,
      by: bounds.y,
      bw: bounds.w,
      bh: bounds.h,
    };
    const move = (ev: PointerEvent) => {
      if (maximized) return;
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
      onBounds({ x, y, w, h });
    };
    const up = () => {
      onDrag(false);
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

  const running = computer.status === "running";
  const cls = `wm-window${selected || acting ? " selected" : ""}${acting ? " acting" : ""}${maximized ? " maximized" : ""}`;
  const ice = frozen.current;

  return (
    <div
      className={cls}
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.w,
        height: bounds.h,
        zIndex: bounds.z,
      }}
      onPointerDown={() => onFocus()}
    >
      <div
        className="wm-title"
        onPointerDown={(e) => pointerDrag(e, "move")}
        onDoubleClick={(e) => {
          e.preventDefault();
          onMaximize();
        }}
      >
        <span className="wm-title-id">
          <span className={running ? "wm-dot on" : "wm-dot"}>{running ? "●" : "○"}</span>
          {computer.name}
        </span>
        {acting && actingVerb ? (
          <span className="wm-acting">AGENT  {actingVerb}</span>
        ) : computer.status === "starting" ? (
          <span className="wm-acting">starting</span>
        ) : null}
        <span className="wm-controls">
          <button
            type="button"
            className="wm-btn"
            aria-label="minimize"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onMinimize();
            }}
          >
            <Minus size={12} strokeWidth={2} />
          </button>
          <button
            type="button"
            className="wm-btn"
            aria-label={maximized ? "restore" : "maximize"}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onMaximize();
            }}
          >
            {maximized ? (
              <Copy size={11} strokeWidth={2} />
            ) : (
              <Square size={11} strokeWidth={2} />
            )}
          </button>
          <button
            type="button"
            className="wm-btn wm-btn-close"
            aria-label="close"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
          >
            <X size={12} strokeWidth={2} />
          </button>
        </span>
      </div>
      <div className="wm-body" ref={bodyRef}>
        {!selected && !dragActive ? (
          <button
            type="button"
            className="wm-hit"
            aria-label={`focus ${computer.name}`}
          />
        ) : null}
        {dragActive ? <div className="wm-hit" /> : null}
        <iframe
          title={computer.id}
          allow="unload"
          style={ice ? { width: ice.w, height: ice.h } : undefined}
          src={`/desktops/${encodeURIComponent(computer.id)}/?autoconnect=1&resize=remote&quality=9&compression=0&encrypt=0&path=${encodeURIComponent(`desktops/${computer.id}/websockify`)}`}
        />
      </div>
      {maximized ? null : (
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
