import { type ComputerId } from "@webmcp-computer/contract";
import { useWebMCP } from "usewebmcp";
import { api, toolResult } from "../api/client.ts";
import { useWorkspace } from "../state/workspace-store.tsx";

const EMPTY = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

export function WorkspaceTools() {
  const { computers, selectedComputer, pendingApproval, computersRunning, activity } =
    useWorkspace();

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
        return toolResult({ computers });
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
        return toolResult({
          selectedComputer,
          pendingApproval,
          computersRunning,
          mode: "live",
          activityHead: activity,
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
      "Create a computer. Pass name or omit for a generated id. Returns the new id.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        role: { type: "string" },
      },
      additionalProperties: false,
    } as const,
    execute: async (input) => {
      const data = await api("/api/computers", {
        method: "POST",
        headers: { "x-actor": "agent" },
        body: JSON.stringify({
          name: input.name !== undefined ? String(input.name) : undefined,
          role: input.role !== undefined ? String(input.role) : undefined,
        }),
      });
      return toolResult(data);
    },
  });

  useWebMCP({
    name: "destroy_computer",
    description:
      "Destroy a computer by id. Waits for the human to Approve or Reject.",
    inputSchema: {
      type: "object",
      properties: {
        computerId: { type: "string" },
      },
      required: ["computerId"],
      additionalProperties: false,
    } as const,
    execute: async (input) => {
      const id = String(input.computerId);
      const data = await api(`/api/computers/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "x-actor": "agent" },
      });
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
      const data = await api("/api/choice", {
        method: "POST",
        headers: { "x-actor": "agent" },
        body: JSON.stringify({
          question: String(input.question),
          options,
        }),
      });
      return toolResult(data);
    },
  });

  return null;
}
