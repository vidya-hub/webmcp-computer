import { useWorkspace } from "../state/workspace-store.tsx";
import type { ComputerId } from "@webmcp-computer/contract";

function clip(s: string, n = 72) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function ActivityFeed() {
  const { activity, selectComputer } = useWorkspace();
  return (
    <aside className="activity">
      <details open>
        <summary>ACTIVITY</summary>
        {activity.length === 0 ? (
          <div className="mt-4 text-[12px] text-steel">no events</div>
        ) : null}
        {activity.map((e) => {
          const ts = new Date(e.at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          });
          const line = clip(`${e.verb} ${e.detail}`.trim());
          return (
            <button
              key={e.id}
              type="button"
              title={`${e.verb} ${e.detail}`}
              className={`activity-row ${e.actor} mt-1 w-full text-left`}
              onClick={() => {
                if (e.computerId) void selectComputer(e.computerId as ComputerId);
              }}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-paper">{line}</span>
                <span className="ts shrink-0">{ts}</span>
              </div>
              <div className="mt-0.5 flex gap-2 text-[12px] text-steel">
                <span className="actor">{e.actor.toUpperCase()}</span>
                {e.computerId ? <span>{e.computerId}</span> : null}
              </div>
            </button>
          );
        })}
      </details>
    </aside>
  );
}
