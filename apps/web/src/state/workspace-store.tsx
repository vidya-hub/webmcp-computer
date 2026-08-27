import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  type ActivityEvent,
  type Approval,
  type Computer,
  type ComputerId,
  type WorkspaceState,
} from "@webmcp-computer/contract";
import { api } from "../api/client.ts";

type Store = {
  apiOnline: boolean;
  computers: Computer[];
  selectedComputer: ComputerId | null;
  pendingApproval: Approval | null;
  activity: ActivityEvent[];
  computersRunning: number;
  webmcpReady: boolean;
  actingComputerId: ComputerId | null;
  actingVerb: string | null;
  beginAct: (verb: string) => void;
  endAct: () => void;
  selectComputer: (id: ComputerId) => Promise<void>;
  spawnComputer: () => Promise<void>;
  destroyComputer: (id: ComputerId) => Promise<void>;
  minimized: string[];
  minimizeComputer: (id: string) => void;
  restoreComputer: (id: string) => void;
  resolveApproval: (id: string, decision: "approved" | "rejected") => Promise<void>;
  resolveChoice: (id: string, choice: string) => Promise<void>;
};

const Ctx = createContext<Store | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [apiOnline, setApiOnline] = useState(false);
  const [computers, setComputers] = useState<Computer[]>([]);
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [actingComputerId, setActingComputerId] = useState<ComputerId | null>(
    null,
  );
  const [actingVerb, setActingVerb] = useState<string | null>(null);
  const [minimized, setMinimized] = useState<string[]>([]);
  const webmcpReady = Boolean(
    document.modelContext &&
      typeof document.modelContext.registerTool === "function",
  );

  const refresh = useCallback(async () => {
    try {
      await api("/api/health");
      const [c, w] = await Promise.all([
        api<{ computers: Computer[] }>("/api/computers"),
        api<WorkspaceState>("/api/workspace"),
      ]);
      setApiOnline(true);
      setComputers(c.computers);
      setWorkspace(w);
      setMinimized((ids) =>
        ids.filter((id) => c.computers.some((x) => x.id === id)),
      );
    } catch {
      setApiOnline(false);
      setComputers([]);
      setWorkspace(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    let ws: WebSocket | undefined;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const open = window.setTimeout(() => {
      ws = new WebSocket(`${proto}://${location.host}/api/ws`);
      ws.onmessage = () => {
        void refresh();
      };
    }, 100);
    const t = setInterval(() => void refresh(), 8000);
    return () => {
      window.clearTimeout(open);
      clearInterval(t);
      if (!ws) return;
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.addEventListener("open", () => ws?.close());
        return;
      }
      if (ws.readyState === WebSocket.OPEN) ws.close();
    };
  }, [refresh]);

  const selectComputer = useCallback(async (id: ComputerId) => {
    const w = await api<WorkspaceState>("/api/workspace/select", {
      method: "POST",
      headers: { "x-actor": "human" },
      body: JSON.stringify({ computerId: id }),
    });
    setWorkspace(w);
  }, []);

  const beginAct = useCallback(
    (verb: string) => {
      setActingComputerId(workspace?.selectedComputer ?? null);
      setActingVerb(verb);
    },
    [workspace?.selectedComputer],
  );

  const endAct = useCallback(() => {
    setActingComputerId(null);
    setActingVerb(null);
  }, []);

  const spawnComputer = useCallback(async () => {
    await api("/api/computers", {
      method: "POST",
      headers: { "x-actor": "human" },
      body: "{}",
    });
    await refresh();
  }, [refresh]);

  const destroyComputer = useCallback(async (id: ComputerId) => {
    void api(`/api/computers/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "x-actor": "human" },
    }).then(() => refresh(), () => refresh());
  }, [refresh]);

  const minimizeComputer = useCallback((id: string) => {
    setMinimized((ids) => (ids.includes(id) ? ids : [...ids, id]));
  }, []);

  const restoreComputer = useCallback((id: string) => {
    setMinimized((ids) => ids.filter((x) => x !== id));
  }, []);

  const resolveApproval = useCallback(
    async (id: string, decision: "approved" | "rejected") => {
      await api(`/api/approvals/${id}/${decision === "approved" ? "approve" : "reject"}`, {
        method: "POST",
      });
      await refresh();
    },
    [refresh],
  );

  const resolveChoice = useCallback(
    async (id: string, choice: string) => {
      await api(`/api/approvals/${id}/choose`, {
        method: "POST",
        body: JSON.stringify({ choice }),
      });
      await refresh();
    },
    [refresh],
  );

  const value = useMemo<Store>(
    () => ({
      apiOnline,
      computers,
      selectedComputer: workspace?.selectedComputer ?? null,
      pendingApproval: workspace?.pendingApproval ?? null,
      activity: workspace?.activityHead ?? [],
      computersRunning: workspace?.computersRunning ?? 0,
      webmcpReady,
      actingComputerId,
      actingVerb,
      beginAct,
      endAct,
      selectComputer,
      spawnComputer,
      destroyComputer,
      minimized,
      minimizeComputer,
      restoreComputer,
      resolveApproval,
      resolveChoice,
    }),
    [
      apiOnline,
      computers,
      workspace,
      webmcpReady,
      actingComputerId,
      actingVerb,
      beginAct,
      endAct,
      selectComputer,
      spawnComputer,
      destroyComputer,
      minimized,
      minimizeComputer,
      restoreComputer,
      resolveApproval,
      resolveChoice,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace(): Store {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspace outside provider");
  return ctx;
}
