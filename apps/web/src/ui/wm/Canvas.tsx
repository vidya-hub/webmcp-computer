import { useCallback, useEffect, useRef, useState } from "react";
import type { Computer, ComputerId } from "@webmcp-computer/contract";
import { useWorkspace } from "../../state/workspace-store.tsx";
import { WindowFrame } from "./Window.tsx";

type Bounds = { x: number; y: number; w: number; h: number; z: number };

function even(n: number) {
  return Math.max(2, n - (n % 2));
}

function tile(i: number, cw: number, ch: number): Bounds {
  const w = even(Math.max(320, Math.round(cw * 0.7)));
  const h = even(Math.max(240, Math.round(ch * 0.7)));
  const x = Math.max(8, Math.round((cw - w) / 2) + i * 40);
  const y = Math.max(8, Math.round((ch - h) / 2) + i * 40);
  return { x, y, w, h, z: i + 1 };
}

export function Canvas() {
  const {
    computers,
    selectedComputer,
    actingComputerId,
    actingVerb,
    selectComputer,
    spawnComputer,
    destroyComputer,
    minimized,
    minimizeComputer,
    restoreComputer,
  } = useWorkspace();
  const ref = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState<Record<string, Bounds>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [maximized, setMaximized] = useState<string | null>(null);
  const saved = useRef<Record<string, Bounds>>({});
  const zTop = useRef(1);

  useEffect(() => {
    const el = ref.current;
    const cw = el?.clientWidth ?? 800;
    const ch = el?.clientHeight ?? 600;
    setBounds((prev) => {
      const next = { ...prev };
      computers.forEach((c, i) => {
        if (!next[c.id]) next[c.id] = tile(i, cw, ch);
      });
      for (const id of Object.keys(next)) {
        if (!computers.some((c) => c.id === id)) delete next[id];
      }
      const zs = Object.values(next).map((b) => b.z);
      zTop.current = Math.max(1, ...zs);
      return next;
    });
      setMaximized((id) =>
        id && computers.some((c) => c.id === id) ? id : null,
      );
  }, [computers]);

  const raise = useCallback((id: string) => {
    zTop.current += 1;
    setBounds((prev) => {
      const b = prev[id];
      if (!b) return prev;
      return { ...prev, [id]: { ...b, z: zTop.current } };
    });
  }, []);

  useEffect(() => {
    const id = actingComputerId ?? selectedComputer;
    if (id) raise(id);
  }, [actingComputerId, selectedComputer, raise]);

  function patch(id: string, next: Partial<Bounds>) {
    const cw = ref.current?.clientWidth ?? 800;
    const ch = ref.current?.clientHeight ?? 600;
    setBounds((prev) => {
      const b = prev[id];
      if (!b) return prev;
      let x = next.x ?? b.x;
      let y = next.y ?? b.y;
      let w = next.w ?? b.w;
      let h = next.h ?? b.h;
      w = Math.min(Math.max(320, w), cw);
      h = Math.min(Math.max(240, h), ch);
      x = Math.min(Math.max(0, x), Math.max(0, cw - 40));
      y = Math.min(Math.max(0, y), Math.max(0, ch - 32));
      if (x + w > cw) w = Math.max(320, cw - x);
      if (y + h > ch) h = Math.max(240, ch - y);
      return { ...prev, [id]: { ...b, ...next, x, y, w, h } };
    });
  }

  function maximize(id: string) {
    const el = ref.current;
    const cw = el?.clientWidth ?? 800;
    const ch = el?.clientHeight ?? 600;
    setMaximized((cur) => {
      if (cur === id) {
        const prev = saved.current[id];
        if (prev) setBounds((b) => ({ ...b, [id]: prev }));
        return null;
      }
      const b = bounds[id];
      if (b) saved.current[id] = b;
      zTop.current += 1;
      setBounds((prev) => ({
        ...prev,
        [id]: {
          x: 8,
          y: 8,
          w: even(Math.max(320, cw - 16)),
          h: even(Math.max(240, ch - 88)),
          z: zTop.current,
        },
      }));
      return id;
    });
    restoreComputer(id);
  }

  function minimize(id: string) {
    minimizeComputer(id);
    if (maximized === id) setMaximized(null);
  }

  return (
    <div className="wm-stage">
      <div className="wm-canvas" ref={ref}>
        {computers.length === 0 ? (
          <div className="desk-blank">
            <p>No computers</p>
            <button type="button" className="desk-new" onClick={() => void spawnComputer()}>
              New Computer
            </button>
          </div>
        ) : null}
        {computers.map((c: Computer) => {
          const b = bounds[c.id];
          if (!b || minimized.includes(c.id)) return null;
          return (
            <WindowFrame
              key={c.id}
              computer={c}
              bounds={b}
              selected={c.id === selectedComputer}
              acting={c.id === actingComputerId}
              actingVerb={c.id === actingComputerId ? actingVerb : null}
              dragActive={draggingId === c.id}
              maximized={maximized === c.id}
              onFocus={() => {
                raise(c.id);
                if (c.id !== selectedComputer) void selectComputer(c.id as ComputerId);
              }}
              onBounds={(n) => patch(c.id, n)}
              onDrag={(v) => {
                if (!v) {
                  setBounds((prev) => {
                    const b = prev[c.id];
                    if (!b) return prev;
                    return {
                      ...prev,
                      [c.id]: { ...b, w: even(b.w), h: even(b.h) },
                    };
                  });
                }
                setDraggingId(v ? c.id : null);
              }}
              onMinimize={() => minimize(c.id)}
              onMaximize={() => maximize(c.id)}
              onClose={() => void destroyComputer(c.id as ComputerId)}
            />
          );
        })}
      </div>
    </div>
  );
}
