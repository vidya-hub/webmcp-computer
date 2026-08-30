import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store/index.ts";
import { selectApproval } from "../store/selectors.ts";

export function ApprovalDialog() {
  const { pendingApproval, resolveApproval, resolveChoice } = useStore(
    useShallow(selectApproval),
  );
  if (!pendingApproval) return null;
  const opts = pendingApproval.options ?? [];
  return (
    <div className="overlay">
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={pendingApproval.title || "Agent requests permission"}
      >
        <div className="sheet-mark">Permission</div>
        <div className="sheet-host">{pendingApproval.computerId}</div>
        <h2>{pendingApproval.title || "Agent requests permission"}</h2>
        {pendingApproval.body ? (
          <p className="sheet-body">{pendingApproval.body}</p>
        ) : null}
        {opts.length === 0 ? (
          <div className="sheet-cmd">
            {pendingApproval.command ?? pendingApproval.summary}
          </div>
        ) : (
          <div className="sheet-opts">
            {opts.map((o) => (
              <button
                key={o}
                type="button"
                className="btn-ghost w-full text-left"
                onClick={() => void resolveChoice(pendingApproval.id, o)}
              >
                {o}
              </button>
            ))}
          </div>
        )}
        <div className="sheet-actions">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => void resolveApproval(pendingApproval.id, "rejected")}
          >
            Reject
          </button>
          {opts.length === 0 ? (
            <button
              type="button"
              className="btn-approve"
              onClick={() => void resolveApproval(pendingApproval.id, "approved")}
            >
              Approve
            </button>
          ) : null}
        </div>
        {opts.length === 0 ? (
          <div className="sheet-keys">esc — reject&#160;&#160;&#183;&#160;&#160;return — approve</div>
        ) : null}
      </div>
    </div>
  );
}
