import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initializeWebMCPPolyfill } from "@mcp-b/webmcp-polyfill";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import App from "./App.tsx";
import { probeWebmcp, startSync } from "./store/sync.ts";
import "./styles/tokens.css";
import "./styles/axiom.css";

initializeWebMCPPolyfill();
patchNativeRegisterTool();
probeWebmcp();
window.setTimeout(probeWebmcp, 50);
startSync();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/** Native Chrome rejects partial ToolAnnotations and overlapping registerTool calls. */
function patchNativeRegisterTool(): void {
  const ctx = document.modelContext;
  if (!ctx?.registerTool) return;
  const orig = ctx.registerTool.bind(ctx);
  let chain = Promise.resolve();
  const patched = (
    tool: unknown,
    opts?: { signal?: AbortSignal },
  ): Promise<void> => {
    if (tool && typeof tool === "object" && "annotations" in tool) {
      const raw = (tool as { annotations?: Record<string, unknown> }).annotations;
      if (raw && typeof raw === "object") {
        (tool as { annotations: Record<string, boolean> }).annotations = {
          readOnlyHint: Boolean(raw.readOnlyHint),
          untrustedContentHint: Boolean(raw.untrustedContentHint),
          consequentialHint: Boolean(
            raw.consequentialHint ?? raw.destructiveHint,
          ),
        };
      }
    }
    const run = () => Promise.resolve(orig(tool, opts));
    const next = chain.then(run, run);
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  try {
    Object.defineProperty(ctx, "registerTool", {
      configurable: true,
      value: patched,
    });
  } catch {
    /* native accessor may be frozen */
  }
}
