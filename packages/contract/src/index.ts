export type ComputerId = string;
export type ComputerStatus = "starting" | "running" | "error" | "stopped";
export type Actor = "human" | "agent" | "system";
export type ThemeId = "dark" | "light";
export type WallpaperId = "void" | "dark-grid" | "carbon" | "arrows";
export type WorkspaceMode = "live";

export interface Computer {
  id: ComputerId;
  name: string;
  status: ComputerStatus;
  os: "Ubuntu 24.04";
  role: string;
}

export interface MemoryStat {
  used: string;
  total: string;
}

export interface ComputerState {
  id: ComputerId;
  name: string;
  os: "Ubuntu 24.04";
  hostname: string;
  uptime: number;
  cpuPercent: number;
  memory: MemoryStat;
  disk: MemoryStat;
  foregroundApplication: string;
  browserStatus: "running" | "stopped";
}

export interface FileEntry {
  name: string;
  type: "file" | "directory";
}

export interface FileList {
  path: string;
  entries: FileEntry[];
}

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  pid?: number;
  running?: boolean;
  reason?: string;
}

export interface Appearance {
  name: string;
  theme: ThemeId;
  wallpaper: WallpaperId;
}

export interface BrowserTab {
  id: string;
  title: string;
  url: string;
}

export interface BrowserState {
  activeTab: BrowserTab | null;
  tabs: BrowserTab[];
}

export interface ActivityEvent {
  id: string;
  at: string;
  actor: Actor;
  computerId: ComputerId | null;
  verb: string;
  detail: string;
}

export interface Approval {
  id: string;
  computerId: ComputerId;
  tool: string;
  summary: string;
  title: string;
  body: string;
  command?: string;
  options?: string[];
  choice?: string;
  status: "pending" | "approved" | "rejected";
}

export interface WorkspaceState {
  selectedComputer: ComputerId | null;
  pendingApproval: Approval | null;
  computersRunning: number;
  mode: WorkspaceMode;
  activityHead: ActivityEvent[];
}

export type LaunchApp = "chromium" | "terminal" | "files";
export type MouseButton = "left" | "right" | "middle";

export interface DeskWindow {
  id: string;
  title: string;
  className: string;
  focused: boolean;
}

export interface Shot {
  mimeType: "image/png";
  data: string;
  path: string;
}

export type MachineOp =
  | { op: "snapshot" }
  | { op: "listFiles"; path: string }
  | { op: "readFile"; path: string }
  | { op: "writeFile"; path: string; content: string }
  | { op: "run"; command: string; cwd?: string }
  | { op: "appearance" }
  | { op: "setWallpaper"; wallpaper: WallpaperId }
  | { op: "setTheme"; theme: ThemeId }
  | { op: "browser" }
  | { op: "openUrl"; url: string }
  | { op: "listWindows" }
  | { op: "focusWindow"; windowId: string }
  | { op: "launchApp"; app: LaunchApp }
  | { op: "screenshot"; windowId?: string }
  | {
      op: "mouseClick";
      x: number;
      y: number;
      button?: MouseButton;
      clicks?: number;
      windowId?: string;
    }
  | {
      op: "mouseDrag";
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
      windowId?: string;
    }
  | {
      op: "scroll";
      dx?: number;
      dy?: number;
      x?: number;
      y?: number;
      windowId?: string;
    }
  | { op: "typeText"; text: string }
  | { op: "key"; keys: string }
  | { op: "selectAll" }
  | { op: "createDirectory"; path: string }
  | { op: "moveFile"; from: string; to: string }
  | { op: "deleteFile"; path: string }
  | { op: "searchFiles"; query: string; path?: string }
  | { op: "createTab"; url: string }
  | { op: "selectTab"; tabId: string }
  | { op: "closeTab"; tabId: string }
  | { op: "reloadTab" }
  | { op: "visibleText" }
  | { op: "findText"; query: string }
  | { op: "clickSelector"; selector: string }
  | { op: "listProcesses" }
  | { op: "killProcess"; pid: number }
  | { op: "listPorts" }
  | { op: "devServers" }
  | { op: "installPackage"; name: string }
  | { op: "notify"; title: string; body: string };

export interface Machine {
  snapshot(): Promise<ComputerState>;
  listFiles(path: string): Promise<FileList>;
  readFile(path: string): Promise<{ path: string; content: string }>;
  writeFile(path: string, content: string): Promise<{ path: string }>;
  run(command: string, cwd?: string): Promise<CommandResult>;
  appearance(): Promise<Appearance>;
  setWallpaper(wallpaper: WallpaperId): Promise<Appearance>;
  setTheme(theme: ThemeId): Promise<Appearance>;
  browser(): Promise<BrowserState>;
  openUrl(url: string): Promise<BrowserState>;
  listWindows(): Promise<DeskWindow[]>;
  focusWindow(windowId: string): Promise<DeskWindow[]>;
  launchApp(app: LaunchApp): Promise<{ app: string }>;
  screenshot(windowId?: string): Promise<Shot>;
  mouseClick(opts: {
    x: number;
    y: number;
    button?: MouseButton;
    clicks?: number;
    windowId?: string;
  }): Promise<{ ok: true }>;
  mouseDrag(opts: {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    windowId?: string;
  }): Promise<{ ok: true }>;
  scroll(opts: {
    dx?: number;
    dy?: number;
    x?: number;
    y?: number;
    windowId?: string;
  }): Promise<{ ok: true }>;
  typeText(text: string): Promise<{ ok: true }>;
  key(keys: string): Promise<{ ok: true }>;
  selectAll(): Promise<{ ok: true }>;
  createDirectory(path: string): Promise<{ path: string }>;
  moveFile(from: string, to: string): Promise<{ from: string; to: string }>;
  deleteFile(path: string): Promise<{ path: string }>;
  searchFiles(
    query: string,
    path?: string,
  ): Promise<{ path: string; matches: string[] }>;
  createTab(url: string): Promise<BrowserState>;
  selectTab(tabId: string): Promise<BrowserState>;
  closeTab(tabId: string): Promise<BrowserState>;
  reloadTab(): Promise<BrowserState>;
  visibleText(): Promise<{ text: string }>;
  findText(query: string): Promise<{
    query: string;
    count: number;
    snippets: string[];
  }>;
  clickSelector(selector: string): Promise<{ ok: true }>;
  listProcesses(): Promise<{
    processes: { pid: number; cpu: string; mem: string; cmd: string }[];
  }>;
  killProcess(pid: number): Promise<{ pid: number }>;
  listPorts(): Promise<{
    ports: { port: number; proto: string; addr: string }[];
  }>;
  devServers(): Promise<{ servers: { url: string; port: number }[] }>;
  installPackage(name: string): Promise<{ name: string; stdout: string }>;
  notify(title: string, body: string): Promise<void>;
}

export interface SpawnSpec {
  name?: string;
  role?: string;
}

export interface ControlPlane {
  listComputers(): Promise<Computer[]>;
  workspace(): Promise<WorkspaceState>;
  select(id: ComputerId, actor: Actor): Promise<WorkspaceState>;
  spawn(spec: SpawnSpec, actor: Actor): Promise<Computer>;
  destroy(id: ComputerId, actor: Actor): Promise<unknown>;
  act(op: MachineOp, actor: Actor): Promise<unknown>;
  resolveApproval(
    id: string,
    decision: "approved" | "rejected",
  ): Promise<Approval>;
  resolveChoice(id: string, choice: string): Promise<Approval>;
  rename(id: ComputerId, name: string, actor: Actor): Promise<Computer>;
  requestChoice(
    question: string,
    options: string[],
    actor: Actor,
  ): Promise<{ choice: string } | { rejected: true }>;
}

export type WsEvent =
  | { type: "activity"; event: ActivityEvent }
  | { type: "approval"; approval: Approval }
  | { type: "selection"; computerId: ComputerId | null }
  | { type: "computer"; computer: Computer };

export const HOME_JAIL_DEFAULT = "/home/kasm-user";

const ALLOW_HEAD =
  /^(ls|cat|head|tail|pwd|whoami|uname|df|ps|echo|mkdir|touch|cp|mv|git|node|npm|npx|pnpm|yarn|python|python3|vite|which|env|date|wc|grep|find|file|stat|tree)(\s|$)/;

const DENY_HEAD =
  /^(rm|apt|apt-get|dpkg|kill|pkill|shutdown|reboot|poweroff|mkfs|dd|sudo|chmod|chown|curl|wget|systemctl|userdel)(\s|$)/;

const DETACH =
  /^(npm|pnpm|yarn)(\s+run)?\s+(dev|start)\b/;

export function requiresApproval(command: string): boolean {
  const t = command.trim();
  if (!t) return true;
  if (DENY_HEAD.test(t)) return true;
  if (ALLOW_HEAD.test(t)) return false;
  return true;
}

export function isDetachedCommand(command: string): boolean {
  return DETACH.test(command.trim());
}

export async function dispatch(
  machine: Machine,
  op: MachineOp,
): Promise<unknown> {
  switch (op.op) {
    case "snapshot":
      return machine.snapshot();
    case "listFiles":
      return machine.listFiles(op.path);
    case "readFile":
      return machine.readFile(op.path);
    case "writeFile":
      return machine.writeFile(op.path, op.content);
    case "run":
      return machine.run(op.command, op.cwd);
    case "appearance":
      return machine.appearance();
    case "setWallpaper":
      return machine.setWallpaper(op.wallpaper);
    case "setTheme":
      return machine.setTheme(op.theme);
    case "browser":
      return machine.browser();
    case "openUrl":
      return machine.openUrl(op.url);
    case "listWindows":
      return machine.listWindows();
    case "focusWindow":
      return machine.focusWindow(op.windowId);
    case "launchApp":
      return machine.launchApp(op.app);
    case "screenshot":
      return machine.screenshot(op.windowId);
    case "mouseClick":
      return machine.mouseClick(op);
    case "mouseDrag":
      return machine.mouseDrag(op);
    case "scroll":
      return machine.scroll(op);
    case "typeText":
      return machine.typeText(op.text);
    case "key":
      return machine.key(op.keys);
    case "selectAll":
      return machine.selectAll();
    case "createDirectory":
      return machine.createDirectory(op.path);
    case "moveFile":
      return machine.moveFile(op.from, op.to);
    case "deleteFile":
      return machine.deleteFile(op.path);
    case "searchFiles":
      return machine.searchFiles(op.query, op.path);
    case "createTab":
      return machine.createTab(op.url);
    case "selectTab":
      return machine.selectTab(op.tabId);
    case "closeTab":
      return machine.closeTab(op.tabId);
    case "reloadTab":
      return machine.reloadTab();
    case "visibleText":
      return machine.visibleText();
    case "findText":
      return machine.findText(op.query);
    case "clickSelector":
      return machine.clickSelector(op.selector);
    case "listProcesses":
      return machine.listProcesses();
    case "killProcess":
      return machine.killProcess(op.pid);
    case "listPorts":
      return machine.listPorts();
    case "devServers":
      return machine.devServers();
    case "installPackage":
      return machine.installPackage(op.name);
    case "notify":
      return machine.notify(op.title, op.body);
  }
}

export const WEBMCP_TOOLS = [
  "list_computers",
  "get_workspace_state",
  "select_computer",
  "spawn_computer",
  "destroy_computer",
  "computer_get_state",
  "computer_list_files",
  "computer_read_file",
  "computer_write_file",
  "computer_run_command",
  "browser_get_state",
  "browser_open_url",
  "computer_get_appearance",
  "computer_set_wallpaper",
  "computer_set_theme",
  "computer_list_windows",
  "computer_focus_window",
  "computer_launch_app",
  "computer_take_screenshot",
  "computer_mouse_click",
  "computer_mouse_drag",
  "computer_scroll",
  "computer_type",
  "computer_key",
  "computer_select_all",
  "computer_create_directory",
  "computer_move_file",
  "computer_delete_file",
  "computer_search_files",
  "browser_create_tab",
  "browser_select_tab",
  "browser_close_tab",
  "browser_reload",
  "browser_get_visible_text",
  "browser_find_text",
  "browser_click",
  "computer_get_processes",
  "computer_kill_process",
  "computer_list_ports",
  "computer_get_dev_servers",
  "computer_install_package",
  "computer_set_name",
  "request_human_choice",
] as const;

export type WebMcpToolName = (typeof WEBMCP_TOOLS)[number];

export {
  MAX_COMPUTERS,
  WALLPAPER_CYCLE,
  allocateName,
  generateComputerId,
  slugifyName,
  uniqueId,
} from "./names.ts";
