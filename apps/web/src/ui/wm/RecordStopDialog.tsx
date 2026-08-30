import { useEffect, useRef, useState } from "react";

type Props = {
  onCancel: () => void;
  onSave: (name: string, description: string) => void | Promise<void>;
};

export function RecordStopDialog({ onCancel, onSave }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  async function save() {
    if (!name.trim() || saving) return;
    setSaving(true);
    setErr(null);
    try {
      await onSave(name.trim(), description.trim());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="overlay">
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Save recording"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="sheet-mark">Recording</div>
        <h2>Save this recording</h2>
        <p className="sheet-body">
          Give it a name so you (or the agent) can replay these exact actions
          later. Note: a recording can capture text you typed, including
          passwords.
        </p>
        <input
          ref={inputRef}
          type="text"
          className="rec-input"
          placeholder="name (e.g. set-up-project)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
          }}
        />
        <input
          type="text"
          className="rec-input"
          placeholder="description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        {err ? <p className="sheet-err">{err}</p> : null}
        <div className="sheet-actions">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-approve"
            disabled={!name.trim() || saving}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
