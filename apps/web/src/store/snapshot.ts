import type { Computer, WorkspaceState } from "@webmcp-computer/contract";
import { api } from "../api/client.ts";
import type { StoreGet } from "./types.ts";

export async function fetchSnapshot(get: StoreGet): Promise<void> {
  try {
    const [c, w] = await Promise.all([
      api<{ computers: Computer[] }>("/api/computers"),
      api<WorkspaceState>("/api/workspace"),
    ]);
    // replaceSnapshot sets apiOnline: true.
    get().replaceSnapshot({ computers: c.computers, workspace: w });
  } catch {
    // A transient poll failure must NOT tear down the workspace: keep the last
    // known computers/selection so VNC iframes stay mounted and WebMCP machine
    // tools stay registered. Just surface the offline state.
    get().setApiOnline(false);
  }
}
