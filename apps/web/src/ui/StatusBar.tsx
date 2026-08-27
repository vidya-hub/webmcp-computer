import type { ComputerId } from "@webmcp-computer/contract";
import { useWorkspace } from "../state/workspace-store.tsx";

export function StatusBar() {
  const {
    apiOnline,
    computers,
    selectedComputer,
    actingComputerId,
    actingVerb,
    pendingApproval,
    minimized,
    restoreComputer,
    selectComputer,
  } = useWorkspace();

  if (!apiOnline) {
    return <footer className="status offline">api offline</footer>;
  }

  return (
    <footer className="status">
      <div className="taskbar">
        {computers.map((c) => {
          const acting = c.id === actingComputerId;
          const selected = c.id === selectedComputer;
          const min = minimized.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              title={acting && actingVerb ? `AGENT  ${actingVerb}` : c.name}
              className={`task-chip${selected ? " selected" : ""}${acting ? " acting" : ""}${min ? " min" : ""}`}
              onClick={() => {
                restoreComputer(c.id);
                void selectComputer(c.id as ComputerId);
              }}
            >
              <span className={c.status === "running" ? "wm-dot on" : "wm-dot"}>
                {c.status === "running" ? "●" : "○"}
              </span>
              {c.name}
            </button>
          );
        })}
      </div>
      <span className="status-meta">
        {pendingApproval ? "! approval" : `${computers.length} live`}
      </span>
    </footer>
  );
}
