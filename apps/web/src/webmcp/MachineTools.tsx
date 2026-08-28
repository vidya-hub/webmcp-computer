import { type MachineOp } from "@webmcp-computer/contract";
import { useWebMCP } from "usewebmcp";
import { api, toolResult } from "../api/client.ts";
import { useWorkspace } from "../state/workspace-store.tsx";

const EMPTY = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

function verbFor(op: MachineOp): string {
  switch (op.op) {
    case "snapshot":
      return "inspected";
    case "listFiles":
      return `listed ${op.path}`;
    case "readFile":
      return `read ${op.path}`;
    case "writeFile":
      return `wrote ${op.path}`;
    case "run":
      return `ran ${op.command}`;
    case "appearance":
      return "read appearance";
    case "setWallpaper":
      return `set wallpaper ${op.wallpaper}`;
    case "setTheme":
      return `set theme ${op.theme}`;
    case "browser":
      return "read browser";
      case "openUrl":
      return `opened ${op.url}`;
      default:
        return op.op;
  }
}

export function MachineTools() {
  const { beginAct, endAct } = useWorkspace();

  async function act(op: MachineOp) {
    beginAct(verbFor(op));
    try {
      const data = await api("/api/act", {
        method: "POST",
        body: JSON.stringify(op),
      });
      if (
        op.op === "screenshot" &&
        data &&
        typeof data === "object" &&
        "data" in data &&
        "mimeType" in data
      ) {
        const shot = data as { mimeType: string; data: string; path?: string };
        return toolResult(
          { captured: true, path: shot.path ?? null },
          shot,
        );
      }
      return toolResult(data);
    } finally {
      endAct();
    }
  }

  useWebMCP({
    name: "computer_get_state",
    description: "State of the selected computer.",
    inputSchema: EMPTY,
    annotations: { readOnlyHint: true },
    execute: async () => act({ op: "snapshot" }),
  });

  useWebMCP({
    name: "computer_list_files",
    description: "List files under a path (default home).",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      additionalProperties: false,
    } as const,
    annotations: { readOnlyHint: true },
    execute: async (input) =>
      act({
        op: "listFiles",
        path: String(input.path ?? "."),
      }),
  });

  useWebMCP({
    name: "computer_read_file",
    description: "Read a file on the selected computer.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    } as const,
    annotations: { readOnlyHint: true },
    execute: async (input) => act({ op: "readFile", path: String(input.path) }),
  });

  useWebMCP({
    name: "computer_write_file",
    description: "Write a file on the selected computer.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
      additionalProperties: false,
    } as const,
    execute: async (input) =>
      act({
        op: "writeFile",
        path: String(input.path),
        content: String(input.content),
      }),
  });

  useWebMCP({
    name: "computer_run_command",
    description: "Run a shell command on the selected computer. May wait for human approval.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: { type: "string" },
      },
      required: ["command"],
      additionalProperties: false,
    } as const,
    execute: async (input) =>
      act({
        op: "run",
        command: String(input.command),
        cwd: input.cwd !== undefined ? String(input.cwd) : undefined,
      }),
  });

  useWebMCP({
    name: "browser_get_state",
    description: "Chromium tabs on the selected computer.",
    inputSchema: EMPTY,
    annotations: { readOnlyHint: true },
    execute: async () => act({ op: "browser" }),
  });

  useWebMCP({
    name: "browser_open_url",
    description: "Navigate the visible Chromium on the selected computer.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
      additionalProperties: false,
    } as const,
    execute: async (input) => act({ op: "openUrl", url: String(input.url) }),
  });

  useWebMCP({
    name: "computer_get_appearance",
    description: "Wallpaper and theme of the selected computer.",
    inputSchema: EMPTY,
    annotations: { readOnlyHint: true },
    execute: async () => act({ op: "appearance" }),
  });

  useWebMCP({
    name: "computer_set_wallpaper",
    description: "Set XFCE wallpaper: void, carbon, dark-grid, arrows.",
    inputSchema: {
      type: "object",
      properties: {
        wallpaper: {
          type: "string",
          enum: ["void", "carbon", "dark-grid", "arrows"],
        },
      },
      required: ["wallpaper"],
      additionalProperties: false,
    } as const,
    execute: async (input) =>
      act({
        op: "setWallpaper",
        wallpaper: input.wallpaper as "void" | "carbon" | "dark-grid" | "arrows",
      }),
  });

  useWebMCP({
    name: "computer_set_theme",
    description: "Set XFCE theme dark or light.",
    inputSchema: {
      type: "object",
      properties: { theme: { type: "string", enum: ["dark", "light"] } },
      required: ["theme"],
      additionalProperties: false,
    } as const,
    execute: async (input) =>
      act({
        op: "setTheme",
        theme: input.theme as "dark" | "light",
      }),
  });

  useWebMCP({
    name: "computer_list_windows",
    description: "List visible XFCE windows on the selected computer.",
    inputSchema: EMPTY,
    annotations: { readOnlyHint: true },
    execute: async () => act({ op: "listWindows" }),
  });

  useWebMCP({
    name: "computer_focus_window",
    description: "Bring a window to the foreground by id from computer_list_windows.",
    inputSchema: {
      type: "object",
      properties: { windowId: { type: "string" } },
      required: ["windowId"],
      additionalProperties: false,
    } as const,
    execute: async (input) =>
      act({ op: "focusWindow", windowId: String(input.windowId) }),
  });

  useWebMCP({
    name: "computer_launch_app",
    description: "Open chromium, terminal, or files on the selected computer.",
    inputSchema: {
      type: "object",
      properties: {
        app: { type: "string", enum: ["chromium", "terminal", "files"] },
      },
      required: ["app"],
      additionalProperties: false,
    } as const,
    execute: async (input) =>
      act({
        op: "launchApp",
        app: input.app as "chromium" | "terminal" | "files",
      }),
  });

  useWebMCP({
    name: "computer_take_screenshot",
    description: "PNG of the desktop, or one window if windowId is set.",
    inputSchema: {
      type: "object",
      properties: { windowId: { type: "string" } },
      additionalProperties: false,
    } as const,
    annotations: { readOnlyHint: true },
    execute: async (input) =>
      act({
        op: "screenshot",
        windowId:
          input.windowId !== undefined ? String(input.windowId) : undefined,
      }),
  });

  useWebMCP({
    name: "computer_mouse_click",
    description: "Click on the guest desktop. Coords from a screenshot. clicks=2 for double-click.",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        button: { type: "string", enum: ["left", "right", "middle"] },
        clicks: { type: "number" },
        windowId: { type: "string" },
      },
      required: ["x", "y"],
      additionalProperties: false,
    } as const,
    execute: async (input) =>
      act({
        op: "mouseClick",
        x: Number(input.x),
        y: Number(input.y),
        button: input.button as "left" | "right" | "middle" | undefined,
        clicks: input.clicks !== undefined ? Number(input.clicks) : undefined,
        windowId:
          input.windowId !== undefined ? String(input.windowId) : undefined,
      }),
  });

  useWebMCP({
    name: "computer_mouse_drag",
    description: "Drag on the guest desktop.",
    inputSchema: {
      type: "object",
      properties: {
        fromX: { type: "number" },
        fromY: { type: "number" },
        toX: { type: "number" },
        toY: { type: "number" },
        windowId: { type: "string" },
      },
      required: ["fromX", "fromY", "toX", "toY"],
      additionalProperties: false,
    } as const,
    execute: async (input) =>
      act({
        op: "mouseDrag",
        fromX: Number(input.fromX),
        fromY: Number(input.fromY),
        toX: Number(input.toX),
        toY: Number(input.toY),
        windowId:
          input.windowId !== undefined ? String(input.windowId) : undefined,
      }),
  });

  useWebMCP({
    name: "computer_scroll",
    description: "Scroll the guest desktop. dy negative is up. dx is horizontal.",
    inputSchema: {
      type: "object",
      properties: {
        dx: { type: "number" },
        dy: { type: "number" },
        x: { type: "number" },
        y: { type: "number" },
        windowId: { type: "string" },
      },
      additionalProperties: false,
    } as const,
    execute: async (input) =>
      act({
        op: "scroll",
        dx: input.dx !== undefined ? Number(input.dx) : undefined,
        dy: input.dy !== undefined ? Number(input.dy) : undefined,
        x: input.x !== undefined ? Number(input.x) : undefined,
        y: input.y !== undefined ? Number(input.y) : undefined,
        windowId:
          input.windowId !== undefined ? String(input.windowId) : undefined,
      }),
  });

  useWebMCP({
    name: "computer_type",
    description: "Type text into the focused guest window.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    } as const,
    execute: async (input) => act({ op: "typeText", text: String(input.text) }),
  });

  useWebMCP({
    name: "computer_key",
    description: "Press a key chord in the guest, e.g. Return, Tab, ctrl+a, ctrl+c.",
    inputSchema: {
      type: "object",
      properties: { keys: { type: "string" } },
      required: ["keys"],
      additionalProperties: false,
    } as const,
    execute: async (input) => act({ op: "key", keys: String(input.keys) }),
  });

  useWebMCP({
    name: "computer_select_all",
    description: "Select all in the focused guest window (ctrl+a).",
    inputSchema: EMPTY,
    execute: async () => act({ op: "selectAll" }),
  });

  useWebMCP({
    name: "computer_create_directory",
    description: "Create a directory in the home jail.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    } as const,
    execute: async (input) =>
      act({ op: "createDirectory", path: String(input.path) }),
  });

  useWebMCP({
    name: "computer_move_file",
    description: "Move or rename a file in the home jail.",
    inputSchema: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
      required: ["from", "to"],
      additionalProperties: false,
    } as const,
    execute: async (input) =>
      act({ op: "moveFile", from: String(input.from), to: String(input.to) }),
  });

  useWebMCP({
    name: "computer_delete_file",
    description: "Delete a file. Waits for human approval.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    } as const,
    execute: async (input) => act({ op: "deleteFile", path: String(input.path) }),
  });

  useWebMCP({
    name: "computer_search_files",
    description: "Find files in the home jail whose names contain query.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        path: { type: "string" },
      },
      required: ["query"],
      additionalProperties: false,
    } as const,
    annotations: { readOnlyHint: true },
    execute: async (input) =>
      act({
        op: "searchFiles",
        query: String(input.query),
        path: input.path !== undefined ? String(input.path) : undefined,
      }),
  });

  useWebMCP({
    name: "browser_create_tab",
    description: "Open a URL in a new Chromium tab.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
      additionalProperties: false,
    } as const,
    execute: async (input) => act({ op: "createTab", url: String(input.url) }),
  });

  useWebMCP({
    name: "browser_select_tab",
    description: "Switch the visible Chromium tab by id from browser_get_state.",
    inputSchema: {
      type: "object",
      properties: { tabId: { type: "string" } },
      required: ["tabId"],
      additionalProperties: false,
    } as const,
    execute: async (input) => act({ op: "selectTab", tabId: String(input.tabId) }),
  });

  useWebMCP({
    name: "browser_close_tab",
    description: "Close a Chromium tab by id.",
    inputSchema: {
      type: "object",
      properties: { tabId: { type: "string" } },
      required: ["tabId"],
      additionalProperties: false,
    } as const,
    execute: async (input) => act({ op: "closeTab", tabId: String(input.tabId) }),
  });

  useWebMCP({
    name: "browser_reload",
    description: "Reload the active Chromium tab.",
    inputSchema: EMPTY,
    execute: async () => act({ op: "reloadTab" }),
  });

  useWebMCP({
    name: "browser_get_visible_text",
    description: "Inner text of the active Chromium page.",
    inputSchema: EMPTY,
    annotations: { readOnlyHint: true },
    execute: async () => act({ op: "visibleText" }),
  });

  useWebMCP({
    name: "browser_find_text",
    description: "Find query in the visible Chromium page text.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    } as const,
    annotations: { readOnlyHint: true },
    execute: async (input) => act({ op: "findText", query: String(input.query) }),
  });

  useWebMCP({
    name: "browser_click",
    description: "Click a CSS selector on the active Chromium page.",
    inputSchema: {
      type: "object",
      properties: { selector: { type: "string" } },
      required: ["selector"],
      additionalProperties: false,
    } as const,
    execute: async (input) =>
      act({ op: "clickSelector", selector: String(input.selector) }),
  });

  useWebMCP({
    name: "browser_screenshot",
    description:
      "PNG of the active Chromium tab. Full page by default, capped at 16384px.",
    inputSchema: {
      type: "object",
      properties: { fullPage: { type: "boolean" } },
      additionalProperties: false,
    } as const,
    annotations: { readOnlyHint: true },
    execute: async (input) =>
      act({
        op: "browserScreenshot",
        fullPage: input.fullPage !== false,
      }),
  });

  useWebMCP({
    name: "computer_get_processes",
    description: "Running processes on the selected computer.",
    inputSchema: EMPTY,
    annotations: { readOnlyHint: true },
    execute: async () => act({ op: "listProcesses" }),
  });

  useWebMCP({
    name: "computer_kill_process",
    description: "SIGTERM a pid. Waits for human approval.",
    inputSchema: {
      type: "object",
      properties: { pid: { type: "number" } },
      required: ["pid"],
      additionalProperties: false,
    } as const,
    execute: async (input) => act({ op: "killProcess", pid: Number(input.pid) }),
  });

  useWebMCP({
    name: "computer_list_ports",
    description: "Listening TCP/UDP ports on the selected computer.",
    inputSchema: EMPTY,
    annotations: { readOnlyHint: true },
    execute: async () => act({ op: "listPorts" }),
  });

  useWebMCP({
    name: "computer_get_dev_servers",
    description: "localhost URLs inferred from listening ports.",
    inputSchema: EMPTY,
    annotations: { readOnlyHint: true },
    execute: async () => act({ op: "devServers" }),
  });

  useWebMCP({
    name: "computer_install_package",
    description: "apt-get install a package. Waits for human approval.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    } as const,
    execute: async (input) =>
      act({ op: "installPackage", name: String(input.name) }),
  });

  return null;
}
