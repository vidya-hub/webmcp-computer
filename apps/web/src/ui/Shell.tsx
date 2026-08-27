import { useEffect } from "react";
import { Plus } from "lucide-react";
import type { ComputerId } from "@webmcp-computer/contract";
import { useWorkspace } from "../state/workspace-store.tsx";
import { ActivityFeed } from "./ActivityFeed.tsx";
import { ApprovalDialog } from "./ApprovalDialog.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { Canvas } from "./wm/Canvas.tsx";

export function Shell() {
  const {
    webmcpReady,
    spawnComputer,
    computersRunning,
    computers,
    selectComputer,
    pendingApproval,
    resolveApproval,
  } = useWorkspace();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "Escape" && pendingApproval) {
        e.preventDefault();
        void resolveApproval(pendingApproval.id, "rejected");
        return;
      }
      if (e.key >= "1" && e.key <= "4") {
        const c = computers[Number(e.key) - 1];
        if (c) {
          e.preventDefault();
          void selectComputer(c.id as ComputerId);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [computers, pendingApproval, resolveApproval, selectComputer]);

  return (
    <div className="shell">
      <header className="nav">
        <span className="nav-mark">~/ webmcp-computer</span>
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-axiom border border-slate bg-transparent text-paper hover:border-pewter"
            aria-label="spawn computer"
            disabled={computersRunning >= 4}
            onClick={() => void spawnComputer()}
          >
            <Plus size={14} strokeWidth={2} />
          </button>
        </div>
        <span className="nav-webmcp">
          {webmcpReady ? "WebMCP  ready" : "WebMCP  missing"}
        </span>
      </header>
      <div className="body">
        <Canvas />
        <ActivityFeed />
      </div>
      <StatusBar />
      <ApprovalDialog />
    </div>
  );
}
