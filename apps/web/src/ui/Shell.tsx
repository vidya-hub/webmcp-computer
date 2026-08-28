import { useEffect, useState } from "react";
import type { ComputerId } from "@webmcp-computer/contract";
import { useWorkspace } from "../state/workspace-store.tsx";
import { ActionTimeline } from "./ActionTimeline.tsx";
import { ApprovalDialog } from "./ApprovalDialog.tsx";
import { Dock } from "./Dock.tsx";
import { MenuBar } from "./MenuBar.tsx";
import { Canvas } from "./wm/Canvas.tsx";

export function Shell() {
  const {
    webmcpReady,
    spawnComputer,
    computersRunning,
    computers,
    selectComputer,
    selectedComputer,
    actingComputerId,
    minimized,
    restoreComputer,
    pendingApproval,
    resolveApproval,
  } = useWorkspace();
  const [timelineOpen, setTimelineOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "Escape") {
        if (timelineOpen) return;
        if (pendingApproval) {
          e.preventDefault();
          void resolveApproval(pendingApproval.id, "rejected");
        }
        return;
      }
      if (e.key >= "1" && e.key <= "4") {
        const c = computers[Number(e.key) - 1];
        if (c) {
          e.preventDefault();
          restoreComputer(c.id);
          void selectComputer(c.id as ComputerId);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    computers,
    pendingApproval,
    resolveApproval,
    selectComputer,
    restoreComputer,
    timelineOpen,
  ]);

  return (
    <div className="shell">
      <MenuBar
        webmcpReady={webmcpReady}
        approval={Boolean(pendingApproval)}
        onTimeline={() => setTimelineOpen(true)}
      />
      <div className="desktop">
        <Canvas />
        {computers.length > 0 ? (
          <Dock
            computers={computers}
            selectedComputer={selectedComputer}
            actingComputerId={actingComputerId}
            minimized={minimized}
            computersRunning={computersRunning}
            onSelect={(id) => {
              restoreComputer(id);
              void selectComputer(id);
            }}
            onSpawn={() => void spawnComputer()}
          />
        ) : null}
      </div>
      <ApprovalDialog />
      <ActionTimeline
        open={timelineOpen}
        onClose={() => setTimelineOpen(false)}
      />
    </div>
  );
}
