import { Shell } from "./ui/Shell.tsx";
import { ToolsHost } from "./webmcp/register.tsx";

export default function App() {
  return (
    <>
      <ToolsHost />
      <Shell />
    </>
  );
}
