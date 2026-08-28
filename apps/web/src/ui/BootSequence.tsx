import { useCallback, useEffect, useRef, useState } from "react";
import { blip } from "./sound.ts";

type Line = { label: string; status: string | null; bad: boolean };

type Probe = { label: string; run: () => Promise<{ status: string; bad?: boolean }> };

const STEPS: Probe[] = [
  {
    label: "webmcp-computer bios v0.1",
    run: async () => ({ status: "" }),
  },
  {
    label: "probe: api",
    run: async () => {
      try {
        const r = await fetch("/api/health", {
          signal: AbortSignal.timeout(4000),
        });
        return r.ok ? { status: "ok" } : { status: "fail", bad: true };
      } catch {
        return { status: "fail", bad: true };
      }
    },
  },
  {
    label: "probe: webmcp",
    run: async () => {
      const ok = Boolean(
        document.modelContext &&
          typeof document.modelContext.registerTool === "function",
      );
      return ok ? { status: "ready" } : { status: "missing", bad: true };
    },
  },
  {
    label: "mount: /desktops",
    run: async () => {
      try {
        const r = await fetch("/api/computers", {
          signal: AbortSignal.timeout(4000),
        });
        if (!r.ok) return { status: "fail", bad: true };
        const d = (await r.json()) as { computers?: unknown[] };
        const n = d.computers?.length ?? 0;
        return { status: n > 0 ? `ok (${n})` : "ok (empty)" };
      } catch {
        return { status: "fail", bad: true };
      }
    },
  },
  {
    label: "agent",
    run: async () => ({ status: "standing by" }),
  },
];

export function BootSequence({ onDone }: { onDone: () => void }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [done, setDone] = useState(false);
  const doneRef = useRef(false);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  }, [onDone]);

  useEffect(() => {
    let cancelled = false;
    const timers: number[] = [];
    (async () => {
      for (const step of STEPS) {
        if (cancelled || doneRef.current) return;
        const started = Date.now();
        setLines((ls) => [...ls, { label: step.label, status: null, bad: false }]);
        blip("tick");
        const result = await step.run();
        // keep a readable rhythm even when probes resolve instantly
        const wait = Math.max(0, 140 - (Date.now() - started));
        await new Promise((r) => window.setTimeout(r, wait));
        if (cancelled || doneRef.current) return;
        setLines((ls) =>
          ls.map((l) =>
            l.label === step.label
              ? { ...l, status: result.status, bad: Boolean(result.bad) }
              : l,
          ),
        );
      }
      timers.push(window.setTimeout(() => setDone(true), 420));
    })();
    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(finish, 120);
    return () => window.clearTimeout(t);
  }, [done, finish]);

  useEffect(() => {
    const skip = (e: Event) => {
      e.preventDefault();
      finish();
    };
    window.addEventListener("keydown", skip);
    window.addEventListener("pointerdown", skip);
    return () => {
      window.removeEventListener("keydown", skip);
      window.removeEventListener("pointerdown", skip);
    };
  }, [finish]);

  const lastPending = lines.length > 0 && lines[lines.length - 1].status === null;

  return (
    <div className={`bootseq${done ? " out" : ""}`} role="presentation">
      <div className="bootseq-log">
        {lines.map((l) => (
          <div className="bootseq-line" key={l.label}>
            <span className="bootseq-label">{l.label}</span>
            {l.label.includes(":") ? <span> </span> : null}
            {l.status !== null ? (
              <span className={`bootseq-status${l.bad ? " bad" : ""}`}>
                {l.status || " "}
              </span>
            ) : null}
          </div>
        ))}
        {!done && (lastPending || lines.length < STEPS.length) ? (
          <span className="bootseq-cursor" />
        ) : null}
        {done ? <div className="bootseq-line">_</div> : null}
      </div>
      <span className="bootseq-skip">press any key to skip</span>
    </div>
  );
}
