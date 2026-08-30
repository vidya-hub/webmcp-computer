import { MachineTools } from "./MachineTools.tsx";
import { WorkspaceTools } from "./WorkspaceTools.tsx";

export function ToolsHost() {
  // Machine tools are always registered so an agent sees a stable tool list
  // from the moment it connects. Gating them on selectedComputer caused the
  // whole machine-tool set to churn (unregister/re-register) on selection
  // changes and transient poll failures. When nothing is selected the tools
  // return a helpful "select a computer first" result instead of erroring.
  return (
    <>
      <WorkspaceTools />
      <MachineTools />
    </>
  );
}
