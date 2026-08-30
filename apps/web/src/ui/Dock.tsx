import { useEffect, useRef, useState } from "react";
import {
  MAX_COMPUTERS,
  type Computer,
  type ComputerId,
  type HomeArchive,
  type WallpaperId,
} from "@webmcp-computer/contract";
import { useShallow } from "zustand/react/shallow";
import { api } from "../api/client.ts";
import { store, useStore } from "../store/index.ts";
import { selectDock } from "../store/selectors.ts";
import { play } from "./sound.ts";
import { registerDockShelf, registerDockTile } from "./wm/dockTiles.ts";

function wallpaperOf(c: Computer): WallpaperId {
  return c.wallpaper ?? "carbon";
}

function initials(name: string): string {
  const parts = name.split(/[-_\s]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const TINT: Record<string, [string, string]> = {
  carbon: ["#3a3a42", "#1a1a1e"],
  "dark-grid": ["#2a3344", "#12161e"],
  void: ["#1c1c22", "#0a0a0c"],
  arrows: ["#3a4658", "#1a2028"],
};

export function Dock() {
  const {
    computers,
    selectedComputer,
    actingComputerId,
    minimized,
    computersRunning,
  } = useStore(useShallow(selectDock));
  const tiles = useRef(new Map<string, HTMLButtonElement>());
  const centers = useRef<number[]>([]);
  const ids = useRef<string[]>([]);
  const raf = useRef(0);
  const [bounce, setBounce] = useState<string | null>(null);
  const prevMin = useRef<string[]>([]);
  const [archives, setArchives] = useState<HomeArchive[]>([]);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    void api<{ archives: HomeArchive[] }>("/api/archives")
      .then((d) => setArchives(d.archives ?? []))
      .catch(() => setArchives([]));
  }, []);

  useEffect(() => {
    const added = minimized.filter((id) => !prevMin.current.includes(id));
    prevMin.current = minimized;
    if (added[0]) {
      setBounce(added[0]);
      const t = window.setTimeout(() => setBounce(null), 420);
      return () => window.clearTimeout(t);
    }
  }, [minimized]);

  function recache() {
    ids.current = [];
    centers.current = [];
    tiles.current.forEach((el, id) => {
      ids.current.push(id);
      const r = el.getBoundingClientRect();
      centers.current.push(r.left + r.width / 2);
    });
  }

  function magnify(e: React.MouseEvent) {
    if (raf.current) return;
    const x = e.clientX;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      ids.current.forEach((id, i) => {
        const el = tiles.current.get(id);
        if (!el) return;
        const d = Math.abs(x - (centers.current[i] ?? 0));
        const s = 1 + 0.42 * Math.max(0, 1 - d / 96);
        el.style.setProperty("--s", String(s));
      });
    });
  }

  function clearMag() {
    tiles.current.forEach((el) => el.style.setProperty("--s", "1"));
  }

  function register(id: string) {
    return (el: HTMLButtonElement | null) => {
      registerDockTile(id, el);
      if (el) tiles.current.set(id, el);
      else tiles.current.delete(id);
    };
  }

  const atCap = computersRunning >= MAX_COMPUTERS;

  return (
    <nav
      className="dock"
      aria-label="computers"
      onPointerEnter={recache}
      onMouseMove={magnify}
      onMouseLeave={clearMag}
    >
      <div className="dock-shelf" ref={(el) => registerDockShelf(el)}>
        {computers.map((c) => {
          const selected = c.id === selectedComputer;
          const acting = c.id === actingComputerId;
          const min = minimized.includes(c.id);
          const wp = wallpaperOf(c);
          const [a, b] = TINT[wp] ?? TINT.carbon!;
          return (
            <button
              key={c.id}
              ref={register(c.id)}
              type="button"
              className={`dock-tile wp-${wp}${selected ? " selected" : ""}${acting ? " acting" : ""}${min ? " min" : ""}${c.status === "starting" ? " starting" : ""}${c.status === "error" ? " error" : ""}${bounce === c.id ? " bounce" : ""}`}
              aria-label={c.name}
              aria-current={selected ? "true" : undefined}
              onClick={() => {
                const s = store.getState();
                if (c.id !== s.selectedComputer) play("select");
                s.restore(c.id);
                void s.selectComputer(c.id as ComputerId);
              }}
            >
              <span className="dock-icon" aria-hidden>
                <svg viewBox="0 0 48 48" width="48" height="48">
                  <rect x="6" y="6" width="36" height="28" rx="5" fill={b} stroke="rgba(255,255,255,.22)" />
                  <rect x="9" y="9" width="30" height="20" rx="2" fill={a} />
                  <text
                    x="24"
                    y="23"
                    textAnchor="middle"
                    fontSize="9"
                    fontWeight="700"
                    fill="rgba(255,255,255,.85)"
                  >
                    {initials(c.name)}
                  </text>
                  <rect x="20" y="34" width="8" height="3" rx="1" fill="rgba(255,255,255,.28)" />
                  <rect x="14" y="37" width="20" height="3" rx="1.5" fill="rgba(255,255,255,.18)" />
                </svg>
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
          className="dock-tile dock-spawn"
          aria-label="new computer"
          aria-disabled={atCap}
          title={atCap ? `Limit of ${MAX_COMPUTERS} computers reached` : "new computer"}
          onClick={() => {
            if (atCap) {
              play("blocked");
              return;
            }
            void store.getState().spawnComputer();
          }}
        >
          <span className="dock-plus" />
          <span className="dock-tip">
            {atCap
              ? `Limit of ${MAX_COMPUTERS} computers reached`
              : "new computer"}
          </span>
        </button>
        {archives.length > 0 ? (
          <div className="dock-restore">
            <button
              type="button"
              className="dock-chevron"
              aria-label="restore files"
              onClick={() => setMenu((v) => !v)}
            >
              ▴
            </button>
            {menu ? (
              <div className="dock-menu">
                {archives.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className="dock-menu-item"
                    onClick={() => {
                      setMenu(false);
                      void store.getState().spawnComputer(a.id);
                    }}
                  >
                    {a.name || a.computerId} · {Math.round(a.sizeBytes / 1024)} KB
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </nav>
  );
}
