import {
  HOME_JAIL_DEFAULT,
  isDetachedCommand,
  type Appearance,
  type BrowserState,
  type BrowserTab,
  type ComputerId,
  type ComputerState,
  type DeskWindow,
  type FileList,
  type LaunchApp,
  type Machine,
  type MouseButton,
  type Shot,
  type ThemeId,
  type WallpaperId,
} from "@webmcp-computer/contract";
import { HttpError } from "./http-error.ts";

type Node = { type: "directory" } | { type: "file"; content: string };

export class MemoryMachine implements Machine {
  private readonly started = Date.now();
  private readonly nodes = new Map<string, Node>();
  private look: Appearance;
  private tabs: BrowserTab[] = [];
  private activeTabId: string | null = null;
  private pidSeq = 1000;

  constructor(
    private readonly id: ComputerId,
    private readonly machineName: string,
    wallpaper: WallpaperId,
  ) {
    this.look = { name: machineName, theme: "dark", wallpaper };
    this.nodes.set(HOME_JAIL_DEFAULT, { type: "directory" });
    this.nodes.set(`${HOME_JAIL_DEFAULT}/project`, { type: "directory" });
    this.nodes.set(`${HOME_JAIL_DEFAULT}/project/package.json`, {
      type: "file",
      content: `${JSON.stringify(
        {
          name: "project",
          private: true,
          scripts: { dev: "vite --host 127.0.0.1 --port 5173" },
        },
        null,
        2,
      )}\n`,
    });
  }

  async snapshot(): Promise<ComputerState> {
    return {
      id: this.id,
      name: this.machineName,
      os: "Ubuntu 24.04",
      hostname: this.id,
      uptime: Math.floor((Date.now() - this.started) / 1000),
      cpuPercent: 4,
      memory: { used: "0.2GB", total: "4GB" },
      disk: { used: "1.0GB", total: "20GB" },
      foregroundApplication: this.tabs.length > 0 ? "Chromium" : "unknown",
      browserStatus: this.tabs.length > 0 ? "running" : "stopped",
    };
  }

  async listFiles(path: string): Promise<FileList> {
    const dir = this.resolve(path);
    const node = this.nodes.get(dir);
    if (!node || node.type !== "directory") {
      throw new HttpError(400, { error: "not a directory" });
    }
    const prefix = dir === "/" ? "/" : `${dir}/`;
    const names = new Map<string, "file" | "directory">();
    for (const key of this.nodes.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      if (!rest || rest.includes("/")) continue;
      const child = this.nodes.get(key);
      if (child) names.set(rest, child.type);
    }
    return {
      path: dir,
      entries: [...names.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, type]) => ({ name, type })),
    };
  }

  async readFile(path: string): Promise<{ path: string; content: string }> {
    const resolved = this.resolve(path);
    const node = this.nodes.get(resolved);
    if (!node || node.type !== "file") {
      throw new HttpError(404, { error: "not a file" });
    }
    return { path: resolved, content: node.content };
  }

  async writeFile(
    path: string,
    content: string,
  ): Promise<{ path: string }> {
    const resolved = this.resolve(path);
    this.ensureParents(resolved);
    this.nodes.set(resolved, { type: "file", content });
    return { path: resolved };
  }

  async run(command: string, cwd?: string): Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
    pid?: number;
    running?: boolean;
  }> {
    const root = this.resolve(cwd ?? HOME_JAIL_DEFAULT);
    if (isDetachedCommand(command)) {
      return {
        exitCode: null,
        stdout: "ready\n",
        stderr: "",
        pid: this.pidSeq++,
        running: true,
      };
    }
    const tokens = command.trim().split(/\s+/);
    const head = tokens[0] ?? "";
    if (head === "ls") {
      const target = tokens[1] ? this.resolveFrom(root, tokens[1]) : root;
      const listed = await this.listFiles(target);
      return {
        exitCode: 0,
        stdout: listed.entries.map((e) => e.name).join("\n") + (listed.entries.length ? "\n" : ""),
        stderr: "",
      };
    }
    if (head === "pwd") {
      return { exitCode: 0, stdout: `${root}\n`, stderr: "" };
    }
    if (head === "echo") {
      return { exitCode: 0, stdout: `${tokens.slice(1).join(" ")}\n`, stderr: "" };
    }
    if (head === "mkdir") {
      const target = this.resolveFrom(root, tokens[1] ?? "");
      this.ensureParents(target);
      this.nodes.set(target, { type: "directory" });
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (head === "cat") {
      const file = await this.readFile(this.resolveFrom(root, tokens[1] ?? ""));
      return { exitCode: 0, stdout: file.content, stderr: "" };
    }
    return { exitCode: 127, stdout: "", stderr: `${head}: command not found\n` };
  }

  async appearance(): Promise<Appearance> {
    return { ...this.look };
  }

  async setWallpaper(wallpaper: WallpaperId): Promise<Appearance> {
    this.look = { ...this.look, wallpaper };
    return { ...this.look };
  }

  async setTheme(theme: ThemeId): Promise<Appearance> {
    this.look = { ...this.look, theme };
    return { ...this.look };
  }

  async browser(): Promise<BrowserState> {
    return {
      activeTab: this.tabs.find((t) => t.id === this.activeTabId) ?? null,
      tabs: [...this.tabs],
    };
  }

  async openUrl(url: string): Promise<BrowserState> {
    const id = `tab-${this.tabs.length + 1}`;
    const tab: BrowserTab = { id, title: url, url };
    this.tabs.push(tab);
    this.activeTabId = id;
    return this.browser();
  }

  async listWindows(): Promise<DeskWindow[]> {
    return [];
  }

  async focusWindow(_windowId: string): Promise<DeskWindow[]> {
    return [];
  }

  async launchApp(app: LaunchApp): Promise<{ app: string }> {
    return { app };
  }

  async screenshot(_windowId?: string): Promise<Shot> {
    throw new HttpError(502, { error: "no display" });
  }

  async mouseClick(_opts: {
    x: number;
    y: number;
    button?: MouseButton;
    clicks?: number;
    windowId?: string;
  }): Promise<{ ok: true }> {
    return { ok: true };
  }

  async mouseDrag(_opts: {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    windowId?: string;
  }): Promise<{ ok: true }> {
    return { ok: true };
  }

  async scroll(_opts: {
    dx?: number;
    dy?: number;
    x?: number;
    y?: number;
    windowId?: string;
  }): Promise<{ ok: true }> {
    return { ok: true };
  }

  async typeText(_text: string): Promise<{ ok: true }> {
    return { ok: true };
  }

  async key(_keys: string): Promise<{ ok: true }> {
    return { ok: true };
  }

  async selectAll(): Promise<{ ok: true }> {
    return { ok: true };
  }

  async createDirectory(path: string): Promise<{ path: string }> {
    const dir = this.resolve(path);
    this.ensureParents(`${dir}/.`);
    this.nodes.set(dir, { type: "directory" });
    return { path: dir };
  }

  async moveFile(
    from: string,
    to: string,
  ): Promise<{ from: string; to: string }> {
    const src = this.resolve(from);
    const dest = this.resolve(to);
    const node = this.nodes.get(src);
    if (!node) throw new HttpError(404, { error: "not found" });
    this.ensureParents(dest);
    this.nodes.set(dest, node);
    this.nodes.delete(src);
    return { from: src, to: dest };
  }

  async deleteFile(path: string): Promise<{ path: string }> {
    const file = this.resolve(path);
    if (!this.nodes.has(file)) throw new HttpError(404, { error: "not found" });
    this.nodes.delete(file);
    return { path: file };
  }

  async searchFiles(
    query: string,
    path?: string,
  ): Promise<{ path: string; matches: string[] }> {
    const root = this.resolve(path ?? HOME_JAIL_DEFAULT);
    const q = query.toLowerCase();
    const matches = [...this.nodes.keys()].filter(
      (k) => k.startsWith(root) && k.toLowerCase().includes(q),
    );
    return { path: root, matches };
  }

  async createTab(url: string): Promise<BrowserState> {
    return this.openUrl(url);
  }

  async selectTab(tabId: string): Promise<BrowserState> {
    if (!this.tabs.some((t) => t.id === tabId)) {
      throw new HttpError(404, { error: "unknown tab" });
    }
    this.activeTabId = tabId;
    return this.browser();
  }

  async closeTab(tabId: string): Promise<BrowserState> {
    this.tabs = this.tabs.filter((t) => t.id !== tabId);
    if (this.activeTabId === tabId) {
      this.activeTabId = this.tabs[0]?.id ?? null;
    }
    return this.browser();
  }

  async reloadTab(): Promise<BrowserState> {
    return this.browser();
  }

  async visibleText(): Promise<{ text: string }> {
    return { text: this.tabs.map((t) => t.title).join("\n") };
  }

  async findText(query: string) {
    const { text } = await this.visibleText();
    const lines = text.split("\n").filter((l) => l.includes(query));
    return { query, count: lines.length, snippets: lines };
  }

  async clickSelector(_selector: string): Promise<{ ok: true }> {
    return { ok: true };
  }

  async listProcesses() {
    return { processes: [] as { pid: number; cpu: string; mem: string; cmd: string }[] };
  }

  async killProcess(pid: number) {
    return { pid };
  }

  async listPorts() {
    return { ports: [] as { port: number; proto: string; addr: string }[] };
  }

  async devServers() {
    return { servers: [] as { url: string; port: number }[] };
  }

  async installPackage(name: string) {
    return { name, stdout: "ok" };
  }

  async notify(_title: string, _body: string): Promise<void> {}

  private resolve(path: string): string {
    return this.resolveFrom(HOME_JAIL_DEFAULT, path);
  }

  private resolveFrom(base: string, path: string): string {
    const abs = path.startsWith("/") ? path : `${base}/${path}`;
    const parts: string[] = [];
    for (const seg of abs.split("/")) {
      if (!seg || seg === ".") continue;
      if (seg === "..") {
        parts.pop();
        continue;
      }
      parts.push(seg);
    }
    const resolved = `/${parts.join("/")}`;
    if (
      resolved !== HOME_JAIL_DEFAULT &&
      !resolved.startsWith(`${HOME_JAIL_DEFAULT}/`)
    ) {
      throw new HttpError(400, { error: "path outside jail" });
    }
    return resolved;
  }

  private ensureParents(path: string): void {
    const parts = path.split("/").filter(Boolean);
    let cur = "";
    for (let i = 0; i < parts.length - 1; i++) {
      cur += `/${parts[i]}`;
      const node = this.nodes.get(cur);
      if (!node) this.nodes.set(cur, { type: "directory" });
      else if (node.type !== "directory") {
        throw new HttpError(400, { error: "not a directory" });
      }
    }
  }
}
