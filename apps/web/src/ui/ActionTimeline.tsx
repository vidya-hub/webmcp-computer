import { useEffect, useMemo, useState } from "react";
import type { TapeEvent } from "@webmcp-computer/contract";
import { api } from "../api/client.ts";

type Props = { open: boolean; onClose: () => void };

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

export function ActionTimeline({ open, onClose }: Props) {
  const [events, setEvents] = useState<TapeEvent[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setLightbox(null);
      return;
    }
    const load = () => {
      void api<{ events: TapeEvent[] }>("/api/tape").then((d) => {
        const list = d.events ?? [];
        setEvents(list);
        setSelectedId((id) => id ?? list[0]?.id ?? null);
      });
    };
    load();
    const t = window.setInterval(load, 2500);
    return () => window.clearInterval(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (lightbox) setLightbox(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, lightbox, onClose]);

  const computers = useMemo(() => {
    const ids: string[] = [];
    for (const e of events) {
      if (!ids.includes(e.computerId)) ids.push(e.computerId);
    }
    return ids;
  }, [events]);

  const rows = filter === "all" ? events : events.filter((e) => e.computerId === filter);
  const selected = rows.find((e) => e.id === selectedId) ?? rows[0] ?? null;

  if (!open) return null;

  return (
    <div className="tl-root">
      <div className="tl-panel">
        <div className="tl-bar">
          <span className="tl-title">Action TimeLine</span>
          {events.length > 0 ? (
            <div className="tl-filters">
              <button
                type="button"
                className={`tl-chip${filter === "all" ? " on" : ""}`}
                onClick={() => setFilter("all")}
              >
                All
              </button>
              {computers.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`tl-chip${filter === id ? " on" : ""}`}
                  onClick={() => setFilter(id)}
                >
                  {id}
                </button>
              ))}
            </div>
          ) : null}
          <button type="button" className="tl-close" aria-label="close" onClick={onClose}>
            ✕
          </button>
        </div>
        {events.length === 0 ? (
          <div className="tl-blank">
            <div className="tl-blank-mark" />
            <h2>No actions yet</h2>
            <p>
              When the agent or you change a computer, before and after shots
              land here with the input and output for each act.
            </p>
          </div>
        ) : (
          <div className="tl-body">
            <div className="tl-list">
              {rows.length === 0 ? (
                <div className="tl-empty">nothing on this computer</div>
              ) : (
                rows.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className={`tl-row${selected?.id === e.id ? " on" : ""}`}
                    onClick={() => setSelectedId(e.id)}
                  >
                    <span className="tl-time">{clock(e.at)}</span>
                    <span className="tl-op">
                      {e.op} {e.detail}
                    </span>
                    <span className="tl-host">{e.computerId}</span>
                  </button>
                ))
              )}
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
                    text={
                      selected.error ||
                      dump(selected.output) ||
                      selected.log ||
                      "—"
                    }
                  />
                </>
              ) : (
                <div className="tl-empty">select an act</div>
              )}
            </div>
          </div>
        )}
      </div>
      {lightbox ? (
        <button
          type="button"
          className="tl-lightbox"
          onClick={() => setLightbox(null)}
        >
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
