import { useWorkspace } from "../state/workspace-store.tsx";

export function ApprovalDialog() {
  const { pendingApproval, resolveApproval, resolveChoice } = useWorkspace();
  if (!pendingApproval) return null;
  const opts = pendingApproval.options ?? [];
  return (
    <div className="overlay">
      <div className="approval">
        <div className="mark">! approval</div>
        <div className="mb-4 text-[12px] text-fog">{pendingApproval.computerId}</div>
        <h2>{pendingApproval.title || "Agent requests permission"}</h2>
        {pendingApproval.body ? (
          <p className="mb-4 text-[14px] leading-relaxed text-chalk">
            {pendingApproval.body}
          </p>
        ) : null}
        {opts.length === 0 ? (
          <div className="cmd">
            {pendingApproval.command ?? pendingApproval.summary}
          </div>
        ) : (
          <div className="mb-6 flex flex-col gap-2">
            {opts.map((o) => (
              <button
                key={o}
                type="button"
                className="btn-ghost w-full text-left"
                onClick={() => void resolveChoice(pendingApproval.id, o)}
              >
                {o} →
              </button>
            ))}
          </div>
        )}
        <div className="actions">
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
              Approve →
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
