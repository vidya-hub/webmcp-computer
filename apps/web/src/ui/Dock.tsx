import { useRef, useState } from "react";
import type { Computer, ComputerId, WallpaperId } from "@webmcp-computer/contract";
import { useShallow } from "zustand/react/shallow";
import { store, useStore } from "../store/index.ts";
import { selectDock } from "../store/selectors.ts";

function wallpaperOf(c: Computer): WallpaperId {
  return c.wallpaper ?? "carbon";
}

function initials(name: string): string {
  const parts = name.split(/[-_\s]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function Dock() {
  const {
    computers,
    selectedComputer,
    actingComputerId,
    minimized,
    computersRunning,
  } = useStore(useShallow(selectDock));
  const tiles = useRef(new Map<string, HTMLButtonElement>());
  const [scales, setScales] = useState<Record<string, number>>({});

  function magnify(e: React.MouseEvent) {
    const next: Record<string, number> = {};
    tiles.current.forEach((el, id) => {
      const r = el.getBoundingClientRect();
      const d = Math.abs(e.clientX - (r.left + r.width / 2));
      next[id] = 1 + 0.42 * Math.max(0, 1 - d / 96);
    });
    setScales(next);
  }

  function tileStyle(id: string): React.CSSProperties {
    const s = scales[id] ?? 1;
    return s === 1
      ? {}
      : { transform: `scale(${s}) translateY(${-(s - 1) * 22}px)` };
  }

  function register(id: string) {
    return (el: HTMLButtonElement | null) => {
      if (el) tiles.current.set(id, el);
      else tiles.current.delete(id);
    };
  }

  return (
    <nav
      className="dock"
      aria-label="computers"
      onMouseMove={magnify}
      onMouseLeave={() => setScales({})}
    >
      <div className="dock-shelf">
        {computers.map((c) => {
          const selected = c.id === selectedComputer;
          const acting = c.id === actingComputerId;
          const min = minimized.includes(c.id);
          const wp = wallpaperOf(c);
          return (
            <button
              key={c.id}
              ref={register(c.id)}
              type="button"
              style={tileStyle(c.id)}
              className={`dock-tile wp-${wp}${selected ? " selected" : ""}${acting ? " acting" : ""}${min ? " min" : ""}${c.status === "starting" ? " starting" : ""}${c.status === "error" ? " error" : ""}`}
              aria-label={c.name}
              aria-current={selected ? "true" : undefined}
              onClick={() => {
                const s = store.getState();
                s.restore(c.id);
                void s.selectComputer(c.id as ComputerId);
              }}
            >
              <span className="dock-icon" aria-hidden>
                <span className="dock-icon-bezel">
                  <span className="dock-icon-screen">{initials(c.name)}</span>
                </span>
                <span className="dock-icon-chin" />
              </span>
              <span className="dock-tip">
                {c.name}
                {min ? " — hidden" : acting ? " — agent" : ""}
              </span>
              <span className="dock-dot" />
            </button>
          );
        })}
        {computers.length > 0 ? <span className="dock-rule" aria-hidden /> : null}
        <button
          type="button"
          ref={register("__spawn")}
          style={tileStyle("__spawn")}
          className="dock-tile dock-spawn"
          aria-label="new computer"
          disabled={computersRunning >= 4}
          onClick={() => void store.getState().spawnComputer()}
        >
          <span className="dock-plus" />
          <span className="dock-tip">
            {computersRunning >= 4 ? "computer cap" : "new computer"}
          </span>
        </button>
      </div>
    </nav>
  );
}
