import { type ComputerId, type TapeEvent } from "@webmcp-computer/contract";
import { useWebMCP } from "usewebmcp";
import { api, toolResult } from "../api/client.ts";
import { store } from "../store/index.ts";

const EMPTY = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

export function WorkspaceTools() {
  useWebMCP({
    name: "list_computers",
    description: "List computers in this workspace.",
    inputSchema: EMPTY,
    annotations: { readOnlyHint: true },
    execute: async () => {
      try {
        const data = await api<{ computers: unknown }>("/api/computers");
        return toolResult(data);
      } catch {
        return toolResult({
          stale: true,
          note: "API unreachable; showing the last cached view.",
          computers: store.getState().computers,
        });
      }
    },
  });

  useWebMCP({
    name: "get_workspace_state",
    description: "Selected computer, approvals, running count.",
    inputSchema: EMPTY,
    annotations: { readOnlyHint: true },
    execute: async () => {
      try {
        return toolResult(await api("/api/workspace"));
      } catch {
        const s = store.getState();
        return toolResult({
          stale: true,
          note: "API unreachable; showing the last cached view.",
          selectedComputer: s.selectedComputer,
          pendingApproval: s.pendingApproval,
          computersRunning: s.computersRunning,
          mode: "live",
          activityHead: s.activity,
          recordingComputerId: s.recordingComputerId,
        });
      }
    },
  });

  useWebMCP({
    name: "select_computer",
    description:
      "Select a computer by id from list_computers. Machine tools then apply to that computer.",
    inputSchema: {
      type: "object",
      properties: {
        computerId: { type: "string", description: "Id from list_computers" },
      },
      required: ["computerId"],
      additionalProperties: false,
    } as const,
    execute: async (input) => {
      const computerId = String(input.computerId) as ComputerId;
      const data = await api("/api/workspace/select", {
        method: "POST",
        headers: { "x-actor": "agent" },
        body: JSON.stringify({ computerId }),
      });
      return toolResult(data);
    },
  });

  useWebMCP({
    name: "spawn_computer",
    description:
      "Create a computer. Pass name or omit for a generated id. Optionally restore a saved home archive (list_file_archives) into it. Returns the new id.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        role: { type: "string" },
        restoreArchiveId: {
          type: "string",
          description: "Id from list_file_archives to seed the home directory.",
        },
      },
      additionalProperties: false,
    } as const,
    annotations: { title: "Spawn computer" },
    execute: async (input) => {
      const data = await api(
        "/api/computers",
        {
          method: "POST",
          headers: { "x-actor": "agent" },
          body: JSON.stringify({
            name: input.name !== undefined ? String(input.name) : undefined,
            role: input.role !== undefined ? String(input.role) : undefined,
            restoreArchiveId:
              input.restoreArchiveId !== undefined
                ? String(input.restoreArchiveId)
                : undefined,
          }),
        },
        130_000,
      );
      return toolResult(data);
    },
  });

  useWebMCP({
    name: "list_file_archives",
    description:
      "List saved home-file archives that can be restored into a new computer via spawn_computer. Only the human (via the destroy dialog) can create one.",
    inputSchema: EMPTY,
    annotations: { title: "List file archives", readOnlyHint: true },
    execute: async () => {
      const data = await api("/api/archives");
      return toolResult(data);
    },
  });

  useWebMCP({
    name: "delete_file_archive",
    description: "Permanently delete a saved home-file archive by id.",
    inputSchema: {
      type: "object",
      properties: { archiveId: { type: "string" } },
      required: ["archiveId"],
      additionalProperties: false,
    } as const,
    annotations: { title: "Delete file archive", destructiveHint: true },
    execute: async (input) => {
      const data = await api(
        `/api/archives/${encodeURIComponent(String(input.archiveId))}`,
        { method: "DELETE", headers: { "x-actor": "agent" } },
      );
      return toolResult(data);
    },
  });

  useWebMCP({
    name: "destroy_computer",
    description:
      "Destroy a computer by id. Pauses up to 120s for the human to Approve or Reject; the human can also choose to save the computer's files before it is destroyed (agents cannot make that choice). A rejection returns {success:false, reason}.",
    inputSchema: {
      type: "object",
      properties: {
        computerId: {
          type: "string",
          description: "Id from list_computers.",
        },
      },
      required: ["computerId"],
      additionalProperties: false,
    } as const,
    annotations: { title: "Destroy computer", destructiveHint: true },
    execute: async (input) => {
      const id = String(input.computerId);
      const data = await api(
        `/api/computers/${encodeURIComponent(id)}`,
        { method: "DELETE", headers: { "x-actor": "agent" } },
        130_000,
      );
      return toolResult(data);
    },
  });

  useWebMCP({
    name: "computer_set_name",
    description: "Rename a computer. Pass computerId and name.",
    inputSchema: {
      type: "object",
      properties: {
        computerId: { type: "string" },
        name: { type: "string" },
      },
      required: ["computerId", "name"],
      additionalProperties: false,
    } as const,
    execute: async (input) => {
      const id = String(input.computerId);
      const data = await api(`/api/computers/${encodeURIComponent(id)}/name`, {
        method: "POST",
        headers: { "x-actor": "agent" },
        body: JSON.stringify({ name: String(input.name) }),
      });
      return toolResult(data);
    },
  });

  useWebMCP({
    name: "request_human_choice",
    description:
      "Ask the human to pick one option. Blocks until they choose or reject.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string" },
        options: { type: "array", items: { type: "string" } },
      },
      required: ["question", "options"],
      additionalProperties: false,
    } as const,
    execute: async (input) => {
      const options = Array.isArray(input.options)
        ? input.options.map(String)
        : [];
      const data = await api(
        "/api/choice",
        {
          method: "POST",
          headers: { "x-actor": "agent" },
          body: JSON.stringify({ question: String(input.question), options }),
        },
        130_000,
      );
      return toolResult(data);
    },
  });

  useWebMCP({
    name: "workspace_arrange_windows",
    description:
      "Rearrange the desktop windows on the page. 'tile' lays them out in a grid, 'cascade' overlaps them offset from the center, 'focus-selected' enlarges the selected computer's window.",
    inputSchema: {
      type: "object",
      properties: {
        layout: {
          type: "string",
          enum: ["tile", "cascade", "focus-selected"],
          description: "How to arrange the open windows.",
        },
      },
      required: ["layout"],
      additionalProperties: false,
    } as const,
    annotations: { title: "Arrange windows" },
    execute: async (input) => {
      const layout = input.layout as
        | "tile"
        | "cascade"
        | "focus-selected";
      const count = store.getState().arrange(layout);
      return toolResult({ arranged: count, layout });
    },
  });

  useWebMCP({
    name: "get_recent_actions",
    description:
      "The most recent taped actions across the workspace (what agents/humans just did). Metadata only — no screenshots or large payloads.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "How many recent actions to return (default 15).",
        },
      },
      additionalProperties: false,
    } as const,
    annotations: { readOnlyHint: true },
    execute: async (input) => {
      const limit = Math.max(1, Math.min(100, Number(input.limit ?? 15) || 15));
      try {
        const data = await api<{ events: TapeEvent[] }>("/api/tape");
        const events = (data.events ?? []).slice(0, limit).map((e) => ({
          at: e.at,
          actor: e.actor,
          op: e.op,
          detail: e.detail,
          error: e.error,
        }));
        return toolResult({ events });
      } catch {
        return toolResult({
          stale: true,
          note: "API unreachable.",
          events: [],
        });
      }
    },
  });

  useWebMCP({
    name: "list_recorded_actions",
    description:
      "List saved recipes (named, replayable sequences of computer actions).",
    inputSchema: EMPTY,
    annotations: { title: "List recipes", readOnlyHint: true },
    execute: async () => {
      const data = await api<{ actions: unknown[] }>("/api/actions");
      const actions = (data.actions ?? []).map((a) => {
        const r = a as { id: string; name: string; description: string; source: string; steps: unknown[] };
        return { id: r.id, name: r.name, description: r.description, source: r.source, stepCount: r.steps?.length ?? 0 };
      });
      return toolResult({ actions });
    },
  });

  useWebMCP({
    name: "get_recorded_action",
    description:
      "Get a saved recipe's full step list by id, so you can inspect or adapt it.",
    inputSchema: {
      type: "object",
      properties: { actionId: { type: "string" } },
      required: ["actionId"],
      additionalProperties: false,
    } as const,
    annotations: { title: "Get recipe", readOnlyHint: true },
    execute: async (input) => {
      const data = await api(
        `/api/actions/${encodeURIComponent(String(input.actionId))}`,
      );
      return toolResult(data);
    },
  });

  useWebMCP({
    name: "replay_recorded_action",
    description:
      "Replay a saved recipe on the SELECTED computer. Pass actionId or name. Any steps needing approval pause once (up to 120s) for the human; a rejection returns {success:false, reason}.",
    inputSchema: {
      type: "object",
      properties: {
        actionId: { type: "string" },
        name: { type: "string", description: "Recipe name (if no actionId)." },
        speed: { type: "number", description: "Playback speed multiplier (default 1)." },
      },
      additionalProperties: false,
    } as const,
    annotations: { title: "Replay recipe" },
    execute: async (input) => {
      let id = input.actionId !== undefined ? String(input.actionId) : "";
      if (!id && input.name !== undefined) {
        const data = await api<{ actions: { id: string; name: string }[] }>(
          "/api/actions",
        );
        id = data.actions?.find((a) => a.name === String(input.name))?.id ?? "";
        if (!id) return toolResult({ error: `No recipe named ${input.name}` });
      }
      if (!id) return toolResult({ error: "actionId or name required" });
      const data = await api(
        `/api/actions/${encodeURIComponent(id)}/replay`,
        {
          method: "POST",
          headers: { "x-actor": "agent" },
          body: JSON.stringify({
            speed: input.speed !== undefined ? Number(input.speed) : 1,
          }),
        },
        130_000,
      );
      return toolResult(data);
    },
  });

  useWebMCP({
    name: "save_recorded_action",
    description:
      "Save a new recipe from an explicit step list. Each step is {kind:'op', op:<a machine op like computer_run_command's underlying {op:'run',command}>} or {kind:'wait', ms} or {kind:'note', text}. Recipes containing dangerous ops require human approval to save.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        steps: { type: "array", items: { type: "object" } },
      },
      required: ["name", "steps"],
      additionalProperties: false,
    } as const,
    annotations: { title: "Save recipe" },
    execute: async (input) => {
      const data = await api(
        "/api/actions",
        {
          method: "POST",
          headers: { "x-actor": "agent" },
          body: JSON.stringify({
            name: String(input.name),
            description:
              input.description !== undefined ? String(input.description) : "",
            steps: input.steps ?? [],
          }),
        },
        130_000,
      );
      return toolResult(data);
    },
  });

  useWebMCP({
    name: "delete_recorded_action",
    description: "Delete a saved recipe by id.",
    inputSchema: {
      type: "object",
      properties: { actionId: { type: "string" } },
      required: ["actionId"],
      additionalProperties: false,
    } as const,
    annotations: { title: "Delete recipe", destructiveHint: true },
    execute: async (input) => {
      const data = await api(
        `/api/actions/${encodeURIComponent(String(input.actionId))}`,
        { method: "DELETE", headers: { "x-actor": "agent" } },
      );
      return toolResult(data);
    },
  });

  return null;
}
