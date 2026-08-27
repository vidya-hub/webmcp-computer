import { useWorkspace } from "../state/workspace-store.tsx";
import { MachineTools } from "./MachineTools.tsx";
import { WorkspaceTools } from "./WorkspaceTools.tsx";

export function ToolsHost() {
  const { selectedComputer } = useWorkspace();
  return (
    <>
      <WorkspaceTools />
      {selectedComputer ? <MachineTools key={selectedComputer} /> : null}
    </>
  );
}
