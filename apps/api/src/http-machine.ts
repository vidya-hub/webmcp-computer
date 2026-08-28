import {
  type Appearance,
  type BrowserState,
  type ComputerState,
  type DeskWindow,
  type FileList,
  type LaunchApp,
  type Machine,
  type MachineOp,
  type MouseButton,
  type Shot,
  type ThemeId,
  type WallpaperId,
} from "@webmcp-computer/contract";
import { HttpError } from "./http-error.ts";

export class HttpMachine implements Machine {
  constructor(private readonly baseUrl: string) {}

  snapshot(): Promise<ComputerState> {
    return this.call({ op: "snapshot" }) as Promise<ComputerState>;
  }

  listFiles(path: string): Promise<FileList> {
    return this.call({ op: "listFiles", path }) as Promise<FileList>;
  }

  readFile(path: string): Promise<{ path: string; content: string }> {
    return this.call({ op: "readFile", path }) as Promise<{
      path: string;
      content: string;
    }>;
  }

  writeFile(path: string, content: string): Promise<{ path: string }> {
    return this.call({ op: "writeFile", path, content }) as Promise<{
      path: string;
    }>;
  }

  run(command: string, cwd?: string) {
    return this.call({ op: "run", command, cwd }) as ReturnType<Machine["run"]>;
  }

  appearance(): Promise<Appearance> {
    return this.call({ op: "appearance" }) as Promise<Appearance>;
  }

  setWallpaper(wallpaper: WallpaperId): Promise<Appearance> {
    return this.call({ op: "setWallpaper", wallpaper }) as Promise<Appearance>;
  }

  setTheme(theme: ThemeId): Promise<Appearance> {
    return this.call({ op: "setTheme", theme }) as Promise<Appearance>;
  }

  browser(): Promise<BrowserState> {
    return this.call({ op: "browser" }) as Promise<BrowserState>;
  }

  openUrl(url: string): Promise<BrowserState> {
    return this.call({ op: "openUrl", url }) as Promise<BrowserState>;
  }

  listWindows(): Promise<DeskWindow[]> {
    return this.call({ op: "listWindows" }) as Promise<DeskWindow[]>;
  }

  focusWindow(windowId: string): Promise<DeskWindow[]> {
    return this.call({ op: "focusWindow", windowId }) as Promise<DeskWindow[]>;
  }

  launchApp(app: LaunchApp): Promise<{ app: string }> {
    return this.call({ op: "launchApp", app }) as Promise<{ app: string }>;
  }

  screenshot(windowId?: string): Promise<Shot> {
    return this.call({ op: "screenshot", windowId }) as Promise<Shot>;
  }

  mouseClick(opts: {
    x: number;
    y: number;
    button?: MouseButton;
    clicks?: number;
    windowId?: string;
  }): Promise<{ ok: true }> {
    return this.call({ op: "mouseClick", ...opts }) as Promise<{ ok: true }>;
  }

  mouseDrag(opts: {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    windowId?: string;
  }): Promise<{ ok: true }> {
    return this.call({ op: "mouseDrag", ...opts }) as Promise<{ ok: true }>;
  }

  scroll(opts: {
    dx?: number;
    dy?: number;
    x?: number;
    y?: number;
    windowId?: string;
  }): Promise<{ ok: true }> {
    return this.call({ op: "scroll", ...opts }) as Promise<{ ok: true }>;
  }

  typeText(text: string): Promise<{ ok: true }> {
    return this.call({ op: "typeText", text }) as Promise<{ ok: true }>;
  }

  key(keys: string): Promise<{ ok: true }> {
    return this.call({ op: "key", keys }) as Promise<{ ok: true }>;
  }

  selectAll(): Promise<{ ok: true }> {
    return this.call({ op: "selectAll" }) as Promise<{ ok: true }>;
  }

  createDirectory(path: string): Promise<{ path: string }> {
    return this.call({ op: "createDirectory", path }) as Promise<{ path: string }>;
  }

  moveFile(from: string, to: string): Promise<{ from: string; to: string }> {
    return this.call({ op: "moveFile", from, to }) as Promise<{
      from: string;
      to: string;
    }>;
  }

  deleteFile(path: string): Promise<{ path: string }> {
    return this.call({ op: "deleteFile", path }) as Promise<{ path: string }>;
  }

  searchFiles(
    query: string,
    path?: string,
  ): Promise<{ path: string; matches: string[] }> {
    return this.call({ op: "searchFiles", query, path }) as Promise<{
      path: string;
      matches: string[];
    }>;
  }

  createTab(url: string): Promise<BrowserState> {
    return this.call({ op: "createTab", url }) as Promise<BrowserState>;
  }

  selectTab(tabId: string): Promise<BrowserState> {
    return this.call({ op: "selectTab", tabId }) as Promise<BrowserState>;
  }

  closeTab(tabId: string): Promise<BrowserState> {
    return this.call({ op: "closeTab", tabId }) as Promise<BrowserState>;
  }

  reloadTab(): Promise<BrowserState> {
    return this.call({ op: "reloadTab" }) as Promise<BrowserState>;
  }

  visibleText(): Promise<{ text: string }> {
    return this.call({ op: "visibleText" }) as Promise<{ text: string }>;
  }

  findText(query: string) {
    return this.call({ op: "findText", query }) as ReturnType<
      Machine["findText"]
    >;
  }

  clickSelector(selector: string): Promise<{ ok: true }> {
    return this.call({ op: "clickSelector", selector }) as Promise<{
      ok: true;
    }>;
  }

  listProcesses() {
    return this.call({ op: "listProcesses" }) as ReturnType<
      Machine["listProcesses"]
    >;
  }

  killProcess(pid: number) {
    return this.call({ op: "killProcess", pid }) as ReturnType<
      Machine["killProcess"]
    >;
  }

  listPorts() {
    return this.call({ op: "listPorts" }) as ReturnType<Machine["listPorts"]>;
  }

  devServers() {
    return this.call({ op: "devServers" }) as ReturnType<Machine["devServers"]>;
  }

  installPackage(name: string) {
    return this.call({ op: "installPackage", name }) as ReturnType<
      Machine["installPackage"]
    >;
  }

  notify(title: string, body: string): Promise<void> {
    return this.call({ op: "notify", title, body }) as Promise<void>;
  }

  browserScreenshot(fullPage?: boolean): Promise<Shot> {
    return this.call({ op: "browserScreenshot", fullPage }) as Promise<Shot>;
  }

  private async call(op: MachineOp): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/act`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(op),
      });
    } catch {
      throw new HttpError(502, { error: "bridge unreachable" });
    }
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { error: text };
    }
    if (!res.ok) {
      const payload =
        typeof body === "object" && body !== null
          ? (body as Record<string, unknown>)
          : { error: text };
      if (typeof payload.error !== "string" || !payload.error) {
        payload.error = res.statusText || "bridge error";
      }
      throw new HttpError(
        res.status === 400 || res.status === 404 ? res.status : 502,
        payload,
      );
    }
    return body;
  }
}
