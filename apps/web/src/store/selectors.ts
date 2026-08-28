import type { AppStore } from "./types.ts";

export function selectDock(s: AppStore) {
  return {
    computers: s.computers,
    selectedComputer: s.selectedComputer,
    actingComputerId: s.actingComputerId,
    minimized: s.minimized,
    computersRunning: s.computersRunning,
  };
}

export function selectApproval(s: AppStore) {
  return {
    pendingApproval: s.pendingApproval,
    resolveApproval: s.resolveApproval,
    resolveChoice: s.resolveChoice,
  };
}

export function selectShellChrome(s: AppStore) {
  return {
    justBooted: s.justBooted,
    idle: s.idle,
    actingComputerId: s.actingComputerId,
    booted: s.booted,
    bootNonce: s.bootNonce,
    timelineOpen: s.timelineOpen,
    pendingApproval: s.pendingApproval,
  };
}

export function selectMenuBar(s: AppStore) {
  return {
    webmcpReady: s.webmcpReady,
    approval: Boolean(s.pendingApproval),
    activity: s.activity,
    sound: s.sound,
  };
}

export function windowSlice(id: string) {
  return (s: AppStore) => ({
    bounds: s.windows[id],
    selected: s.selectedComputer === id,
    acting: s.actingComputerId === id,
    actingVerb: s.actingComputerId === id ? s.actingVerb : null,
    dragActive: s.draggingId === id,
    maximized: s.maximizedId === id,
    lifecycle: s.lifecycle[id] ?? null,
    minimized: s.minimized.includes(id),
  });
}
