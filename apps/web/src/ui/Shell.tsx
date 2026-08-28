import { useEffect } from "react";
import type { ComputerId } from "@webmcp-computer/contract";
import { useShallow } from "zustand/react/shallow";
import { store, useStore } from "../store/index.ts";
import { selectShellChrome } from "../store/selectors.ts";
import { ActionTimeline } from "./ActionTimeline.tsx";
import { ApprovalDialog } from "./ApprovalDialog.tsx";
import { BootSequence } from "./BootSequence.tsx";
import { Dock } from "./Dock.tsx";
import { MenuBar } from "./MenuBar.tsx";
import { Toasts } from "./Toasts.tsx";
import { blip } from "./sound.ts";
import { Canvas } from "./wm/Canvas.tsx";

const IDLE_MS = 60_000;

export function Shell() {
  const {
    justBooted,
    idle,
    actingComputerId,
    booted,
    bootNonce,
    timelineOpen,
    pendingApproval,
  } = useStore(useShallow(selectShellChrome));

  useEffect(() => {
    if (!pendingApproval) return;
    blip("chime");
  }, [pendingApproval?.id]);

  useEffect(() => {
    let last = Date.now();
    let timer = 0;
    const mark = () => {
      last = Date.now();
      store.getState().setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(function check() {
        if (Date.now() - last >= IDLE_MS) store.getState().setIdle(true);
      }, IDLE_MS);
    };
    mark();
    window.addEventListener("pointermove", mark, { passive: true });
    window.addEventListener("keydown", mark);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", mark);
      window.removeEventListener("keydown", mark);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const s = store.getState();
      if (!s.booted) return;
      if (e.key === "Escape") {
        if (s.timelineOpen) return;
        if (s.pendingApproval) {
          e.preventDefault();
          void s.resolveApproval(s.pendingApproval.id, "rejected");
        }
        return;
      }
      if (e.key === "Enter" && s.pendingApproval && !s.pendingApproval.options?.length) {
        e.preventDefault();
        void s.resolveApproval(s.pendingApproval.id, "approved");
        return;
      }
      if (e.key >= "1" && e.key <= "4") {
        const c = s.computers[Number(e.key) - 1];
        if (c) {
          e.preventDefault();
          s.restore(c.id);
          void s.selectComputer(c.id as ComputerId);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className={`shell${justBooted ? " booted-fresh" : ""}${
        idle && !actingComputerId ? " idle" : ""
      }`}
    >
      <MenuBar />
      <div className="desktop">
        <Canvas />
        <div className="grain" aria-hidden />
        <Toasts />
        <Dock />
      </div>
      <ApprovalDialog />
      <ActionTimeline
        open={timelineOpen}
        onClose={() => store.getState().setTimelineOpen(false)}
      />
      {!booted ? (
        <BootSequence key={bootNonce} onDone={() => store.getState().finishBoot()} />
      ) : null}
    </div>
  );
}
