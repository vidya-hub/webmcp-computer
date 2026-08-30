import { useCallback, useEffect, useState } from "react";
import type { RecordedAction } from "@webmcp-computer/contract";
import { api } from "../../api/client.ts";
import { store, useStore } from "../../store/index.ts";
import { play } from "../sound.ts";
import { setReplayLock } from "../wm/recording.ts";

export function RecipesPanel({ active = true }: { active?: boolean }) {
  const focusId = useStore((s) => s.recipeFocusId);
  const selectedComputer = useStore((s) => s.selectedComputer);
  const [actions, setActions] = useState<RecordedAction[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(focusId);

  const load = useCallback(() => {
    void api<{ actions: RecordedAction[] }>("/api/actions")
      .then((d) => {
        setMissing(false);
        setActions(d.actions ?? []);
      })
      .catch(() => {
        setMissing(true);
        setActions([]);
      });
  }, []);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  useEffect(() => {
    if (focusId) setSelected(focusId);
  }, [focusId]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      store.getState().closeInspector();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active]);

  async function replay(a: RecordedAction) {
    setBusy(a.id);
    setMsg(null);
    const target = store.getState().selectedComputer;
    if (!target) {
      setBusy(null);
      setMsg("Select a computer to replay on");
      return;
    }
    store.getState().restore(target);
    store.getState().beginAct("replaying");
    setReplayLock(target, true);
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
          : `Replayed “${a.name}” on ${target}`,
      );
    } catch (err) {
      play("error");
      setMsg(err instanceof Error ? err.message : "replay failed");
    } finally {
      store.getState().endAct();
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
      play("delete");
      load();
    } catch {
      play("error");
    } finally {
      setBusy(null);
    }
  }

  if (actions === null) return <div className="tl-empty">loading…</div>;
  if (missing) {
    return (
      <div className="tl-blank">
        <p>Recipes API is unavailable.</p>
      </div>
    );
  }
  if (actions.length === 0) {
    return (
      <div className="tl-blank">
        <h2>No recipes yet</h2>
        <p>Save a run from the Tape tab.</p>
      </div>
    );
  }

  return (
    <div className="insp-body">
      {selectedComputer ? (
        <p className="recipe-target">
          Replay runs on <strong>{selectedComputer}</strong>
        </p>
      ) : (
        <p className="recipe-target">Select a computer, then Replay.</p>
      )}
      {msg ? <span className="tl-savemsg">{msg}</span> : null}
      <div className="tl-list recipes">
        {actions.map((a) => (
          <div
            key={a.id}
            className={`tl-row${selected === a.id ? " on" : ""}`}
            onClick={() => setSelected(a.id)}
          >
            <span className="tl-op">{a.name}</span>
            <span className="tl-detail">
              {a.steps.length} steps · {a.source}
              {a.description ? ` · ${a.description}` : ""}
              {a.createdAt
                ? ` · ${new Date(a.createdAt).toLocaleString([], { month: "short", day: "numeric" })}`
                : ""}
            </span>
            <span className="recipe-actions">
              <button
                type="button"
                className="tl-chip on"
                disabled={busy === a.id}
                onClick={(e) => {
                  e.stopPropagation();
                  void replay(a);
                }}
              >
                Replay
              </button>
              <button
                type="button"
                className="tl-chip"
                disabled={busy === a.id}
                onClick={(e) => {
                  e.stopPropagation();
                  void remove(a);
                }}
              >
                Delete
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
