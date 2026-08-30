import { type MachineOp } from "@webmcp-computer/contract";
import { useWebMCP } from "usewebmcp";
import { api, toolResult } from "../api/client.ts";
import { store } from "../store/index.ts";
import { play } from "../ui/sound.ts";

const EMPTY = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

// Ops that hold the HTTP request open awaiting human approval (up to 120s).
// They need a longer client deadline than the default 30s.
const APPROVAL_OPS = new Set<MachineOp["op"]>([
  "run",
  "deleteFile",
  "killProcess",
  "installPackage",
]);
const APPROVAL_TIMEOUT_MS = 130_000;

// Coerce a tool input to a finite number or throw a clean, agent-readable error
// so NaN never reaches the API/bridge.
function num(value: unknown, name: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`${name} must be a number, got ${JSON.stringify(value)}`);
  }
  return n;
}

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
  async function act(op: MachineOp, timeoutMs?: number) {
    if (!store.getState().selectedComputer) {
      return toolResult({
        error:
          "No computer selected. Call list_computers then select_computer first.",
      });
    }
    store.getState().beginAct(verbFor(op));
    try {
      const timeout =
        timeoutMs ??
        (APPROVAL_OPS.has(op.op) ? APPROVAL_TIMEOUT_MS : undefined);
      const data = await api(
        "/api/act",
        { method: "POST", body: JSON.stringify(op) },
        timeout,
      );
      // Return screenshots as an image content block, never as base64 text —
      // stringifying a multi-MB PNG into a text block blows the agent's context.
      if (
        (op.op === "screenshot" || op.op === "browserScreenshot") &&
        data &&
        typeof data === "object" &&
        "data" in data &&
        "mimeType" in data
      ) {
        const shot = data as { mimeType: string; data: string; path?: string };
        return toolResult({ captured: true, path: shot.path ?? null }, shot);
      }
      return toolResult(data);
    } catch (err) {
      if (!APPROVAL_OPS.has(op.op) && op.op !== "snapshot" && op.op !== "listFiles" && op.op !== "readFile" && op.op !== "appearance" && op.op !== "browser") {
        play("error");
      }
      throw err;
    } finally {
      store.getState().endAct();
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
    description:
      "Write (create or overwrite) a file on the selected computer. Paths are confined to the guest home directory; a path outside it is rejected with a 400.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path, relative to or inside the guest home dir.",
        },
        content: { type: "string", description: "Full file contents to write." },
      },
      required: ["path", "content"],
      additionalProperties: false,
    } as const,
    annotations: { title: "Write file", destructiveHint: true },
    execute: async (input) =>
      act({
        op: "writeFile",
        path: String(input.path),
        content: String(input.content),
      }),
  });

  useWebMCP({
    name: "computer_run_command",
    description:
      "Run a shell command on the selected computer and return {stdout, stderr, exitCode}. Simple read-style commands run immediately; anything with a shell metacharacter (; | & `` $() etc.) or a dangerous head (rm, sudo, apt, kill…) pauses up to 120s for human approval and the call blocks until decided — a rejected command returns {success:false, reason}.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The command line to run." },
        cwd: {
          type: "string",
          description: "Working directory inside the home jail. Optional.",
        },
      },
      required: ["command"],
      additionalProperties: false,
    } as const,
    annotations: { title: "Run command", destructiveHint: true },
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
      properties: {
        url: { type: "string", description: "Absolute URL including scheme." },
      },
      required: ["url"],
      additionalProperties: false,
    } as const,
    annotations: { title: "Open URL", openWorldHint: true },
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
    description: "Set the desktop wallpaper: void, carbon, dark-grid, arrows.",
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
    annotations: { title: "Set wallpaper", idempotentHint: true },
    execute: async (input) =>
      act({
        op: "setWallpaper",
        wallpaper: input.wallpaper as "void" | "carbon" | "dark-grid" | "arrows",
      }),
  });

  useWebMCP({
    name: "computer_set_theme",
    description: "Set the desktop theme dark or light.",
    inputSchema: {
      type: "object",
      properties: { theme: { type: "string", enum: ["dark", "light"] } },
      required: ["theme"],
      additionalProperties: false,
    } as const,
    annotations: { title: "Set theme", idempotentHint: true },
    execute: async (input) =>
      act({
        op: "setTheme",
        theme: input.theme as "dark" | "light",
      }),
  });

  useWebMCP({
    name: "computer_list_windows",
    description:
      "List the open windows (Openbox) on the selected computer, with their ids for focus/screenshot.",
    inputSchema: EMPTY,
    annotations: { title: "List windows", readOnlyHint: true },
    execute: async () => act({ op: "listWindows" }),
  });

  useWebMCP({
    name: "computer_focus_window",
    description: "Bring a window to the foreground by id from computer_list_windows.",
    inputSchema: {
      type: "object",
      properties: {
        windowId: {
          type: "string",
          description: "Window id from computer_list_windows.",
        },
      },
      required: ["windowId"],
      additionalProperties: false,
    } as const,
    annotations: { title: "Focus window", idempotentHint: true },
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
    description:
      "Capture a PNG of the guest desktop (or one window if windowId is set), returned as an image. Coordinates for mouse/scroll tools are pixels in this image's space (1280×800, top-left origin).",
    inputSchema: {
      type: "object",
      properties: {
        windowId: {
          type: "string",
          description: "Capture just this window (id from list_windows).",
        },
      },
      additionalProperties: false,
    } as const,
    annotations: { title: "Take screenshot", readOnlyHint: true },
    execute: async (input) =>
      act({
        op: "screenshot",
        windowId:
          input.windowId !== undefined ? String(input.windowId) : undefined,
      }),
  });

  useWebMCP({
    name: "computer_mouse_click",
    description:
      "Click at pixel (x, y) in the guest desktop's own 1280×800 coordinate space (top-left origin) — coordinates come from computer_take_screenshot, not the host page. clicks=2 for a double-click.",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number", description: "X pixel, 0 = left edge." },
        y: { type: "number", description: "Y pixel, 0 = top edge." },
        button: { type: "string", enum: ["left", "right", "middle"] },
        clicks: { type: "number", description: "1 (default) or 2." },
        windowId: { type: "string" },
      },
      required: ["x", "y"],
      additionalProperties: false,
    } as const,
    annotations: { title: "Mouse click" },
    execute: async (input) =>
      act({
        op: "mouseClick",
        x: num(input.x, "x"),
        y: num(input.y, "y"),
        button: input.button as "left" | "right" | "middle" | undefined,
        clicks: input.clicks !== undefined ? num(input.clicks, "clicks") : undefined,
        windowId:
          input.windowId !== undefined ? String(input.windowId) : undefined,
      }),
  });

  useWebMCP({
    name: "computer_mouse_drag",
    description:
      "Drag from (fromX, fromY) to (toX, toY) in the guest's 1280×800 pixel space (top-left origin).",
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
    annotations: { title: "Mouse drag" },
    execute: async (input) =>
      act({
        op: "mouseDrag",
        fromX: num(input.fromX, "fromX"),
        fromY: num(input.fromY, "fromY"),
        toX: num(input.toX, "toX"),
        toY: num(input.toY, "toY"),
        windowId:
          input.windowId !== undefined ? String(input.windowId) : undefined,
      }),
  });

  useWebMCP({
    name: "computer_scroll",
    description:
      "Scroll the guest desktop by wheel steps. dy negative scrolls up, positive down; dx is horizontal. Optional x/y position the pointer first (1280×800 pixel space).",
    inputSchema: {
      type: "object",
      properties: {
        dx: { type: "number", description: "Horizontal wheel steps." },
        dy: { type: "number", description: "Vertical wheel steps; negative = up." },
        x: { type: "number" },
        y: { type: "number" },
        windowId: { type: "string" },
      },
      additionalProperties: false,
    } as const,
    annotations: { title: "Scroll" },
    execute: async (input) =>
      act({
        op: "scroll",
        dx: input.dx !== undefined ? num(input.dx, "dx") : undefined,
        dy: input.dy !== undefined ? num(input.dy, "dy") : undefined,
        x: input.x !== undefined ? num(input.x, "x") : undefined,
        y: input.y !== undefined ? num(input.y, "y") : undefined,
        windowId:
          input.windowId !== undefined ? String(input.windowId) : undefined,
      }),
  });

  useWebMCP({
    name: "computer_type",
    description:
      "Type text into the focused guest window at ~60 WPM (xdotool --delay 200). After ~600 characters the remainder is injected immediately so the request stays under 120s.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    } as const,
    execute: async (input) => {
      const text = String(input.text);
      const timeout = Math.min(120_000, 1000 + text.length * 220) + 2_000;
      let ticks: number | undefined;
      if (store.getState().sound) {
        let i = 0;
        ticks = window.setInterval(() => {
          if (!store.getState().sound || i >= text.length) {
            if (ticks) window.clearInterval(ticks);
            return;
          }
          play("typing", { volume: 0.25 });
          i += 1;
        }, 200);
      }
      try {
        return await act({ op: "typeText", text }, timeout);
      } finally {
        if (ticks) window.clearInterval(ticks);
      }
    },
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
    description: "Move or rename a file within the guest home directory.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Existing path." },
        to: { type: "string", description: "Destination path." },
      },
      required: ["from", "to"],
      additionalProperties: false,
    } as const,
    annotations: { title: "Move file", destructiveHint: true },
    execute: async (input) =>
      act({ op: "moveFile", from: String(input.from), to: String(input.to) }),
  });

  useWebMCP({
    name: "computer_delete_file",
    description:
      "Delete a file in the guest home directory. Pauses up to 120s for human approval; a rejection returns {success:false, reason}.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    } as const,
    annotations: { title: "Delete file", destructiveHint: true },
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
      properties: {
        url: { type: "string", description: "Absolute URL including scheme." },
      },
      required: ["url"],
      additionalProperties: false,
    } as const,
    annotations: { title: "New tab", openWorldHint: true },
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
    annotations: { title: "Close tab", destructiveHint: true },
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
      "Capture the active Chromium tab as an image. Viewport only by default; set fullPage:true for the whole scrollable page (capped at 16384px).",
    inputSchema: {
      type: "object",
      properties: {
        fullPage: {
          type: "boolean",
          description: "Capture the full scrollable page instead of the viewport.",
        },
      },
      additionalProperties: false,
    } as const,
    annotations: { title: "Browser screenshot", readOnlyHint: true },
    execute: async (input) =>
      act({
        op: "browserScreenshot",
        fullPage: input.fullPage === true,
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
    description:
      "Send SIGTERM to a process by pid (from computer_get_processes). Pauses up to 120s for human approval.",
    inputSchema: {
      type: "object",
      properties: {
        pid: { type: "number", description: "Process id to terminate." },
      },
      required: ["pid"],
      additionalProperties: false,
    } as const,
    annotations: { title: "Kill process", destructiveHint: true },
    execute: async (input) =>
      act({ op: "killProcess", pid: num(input.pid, "pid") }),
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
    description:
      "Install a Debian package with apt-get on the selected computer. Pauses up to 120s for human approval; may take a few minutes.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Package name, e.g. ripgrep." },
      },
      required: ["name"],
      additionalProperties: false,
    } as const,
    annotations: { title: "Install package", destructiveHint: true, openWorldHint: true },
    execute: async (input) =>
      act({ op: "installPackage", name: String(input.name) }),
  });

  return null;
}
