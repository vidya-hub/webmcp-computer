import { useEffect, useRef, useState } from "react";
import type { ActivityEvent } from "@webmcp-computer/contract";
import { store, useStore } from "../store/index.ts";

type Toast = { id: string; text: string; who: string };

function fmt(e: ActivityEvent): string {
  const what = `${e.verb}${e.detail ? ` ${e.detail}` : ""}`;
  return what.length > 72 ? `${what.slice(0, 71)}…` : what;
}

export function Toasts() {
  const activity = useStore((s) => s.activity);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(activity.map((e) => e.id));
      return;
    }
    const seenSet: Set<string> = seen.current;
    const fresh = activity.filter(
      (e) => !seenSet.has(e.id) && e.actor !== "system",
    );
    for (const e of activity) seenSet.add(e.id);
    if (fresh.length === 0) return;
    const next = fresh.slice(0, 2).map((e) => ({
      id: e.id,
      who: `${e.actor}${e.computerId ? ` → ${e.computerId}` : ""}`,
      text: fmt(e),
    }));
    setToasts((ts) => {
      const merged = [...ts.slice(-2), ...next];
      store.getState().setToastsVisible(merged.length > 0);
      return merged;
    });
    const ids = next.map((t) => t.id);
    const timer = window.setTimeout(() => {
      setToasts((ts) => {
        const left = ts.filter((t) => !ids.includes(t.id));
        store.getState().setToastsVisible(left.length > 0);
        return left;
      });
    }, 2600);
    return () => window.clearTimeout(timer);
  }, [activity]);

  if (toasts.length === 0) return null;
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div className="toast" key={t.id}>
          <span className="who">{t.who} </span>
          {t.text}
        </div>
      ))}
    </div>
  );
}
