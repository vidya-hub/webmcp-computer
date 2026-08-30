import type {
  ActivityEvent,
  Approval,
  Computer,
  ComputerId,
  TapeEvent,
  WorkspaceState,
} from "@webmcp-computer/contract";
import { api } from "../../api/client.ts";
import { fetchSnapshot } from "../snapshot.ts";
import type { StoreGet, StoreSet } from "../types.ts";

export type ServerSlice = {
  apiOnline: boolean;
  computers: Computer[];
  selectedComputer: ComputerId | null;
  pendingApproval: Approval | null;
  activity: ActivityEvent[];
  tape: TapeEvent[];
  computersRunning: number;
  webmcpReady: boolean;
  recordingComputerId: ComputerId | null;
  actingComputerId: ComputerId | null;
  actingVerb: string | null;
  beginAct: (verb: string) => void;
  endAct: () => void;
  selectComputer: (id: ComputerId) => Promise<void>;
  spawnComputer: (restoreArchiveId?: string) => Promise<void>;
  destroyComputer: (id: ComputerId) => Promise<void>;
  resolveApproval: (
    id: string,
    decision: "approved" | "rejected",
  ) => Promise<void>;
  resolveChoice: (id: string, choice: string) => Promise<void>;
  setWebmcpReady: (ready: boolean) => void;
  setRecordingComputerId: (id: ComputerId | null) => void;
  applyWorkspace: (w: WorkspaceState) => void;
  upsertComputer: (computer: Computer) => void;
  removeComputer: (id: ComputerId) => void;
  prependActivity: (event: ActivityEvent) => void;
  prependTape: (event: TapeEvent) => void;
  setPendingApproval: (approval: Approval | null) => void;
  setSelectedComputer: (id: ComputerId | null) => void;
  setApiOnline: (online: boolean) => void;
  replaceSnapshot: (input: {
    computers: Computer[];
    workspace: WorkspaceState;
  }) => void;
  clearSnapshot: () => void;
};

function runningCount(computers: Computer[]): number {
  return computers.filter((c) => c.status === "running").length;
}

export function createServerSlice(set: StoreSet, get: StoreGet): ServerSlice {
  return {
    apiOnline: false,
    computers: [],
    selectedComputer: null,
    pendingApproval: null,
    activity: [],
    tape: [],
    computersRunning: 0,
    webmcpReady: false,
    recordingComputerId: null,
    actingComputerId: null,
    actingVerb: null,

    beginAct: (verb) =>
      set({
        actingComputerId: get().selectedComputer,
        actingVerb: verb,
      }),
    endAct: () => set({ actingComputerId: null, actingVerb: null }),

    setWebmcpReady: (ready) => set({ webmcpReady: ready }),
    setRecordingComputerId: (id) => set({ recordingComputerId: id }),
    setApiOnline: (online) => set({ apiOnline: online }),
    setSelectedComputer: (id) => set({ selectedComputer: id }),
    setPendingApproval: (approval) =>
      set({
        pendingApproval:
          approval && approval.status === "pending" ? approval : null,
      }),

    applyWorkspace: (w) =>
      set((s) => ({
        selectedComputer: w.selectedComputer,
        pendingApproval: w.pendingApproval,
        activity: w.activityHead,
        computersRunning: w.computersRunning,
        // Older APIs omit this field; keep the live REC id so a mixed
        // deploy / select-away poll cannot wipe an in-progress recording.
        recordingComputerId:
          w.recordingComputerId !== undefined
            ? w.recordingComputerId
            : s.recordingComputerId,
      })),

    prependActivity: (event) =>
      set((s) => {
        if (s.activity.some((e) => e.id === event.id)) return {};
        return { activity: [event, ...s.activity].slice(0, 40) };
      }),

    prependTape: (event) =>
      set((s) => {
        // Replace an existing event by id: the same event is emitted
        // optimistically and again once before/after shots are recorded.
        const existing = s.tape.findIndex((e) => e.id === event.id);
        if (existing !== -1) {
          const tape = s.tape.slice();
          tape[existing] = event;
          return { tape };
        }
        return { tape: [event, ...s.tape].slice(0, 100) };
      }),

    upsertComputer: (computer) => {
      const computers = (() => {
        const list = get().computers;
        const i = list.findIndex((c) => c.id === computer.id);
        if (i === -1) return [...list, computer];
        const next = list.slice();
        next[i] = computer;
        return next;
      })();
      set({ computers, computersRunning: runningCount(computers) });
    },

    removeComputer: (id) => {
      const computers = get().computers.filter((c) => c.id !== id);
      set({ computers, computersRunning: runningCount(computers) });
    },

    replaceSnapshot: ({ computers, workspace }) => {
      set((s) => ({
        apiOnline: true,
        computers,
        selectedComputer: workspace.selectedComputer,
        pendingApproval: workspace.pendingApproval,
        activity: workspace.activityHead,
        computersRunning: workspace.computersRunning,
        recordingComputerId:
          workspace.recordingComputerId !== undefined
            ? workspace.recordingComputerId
            : s.recordingComputerId,
      }));
    },

    clearSnapshot: () => {
      set({
        apiOnline: false,
        computers: [],
        selectedComputer: null,
        pendingApproval: null,
        activity: [],
        computersRunning: 0,
        recordingComputerId: null,
      });
    },

    selectComputer: async (id) => {
      const w = await api<WorkspaceState>("/api/workspace/select", {
        method: "POST",
        headers: { "x-actor": "human" },
        body: JSON.stringify({ computerId: id }),
      });
      get().applyWorkspace(w);
    },

    spawnComputer: async (restoreArchiveId) => {
      await api("/api/computers", {
        method: "POST",
        headers: { "x-actor": "human" },
        body: JSON.stringify(restoreArchiveId ? { restoreArchiveId } : {}),
      });
      await fetchSnapshot(get);
    },

    destroyComputer: async (id) => {
      const req = api(`/api/computers/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "x-actor": "human" },
      }).then(
        () => fetchSnapshot(get),
        () => fetchSnapshot(get),
      );
      // DELETE blocks until approve/reject; poll so the sheet appears if WS is slow.
      window.setTimeout(() => void fetchSnapshot(get), 40);
      await req;
    },

    resolveApproval: async (id, decision) => {
      await api(
        `/api/approvals/${id}/${decision === "approved" ? "approve" : "reject"}`,
        { method: "POST" },
      );
      await fetchSnapshot(get);
    },

    resolveChoice: async (id, choice) => {
      await api(`/api/approvals/${id}/choose`, {
        method: "POST",
        body: JSON.stringify({ choice }),
      });
      await fetchSnapshot(get);
    },
  };
}
