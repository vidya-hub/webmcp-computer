import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  isDetachedCommand,
  type Appearance,
  type BrowserState,
  type CommandResult,
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
import {
  applyTheme,
  applyWallpaper,
  readAppearance,
} from "./appearance.ts";
import {
  browserState,
  cdpAlive,
  clickSelector,
  closeTab,
  createTab,
  findText,
  navigate,
  reloadTab,
  selectTab,
  visibleText,
} from "./cdp.ts";
import * as desk from "./desktop.ts";
import * as sys from "./sys.ts";
import { HttpError } from "./http-error.ts";
import {
  ensureJail,
  formatBytes,
  hostname,
  resolveInJail,
} from "./jail.ts";

const execFileAsync = promisify(execFile);
const READ_CAP = 256 * 1024;

function cpuTimes(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    const t = c.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

async function cpuSample(): Promise<number> {
  const a = cpuTimes();
  await new Promise((r) => setTimeout(r, 120));
  const b = cpuTimes();
  const idle = b.idle - a.idle;
  const total = b.total - a.total;
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((1 - idle / total) * 100)));
}

export class LinuxMachine implements Machine {
  constructor(
    private readonly id: ComputerId,
    private readonly machineName: string,
  ) {}

  async snapshot(): Promise<ComputerState> {
    const total = os.totalmem();
    const used = total - os.freemem();
    let disk = { used: "0GB", total: "0GB" };
    try {
      const { stdout } = await execFileAsync("df", ["-k", ensureJail()], {
        timeout: 3000,
      });
      const line = stdout.trim().split("\n")[1];
      const cols = line?.split(/\s+/) ?? [];
      const t = Number(cols[1] ?? 0) * 1024;
      const u = Number(cols[2] ?? 0) * 1024;
      disk = { used: formatBytes(u), total: formatBytes(t) };
    } catch {
      /* */
    }
    let foreground = "unknown";
    try {
      const { stdout } = await execFileAsync(
        "xdotool",
        ["getwindowfocus", "getwindowname"],
        {
          timeout: 2000,
          env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ":1" },
        },
      );
      foreground = stdout.trim() || "unknown";
    } catch {
      /* */
    }
    return {
      id: this.id,
      name: this.machineName,
      os: "Ubuntu 24.04",
      hostname: hostname(),
      uptime: os.uptime(),
      cpuPercent: await cpuSample(),
      memory: { used: formatBytes(used), total: formatBytes(total) },
      disk,
      foregroundApplication: foreground,
      browserStatus: (await cdpAlive()) ? "running" : "stopped",
    };
  }

  async listFiles(pathInput: string): Promise<FileList> {
    const dir = resolveInJail(pathInput);
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      throw new HttpError(400, { error: "not a directory" });
    }
    const entries = names
      .sort((a, b) => a.localeCompare(b))
      .map((name) => {
        const full = path.join(dir, name);
        let type: "file" | "directory" = "file";
        try {
          type = fs.statSync(full).isDirectory() ? "directory" : "file";
        } catch {
          type = "file";
        }
        return { name, type };
      });
    return { path: dir, entries };
  }

  async readFile(
    pathInput: string,
  ): Promise<{ path: string; content: string }> {
    const file = resolveInJail(pathInput);
    let st: fs.Stats;
    try {
      st = fs.statSync(file);
    } catch {
      throw new HttpError(404, { error: "not a file" });
    }
    if (!st.isFile()) throw new HttpError(400, { error: "not a file" });
    if (st.size > READ_CAP) {
      throw new HttpError(400, { error: "file too large" });
    }
    return { path: file, content: fs.readFileSync(file, "utf8") };
  }

  async writeFile(
    pathInput: string,
    content: string,
  ): Promise<{ path: string }> {
    const file = resolveInJail(pathInput);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return { path: file };
  }

  async run(command: string, cwd?: string): Promise<CommandResult> {
    const dir = cwd ? resolveInJail(cwd) : ensureJail();
    if (isDetachedCommand(command)) return this.detach(command, dir);
    return this.wait(command, dir);
  }

  async appearance(): Promise<Appearance> {
    return readAppearance();
  }

  async setWallpaper(wallpaper: WallpaperId): Promise<Appearance> {
    return applyWallpaper(wallpaper);
  }

  async setTheme(theme: ThemeId): Promise<Appearance> {
    return applyTheme(theme);
  }

  async browser(): Promise<BrowserState> {
    return browserState();
  }

  async openUrl(url: string): Promise<BrowserState> {
    return navigate(url);
  }

  async listWindows(): Promise<DeskWindow[]> {
    return desk.listWindows();
  }

  async focusWindow(windowId: string): Promise<DeskWindow[]> {
    return desk.focusWindow(windowId);
  }

  async launchApp(app: LaunchApp): Promise<{ app: string }> {
    return desk.launchApp(app);
  }

  async screenshot(windowId?: string): Promise<Shot> {
    return desk.screenshot(windowId);
  }

  async mouseClick(opts: {
    x: number;
    y: number;
    button?: MouseButton;
    clicks?: number;
    windowId?: string;
  }): Promise<{ ok: true }> {
    return desk.mouseClick(opts);
  }

  async mouseDrag(opts: {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    windowId?: string;
  }): Promise<{ ok: true }> {
    return desk.mouseDrag(opts);
  }

  async scroll(opts: {
    dx?: number;
    dy?: number;
    x?: number;
    y?: number;
    windowId?: string;
  }): Promise<{ ok: true }> {
    return desk.scroll(opts);
  }

  async typeText(text: string): Promise<{ ok: true }> {
    return desk.typeText(text);
  }

  async key(keys: string): Promise<{ ok: true }> {
    return desk.key(keys);
  }

  async selectAll(): Promise<{ ok: true }> {
    return desk.selectAll();
  }

  async createDirectory(pathInput: string): Promise<{ path: string }> {
    const dir = resolveInJail(pathInput);
    fs.mkdirSync(dir, { recursive: true });
    return { path: dir };
  }

  async moveFile(
    fromInput: string,
    toInput: string,
  ): Promise<{ from: string; to: string }> {
    const from = resolveInJail(fromInput);
    const to = resolveInJail(toInput);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    return { from, to };
  }

  async deleteFile(pathInput: string): Promise<{ path: string }> {
    const file = resolveInJail(pathInput);
    fs.rmSync(file, { recursive: true, force: true });
    return { path: file };
  }

  async searchFiles(
    query: string,
    pathInput?: string,
  ): Promise<{ path: string; matches: string[] }> {
    const root = resolveInJail(pathInput ?? ".");
    const matches: string[] = [];
    const walk = (dir: string) => {
      let names: string[] = [];
      try {
        names = fs.readdirSync(dir);
      } catch {
        return;
      }
      for (const name of names) {
        if (matches.length >= 80) return;
        const full = path.join(dir, name);
        if (name.toLowerCase().includes(query.toLowerCase())) matches.push(full);
        try {
          if (fs.statSync(full).isDirectory()) walk(full);
        } catch {
          /* */
        }
      }
    };
    walk(root);
    return { path: root, matches };
  }

  async createTab(url: string): Promise<BrowserState> {
    return createTab(url);
  }

  async selectTab(tabId: string): Promise<BrowserState> {
    return selectTab(tabId);
  }

  async closeTab(tabId: string): Promise<BrowserState> {
    return closeTab(tabId);
  }

  async reloadTab(): Promise<BrowserState> {
    return reloadTab();
  }

  async visibleText(): Promise<{ text: string }> {
    return visibleText();
  }

  async findText(query: string) {
    return findText(query);
  }

  async clickSelector(selector: string): Promise<{ ok: true }> {
    return clickSelector(selector);
  }

  async listProcesses() {
    return sys.listProcesses();
  }

  async killProcess(pid: number) {
    return sys.killProcess(pid);
  }

  async listPorts() {
    return sys.listPorts();
  }

  async devServers() {
    return sys.devServers();
  }

  async installPackage(name: string) {
    return sys.installPackage(name);
  }

  async notify(title: string, body: string): Promise<void> {
    return sys.notify(title, body);
  }

  private wait(command: string, cwd: string): Promise<CommandResult> {
    return new Promise((resolve) => {
      const child = spawn("/bin/sh", ["-c", command], {
        cwd,
        env: process.env,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (b: Buffer) => {
        stdout += b.toString();
      });
      child.stderr.on("data", (b: Buffer) => {
        stderr += b.toString();
      });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
      }, 30_000);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr,
        });
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({
          exitCode: 1,
          stdout,
          stderr: err.message,
        });
      });
    });
  }

  private detach(command: string, cwd: string): Promise<CommandResult> {
    return new Promise((resolve) => {
      const child = spawn("/bin/sh", ["-c", command], {
        cwd,
        env: process.env,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let done = false;
      const finish = (result: CommandResult) => {
        if (done) return;
        done = true;
        try {
          child.unref();
        } catch {
          /* */
        }
        resolve(result);
      };
      const ok = () =>
        finish({
          exitCode: null,
          stdout,
          stderr: "",
          pid: child.pid,
          running: true,
        });
      const timer = setTimeout(ok, 8000);
      const onData = (b: Buffer) => {
        stdout += b.toString();
        if (/Local:\s|listening|ready/i.test(stdout)) {
          clearTimeout(timer);
          ok();
        }
      };
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);
      child.on("error", (err) => {
        clearTimeout(timer);
        finish({
          exitCode: 1,
          stdout,
          stderr: err.message,
          running: false,
        });
      });
    });
  }
}
