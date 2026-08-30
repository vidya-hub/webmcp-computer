import { useCallback, useEffect, useState } from "react";
import type { RecordedAction } from "@webmcp-computer/contract";
import { api } from "../api/client.ts";
import { store } from "../store/index.ts";
import { setReplayLock } from "./wm/recording.ts";

type Props = { open: boolean; onClose: () => void };

export function ActionsPanel({ open, onClose }: Props) {
  const [actions, setActions] = useState<RecordedAction[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    void api<{ actions: RecordedAction[] }>("/api/actions")
      .then((d) => setActions(d.actions ?? []))
      .catch(() => setActions([]));
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  async function replay(a: RecordedAction) {
    setBusy(a.id);
    setMsg(null);
    const target = store.getState().selectedComputer;
    if (target) setReplayLock(target, true);
    try {
      const res = (await api(
        `/api/actions/${encodeURIComponent(a.id)}/replay`,
        {
          method: "POST",
          body: JSON.stringify({ speed: 1 }),
        },
        130_000,
      )) as { success?: boolean; reason?: string };
      setMsg(
        res && res.success === false
          ? res.reason ?? "rejected"
          : `Replayed "${a.name}"`,
      );
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "replay failed");
    } finally {
      if (target) setReplayLock(target, false);
      setBusy(null);
    }
  }

  async function remove(a: RecordedAction) {
    setBusy(a.id);
    try {
      await api(`/api/actions/${encodeURIComponent(a.id)}`, {
        method: "DELETE",
      });
      load();
    } catch {
      /* ignore */
    } finally {
      setBusy(null);
    }
  }

  if (!open) return null;

  return (
    <div className="tl-root" role="dialog" aria-modal="true" aria-label="Recorded actions">
      <div className="tl-panel">
        <div className="tl-bar">
          <span className="tl-title">Recorded Actions</span>
          {msg ? <span className="tl-savemsg">{msg}</span> : null}
          <button type="button" className="tl-close" aria-label="close" onClick={onClose}>
            ✕
          </button>
        </div>
        {actions.length === 0 ? (
          <div className="tl-blank">
            <div className="tl-blank-mark" />
            <h2>No recorded actions</h2>
            <p>
              Do something on a computer, then open the Action TimeLine and click
              <strong> ★ Save as action</strong> to turn recent steps into a
              replayable recipe. Agents can replay them by name.
            </p>
          </div>
        ) : (
          <div className="tl-body">
            <div className="tl-list">
              {actions.map((a) => (
                <div key={a.id} className="tl-row" style={{ cursor: "default" }}>
                  <span className="tl-op">{a.name}</span>
                  <span className="tl-detail">
                    {a.steps.length} steps · {a.source}
                  </span>
                  <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      className="tl-chip on"
                      disabled={busy === a.id}
                      onClick={() => void replay(a)}
                    >
                      ▶ Replay
                    </button>
                    <button
                      type="button"
                      className="tl-chip"
                      disabled={busy === a.id}
                      onClick={() => void remove(a)}
                    >
                      Delete
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
