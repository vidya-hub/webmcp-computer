import { useEffect, useRef } from "react";
import type { ComputerId } from "@webmcp-computer/contract";
import { useShallow } from "zustand/react/shallow";
import { store, useStore } from "../store/index.ts";
import { selectShellChrome } from "../store/selectors.ts";
import { ApprovalDialog } from "./ApprovalDialog.tsx";
import { Dock } from "./Dock.tsx";
import { Inspector } from "./inspector/Inspector.tsx";
import { MenuBar } from "./MenuBar.tsx";
import { Toasts } from "./Toasts.tsx";
import { play, unlockSound } from "./sound.ts";
import { Canvas } from "./wm/Canvas.tsx";
import { listenStreamFps } from "./wm/streamFps.ts";

const IDLE_MS = 60_000;

export function Shell() {
  const { idle, actingComputerId, timelineOpen, pendingApproval, apiOnline } =
    useStore(useShallow(selectShellChrome));
  const prevOnline = useRef<boolean | null>(null);
  const onlineCueAt = useRef(0);

  useEffect(() => {
    listenStreamFps();
  }, []);

  useEffect(() => {
    if (!pendingApproval) return;
    play("warning");
  }, [pendingApproval?.id]);

  useEffect(() => {
    if (prevOnline.current === null) {
      prevOnline.current = apiOnline;
      return;
    }
    if (prevOnline.current === apiOnline) return;
    prevOnline.current = apiOnline;
    const now = Date.now();
    if (now - onlineCueAt.current < 4000) return;
    onlineCueAt.current = now;
    play(apiOnline ? "connect" : "disconnect");
  }, [apiOnline]);

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
    const unlock = () => unlockSound();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const s = store.getState();
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
    <div className={`shell${idle && !actingComputerId ? " idle" : ""}`}>
      <MenuBar />
      <div className="desktop">
        <Canvas />
        <Toasts />
        <Dock />
      </div>
      {timelineOpen ? <Inspector /> : null}
      <ApprovalDialog />
    </div>
  );
}
