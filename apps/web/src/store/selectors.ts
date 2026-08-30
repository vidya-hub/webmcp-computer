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
    idle: s.idle,
    actingComputerId: s.actingComputerId,
    timelineOpen: s.timelineOpen,
    pendingApproval: s.pendingApproval,
    apiOnline: s.apiOnline,
  };
}

export function selectMenuBar(s: AppStore) {
  return {
    webmcpReady: s.webmcpReady,
    approval: Boolean(s.pendingApproval),
    activity: s.activity,
    sound: s.sound,
    apiOnline: s.apiOnline,
    recordingComputerId: s.recordingComputerId,
    toastsVisible: s.toastsVisible,
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
    recording: s.recordingComputerId === id,
  });
}
