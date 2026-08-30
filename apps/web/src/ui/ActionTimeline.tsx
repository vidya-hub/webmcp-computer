import { useEffect, useMemo, useRef, useState } from "react";
import type { RecordedAction, TapeEvent } from "@webmcp-computer/contract";
import { api } from "../api/client.ts";
import { store, useStore } from "../store/index.ts";

function dump(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function clock(iso: string) {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function laneKind(op: string): string {
  if (
    ["typeText", "key", "mouseClick", "mouseDrag", "scroll", "selectAll"].includes(
      op,
    )
  ) {
    return "input";
  }
  if (
    [
      "writeFile",
      "readFile",
      "listFiles",
      "deleteFile",
      "moveFile",
      "createDirectory",
      "searchFiles",
    ].includes(op)
  ) {
    return "files";
  }
  if (["run", "installPackage", "killProcess"].includes(op)) return "run";
  if (
    op.startsWith("browser") ||
    ["openUrl", "clickSelector", "visibleText", "findText", "createTab", "selectTab", "closeTab", "reloadTab"].includes(
      op,
    )
  ) {
    return "browser";
  }
  if (op === "replayAction") return "recipe";
  return "input";
}

export function ActionTimeline() {
  const liveTape = useStore((s) => s.tape);
  const filter = useStore((s) => s.tapeFilter);
  const focusNonce = useStore((s) => s.tapeFocusNonce);
  const [history, setHistory] = useState<TapeEvent[]>([]);
  const events = useMemo(() => {
    const byId = new Map<string, TapeEvent>();
    for (const e of history) byId.set(e.id, e);
    for (const e of liveTape) byId.set(e.id, e);
    return [...byId.values()].sort((a, b) => (a.at < b.at ? 1 : -1));
  }, [history, liveTape]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveCount, setSaveCount] = useState(10);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  async function submitSave() {
    const name = saveName.trim();
    if (!name) return;
    setSaveMsg(null);
    try {
      const action = await api<RecordedAction>(
        "/api/actions/promote",
        {
          method: "POST",
          headers: { "x-actor": "human" },
          body: JSON.stringify({ count: saveCount, name, description: "" }),
        },
        130_000,
      );
      setSaving(false);
      setSaveName("");
      store.getState().openInspector("recipes", { recipeId: action.id });
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : "save failed");
    }
  }

  useEffect(() => {
    void api<{ events: TapeEvent[] }>("/api/tape")
      .then((d) => {
        const list = d.events ?? [];
        setHistory(list);
        setSelectedId((id) => id ?? list[0]?.id ?? null);
      })
      .catch(() => {
        /* offline */
      });
  }, []);

  useEffect(() => {
    const rows = filter === "all" ? events : events.filter((e) => e.computerId === filter);
    if (rows[0]) setSelectedId(rows[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  useEffect(() => {
    if (!selectedId && events.length > 0) setSelectedId(events[0]!.id);
  }, [selectedId, events]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (lightbox) setLightbox(null);
        else store.getState().closeInspector();
        return;
      }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const rows = (filter === "all" ? events : events.filter((ev) => ev.computerId === filter))
        .slice()
        .sort((a, b) => (a.at < b.at ? -1 : 1));
      if (rows.length === 0) return;
      const i = rows.findIndex((r) => r.id === selectedId);
      const next = e.key === "ArrowRight" ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1);
      if (rows[next]) {
        e.preventDefault();
        setSelectedId(rows[next]!.id);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [lightbox, events, filter, selectedId]);

  const computers = useMemo(() => {
    const ids: string[] = [];
    for (const e of events) {
      if (!ids.includes(e.computerId)) ids.push(e.computerId);
    }
    return ids;
  }, [events]);

  const lanes = filter === "all" ? computers : computers.filter((id) => id === filter);
  const rows = filter === "all" ? events : events.filter((e) => e.computerId === filter);
  const selected = rows.find((e) => e.id === selectedId) ?? rows[0] ?? null;

  const times = events.map((e) => Date.parse(e.at)).filter((n) => Number.isFinite(n));
  const tMin = times.length ? Math.min(...times) : Date.now();
  const tMax = times.length ? Math.max(...times) + 2000 : tMin + 8000;
  const span = Math.max(1000, tMax - tMin);

  function xOf(iso: string, width: number): number {
    const t = Date.parse(iso);
    return ((t - tMin) / span) * width * zoom + pan;
  }

  function wOf(e: TapeEvent, width: number): number {
    const ms = typeof e.durationMs === "number" && e.durationMs > 0 ? e.durationMs : 0;
    return Math.max(8, (ms / span) * width * zoom);
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const next = Math.min(8, Math.max(0.4, zoom * (e.deltaY < 0 ? 1.12 : 0.9)));
    setZoom(next);
  }

  function onPanStart(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest(".tl-bar-ev")) return;
    e.preventDefault();
    const x0 = e.clientX;
    const p0 = pan;
    const move = (ev: PointerEvent) => setPan(p0 + (ev.clientX - x0));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const ticks: number[] = [];
  const step = span > 60_000 ? 15_000 : span > 15_000 ? 5_000 : 1000;
  for (let t = Math.floor(tMin / step) * step; t <= tMax; t += step) ticks.push(t);

  return (
    <div className="insp-tape">
      <div className="tl-bar">
        {events.length > 0 ? (
          <div className="tl-filters">
            <button
              type="button"
              className={`tl-chip${filter === "all" ? " on" : ""}`}
              onClick={() => store.getState().setTapeFilter("all")}
            >
              All
            </button>
            {computers.map((id) => (
              <button
                key={id}
                type="button"
                className={`tl-chip${filter === id ? " on" : ""}`}
                onClick={() => store.getState().setTapeFilter(id)}
              >
                {id}
              </button>
            ))}
          </div>
        ) : null}
        {events.length > 0 ? (
          <button
            type="button"
            className="tl-chip"
            onClick={() => {
              setSaving((v) => !v);
              setSaveMsg(null);
            }}
          >
            Save as recipe
          </button>
        ) : null}
        <button type="button" className="tl-chip" onClick={() => { setZoom(1); setPan(0); }}>
          Fit
        </button>
      </div>
      {saving ? (
        <div className="tl-saveform">
          <input
            type="text"
            placeholder="recipe name"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitSave();
            }}
            autoFocus
          />
          <label>
            last{" "}
            <input
              type="number"
              min={1}
              max={100}
              value={saveCount}
              onChange={(e) => setSaveCount(Number(e.target.value) || 1)}
            />{" "}
            actions
          </label>
          <button type="button" className="tl-chip on" onClick={() => void submitSave()}>
            Save
          </button>
          {saveMsg ? <span className="tl-savemsg">{saveMsg}</span> : null}
        </div>
      ) : saveMsg ? (
        <div className="tl-saveform">
          <span className="tl-savemsg">{saveMsg}</span>
        </div>
      ) : null}
      {events.length === 0 ? (
        <div className="tl-blank">
          <h2>No actions yet</h2>
          <p>Actions will land here as the agent works.</p>
        </div>
      ) : (
        <div className="tl-body tape">
          <div
            className="tl-water"
            onWheel={onWheel}
            onPointerDown={onPanStart}
            ref={trackRef}
          >
            <div className="tl-ruler">
              {ticks.map((t) => (
                <span
                  key={t}
                  className="tl-tick"
                  style={{ left: ((t - tMin) / span) * 100 * zoom + (pan / Math.max(1, trackRef.current?.clientWidth ?? 1)) * 100 + "%" }}
                >
                  {new Date(t).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
              ))}
            </div>
            {lanes.map((id) => {
              const laneEvents = events.filter((e) => e.computerId === id);
              return (
                <div key={id} className="tl-lane">
                  <div className="tl-gutter" title={id}>
                    {id}
                  </div>
                  <div className="tl-track">
                    {laneEvents.map((e) => {
                      const width = trackRef.current?.clientWidth
                        ? trackRef.current.clientWidth - 4
                        : 640;
                      return (
                        <button
                          key={e.id}
                          type="button"
                          className={`tl-bar-ev kind-${laneKind(e.op)}${selected?.id === e.id ? " on" : ""}${e.error ? " err" : ""}`}
                          style={{
                            left: xOf(e.at, width),
                            width: wOf(e, width),
                          }}
                          title={`${e.op} ${e.detail}`}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setSelectedId(e.id);
                          }}
                        >
                          {e.op}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="tl-inspect">
            {selected ? (
              <>
                <div className="tl-head">
                  <div className="tl-op-lg">
                    {selected.op} {selected.detail}
                  </div>
                  <div className="tl-meta">
                    {clock(selected.at)} · {selected.computerId} · {selected.actor}
                    {selected.error ? " · error" : ""}
                  </div>
                </div>
                <div className="tl-shots">
                  <Shot
                    label="before"
                    ok={selected.before}
                    src={`/api/tape/${selected.id}/before`}
                    onOpen={setLightbox}
                  />
                  <Shot
                    label="after"
                    ok={selected.after}
                    src={`/api/tape/${selected.id}/after`}
                    onOpen={setLightbox}
                  />
                </div>
                <Io title="Input" text={dump(selected.input) || "—"} />
                <Io
                  title="Output"
                  text={selected.error || dump(selected.output) || selected.log || "—"}
                />
              </>
            ) : (
              <div className="tl-empty">select an act</div>
            )}
          </div>
        </div>
      )}
      {lightbox ? (
        <button type="button" className="tl-lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" />
        </button>
      ) : null}
    </div>
  );
}

function Shot({
  label,
  ok,
  src,
  onOpen,
}: {
  label: string;
  ok: boolean;
  src: string;
  onOpen: (src: string) => void;
}) {
  if (!ok) {
    return (
      <div className="tl-shot missing">
        <span>{label}</span>
      </div>
    );
  }
  return (
    <button type="button" className="tl-shot" onClick={() => onOpen(src)}>
      <img src={src} alt={label} />
      <span>{label}</span>
    </button>
  );
}

function Io({ title, text }: { title: string; text: string }) {
  return (
    <div className="tl-io">
      <div className="tl-io-h">{title}</div>
      <pre>{text}</pre>
    </div>
  );
}
