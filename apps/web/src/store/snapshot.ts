import type { Computer, WorkspaceState } from "@webmcp-computer/contract";
import { api } from "../api/client.ts";
import type { StoreGet } from "./types.ts";

export async function fetchSnapshot(get: StoreGet): Promise<void> {
  try {
    await api("/api/health");
    const [c, w] = await Promise.all([
      api<{ computers: Computer[] }>("/api/computers"),
      api<WorkspaceState>("/api/workspace"),
    ]);
    get().replaceSnapshot({ computers: c.computers, workspace: w });
  } catch {
    get().clearSnapshot();
  }
}
