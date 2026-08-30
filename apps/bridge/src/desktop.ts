import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { HttpError } from "./http-error.ts";

const execFileAsync = promisify(execFile);

function env(): NodeJS.ProcessEnv {
  return { ...process.env, DISPLAY: process.env.DISPLAY ?? ":1" };
}

async function xd(args: string[], timeout = 8_000): Promise<string> {
  try {
    const { stdout } = await execFileAsync("xdotool", args, {
      timeout,
      env: env(),
    });
    return stdout.trim();
  } catch (err) {
    throw new HttpError(502, {
      error: err instanceof Error ? err.message : "xdotool failed",
    });
  }
}

export type DeskWindow = {
  id: string;
  title: string;
  className: string;
  focused: boolean;
};

export async function listWindows(): Promise<DeskWindow[]> {
  let ids: string[] = [];
  try {
    const raw = await xd(["search", "--onlyvisible", "--name", "."]);
    ids = raw.split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
  let focused = "";
  try {
    focused = await xd(["getactivewindow"]);
  } catch {
    focused = "";
  }
  const out: DeskWindow[] = [];
  for (const id of ids) {
    let title = "";
    let className = "";
    try {
      title = await xd(["getwindowname", id]);
    } catch {
      title = "";
    }
    try {
      className = await xd(["getwindowclassname", id]);
    } catch {
      className = "";
    }
    out.push({ id, title, className, focused: id === focused });
  }
  return out;
}

export async function focusWindow(windowId: string): Promise<DeskWindow[]> {
  await xd(["windowactivate", "--sync", windowId]);
  return listWindows();
}

const APPS = {
  chromium: ["chromium", "about:blank"],
  terminal: ["xterm"],
  files: ["pcmanfm"],
} as const;

export async function launchApp(
  app: keyof typeof APPS,
): Promise<{ app: string }> {
  const cmd = APPS[app];
  if (!cmd) throw new HttpError(400, { error: "unknown app" });
  const { spawn } = await import("node:child_process");
  const child = spawn(cmd[0], cmd.slice(1), {
    detached: true,
    stdio: "ignore",
    env: env(),
  });
  // A missing binary emits 'error'; with no listener Node throws
  // ERR_UNHANDLED_ERROR and crashes the bridge.
  child.on("error", (err) => console.error("launchApp:", err.message));
  child.unref();
  return { app };
}

export async function screenshot(
  windowId?: string,
): Promise<{ mimeType: "image/png"; data: string; path: string }> {
  const dir = path.join(
    process.env.HOME ?? "/home/kasm-user",
    "Notes",
    "shots",
  );
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(
    dir,
    `${stamp}${windowId ? `-${windowId}` : ""}.png`,
  );
  try {
    if (windowId) {
      await xd(["windowactivate", "--sync", windowId]);
      await execFileAsync("scrot", ["-u", "-o", file], {
        timeout: 10_000,
        env: env(),
      });
    } else {
      await execFileAsync("scrot", ["-o", file], {
        timeout: 10_000,
        env: env(),
      });
    }
    const buf = fs.readFileSync(file);
    return {
      mimeType: "image/png",
      data: buf.toString("base64"),
      path: file,
    };
  } catch (err) {
    throw new HttpError(502, {
      error: err instanceof Error ? err.message : "screenshot failed",
    });
  }
}

function btn(button?: string): string {
  if (button === "right") return "3";
  if (button === "middle") return "2";
  return "1";
}

export async function mouseClick(opts: {
  x: number;
  y: number;
  button?: string;
  clicks?: number;
  windowId?: string;
}): Promise<{ ok: true }> {
  const repeats = String(Math.max(1, Math.min(3, opts.clicks ?? 1)));
  if (opts.windowId) {
    await xd([
      "mousemove",
      "--window",
      opts.windowId,
      String(Math.round(opts.x)),
      String(Math.round(opts.y)),
    ]);
  } else {
    await xd([
      "mousemove",
      String(Math.round(opts.x)),
      String(Math.round(opts.y)),
    ]);
  }
  await xd(["click", "--repeat", repeats, btn(opts.button)]);
  return { ok: true };
}

export async function mouseDrag(opts: {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  windowId?: string;
}): Promise<{ ok: true }> {
  const prefix = opts.windowId
    ? ["mousemove", "--window", opts.windowId]
    : ["mousemove"];
  await xd([
    ...prefix,
    String(Math.round(opts.fromX)),
    String(Math.round(opts.fromY)),
  ]);
  await xd(["mousedown", "1"]);
  await xd([
    ...prefix,
    String(Math.round(opts.toX)),
    String(Math.round(opts.toY)),
  ]);
  await xd(["mouseup", "1"]);
  return { ok: true };
}

export async function scroll(opts: {
  dx?: number;
  dy?: number;
  x?: number;
  y?: number;
  windowId?: string;
}): Promise<{ ok: true }> {
  if (opts.x != null && opts.y != null) {
    await mouseClick({
      x: opts.x,
      y: opts.y,
      clicks: 1,
      windowId: opts.windowId,
    });
  }
  const dy = opts.dy ?? 0;
  const dx = opts.dx ?? 0;
  const v = dy < 0 ? "4" : "5";
  const h = dx < 0 ? "6" : "7";
  const vn = Math.min(20, Math.abs(Math.round(dy / 40)));
  const hn = Math.min(20, Math.abs(Math.round(dx / 40)));
  if (vn > 0) await xd(["click", "--repeat", String(vn), v]);
  if (hn > 0) await xd(["click", "--repeat", String(hn), h]);
  return { ok: true };
}

export async function typeText(
  text: string,
  delayMs?: number,
): Promise<{ ok: true }> {
  // Live agent typing is 60 WPM (--delay 200). Replay passes 0 for a burst.
  // After ~600 paced characters, the remainder is delay 0 so we stay under 120s.
  const LIVE = 200;
  const PACED_MAX = 600;
  const pacedTimeout = Math.min(120_000, 1000 + Math.min(text.length, PACED_MAX) * 220);
  if (delayMs === undefined) {
    if (text.length <= PACED_MAX) {
      await xd(["type", "--delay", String(LIVE), "--", text], pacedTimeout);
    } else {
      await xd(
        ["type", "--delay", String(LIVE), "--", text.slice(0, PACED_MAX)],
        pacedTimeout,
      );
      await xd(["type", "--delay", "0", "--", text.slice(PACED_MAX)], 30_000);
    }
    return { ok: true };
  }
  await xd(
    ["type", "--delay", String(Math.max(0, delayMs)), "--", text],
    delayMs === 0 ? 15_000 : pacedTimeout,
  );
  return { ok: true };
}

export async function key(keys: string): Promise<{ ok: true }> {
  await xd(["key", keys]);
  return { ok: true };
}

export async function selectAll(): Promise<{ ok: true }> {
  await xd(["key", "ctrl+a"]);
  return { ok: true };
}
