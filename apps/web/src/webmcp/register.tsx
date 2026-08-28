import { useStore } from "../store/index.ts";
import { MachineTools } from "./MachineTools.tsx";
import { WorkspaceTools } from "./WorkspaceTools.tsx";

export function ToolsHost() {
  const selected = useStore((s) => s.selectedComputer);
  return (
    <>
      <WorkspaceTools />
      {selected ? <MachineTools /> : null}
    </>
  );
}
