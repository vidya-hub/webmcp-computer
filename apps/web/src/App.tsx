import { WorkspaceProvider } from "./state/workspace-store.tsx";
import { Shell } from "./ui/Shell.tsx";
import { ToolsHost } from "./webmcp/register.tsx";

export default function App() {
  return (
    <WorkspaceProvider>
      <ToolsHost />
      <Shell />
    </WorkspaceProvider>
  );
}
