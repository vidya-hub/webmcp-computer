import type { ComputerId } from "@webmcp-computer/contract";
import { useWorkspace } from "../state/workspace-store.tsx";

export function MachineList() {
  const { computers, selectedComputer, selectComputer } = useWorkspace();
  return (
    <aside className="machine-list">
      {computers.map((c) => {
        const selected = c.id === selectedComputer;
        const running = c.status === "running";
        return (
          <button
            key={c.id}
            type="button"
            className={`machine-card${selected ? " selected" : ""}${running ? "" : " stopped"}`}
            onClick={() => void selectComputer(c.id as ComputerId)}
          >
            <div className="name">
              {running ? "●" : "○"} {c.name.toLowerCase()}
            </div>
            <div className="meta">
              {c.os} · {c.role}
            </div>
          </button>
        );
      })}
    </aside>
  );
}
