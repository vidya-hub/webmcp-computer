import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  type Appearance,
  type ThemeId,
  type WallpaperId,
} from "@webmcp-computer/contract";
import { HttpError } from "./http-error.ts";
import {
  allowJsonAppearance,
  ensureJail,
  inDocker,
} from "./jail.ts";

const execFileAsync = promisify(execFile);

const WALLPAPERS: WallpaperId[] = [
  "void",
  "dark-grid",
  "carbon",
  "arrows",
];

function displayEnv(): NodeJS.ProcessEnv {
  return { ...process.env, DISPLAY: process.env.DISPLAY ?? ":1" };
}

function wallpaperPath(id: WallpaperId): string {
  return `/usr/share/backgrounds/webmcp/${id}.png`;
}

function jsonPath(): string {
  return path.join(ensureJail(), ".webmcp-appearance.json");
}

function defaultAppearance(): Appearance {
  const envWp = process.env.WALLPAPER;
  const wallpaper = WALLPAPERS.includes(envWp as WallpaperId)
    ? (envWp as WallpaperId)
    : "carbon";
  return {
    name: process.env.MACHINE_NAME ?? process.env.MACHINE_ID ?? "machine",
    theme: "dark",
    wallpaper,
  };
}

async function xfconfAvailable(): Promise<boolean> {
  try {
    await execFileAsync("xfconf-query", ["--version"], {
      env: displayEnv(),
      timeout: 3000,
    });
    return true;
  } catch {
    return false;
  }
}

async function xfconfList(channel: string): Promise<string[]> {
  const { stdout } = await execFileAsync("xfconf-query", ["-c", channel, "-l"], {
    env: displayEnv(),
    timeout: 5000,
  });
  return stdout.split("\n").map((s) => s.trim()).filter(Boolean);
}

async function xfconfGet(channel: string, prop: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "xfconf-query",
      ["-c", channel, "-p", prop],
      { env: displayEnv(), timeout: 3000 },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function xfconfSet(
  channel: string,
  prop: string,
  value: string,
): Promise<void> {
  await execFileAsync(
    "xfconf-query",
    ["-c", channel, "-p", prop, "-s", value],
    { env: displayEnv(), timeout: 5000 },
  );
}

function wallpaperIdFromPath(file: string | null): WallpaperId {
  if (!file) return defaultAppearance().wallpaper;
  const base = path.basename(file, ".png");
  if (WALLPAPERS.includes(base as WallpaperId)) return base as WallpaperId;
  return defaultAppearance().wallpaper;
}

function readJson(): Appearance {
  try {
    const raw = fs.readFileSync(jsonPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<Appearance>;
    const fallback = defaultAppearance();
    return {
      name: parsed.name ?? fallback.name,
      theme: parsed.theme === "light" ? "light" : "dark",
      wallpaper: WALLPAPERS.includes(parsed.wallpaper as WallpaperId)
        ? (parsed.wallpaper as WallpaperId)
        : fallback.wallpaper,
    };
  } catch {
    return defaultAppearance();
  }
}

function writeJson(next: Appearance): void {
  fs.writeFileSync(jsonPath(), `${JSON.stringify(next, null, 2)}\n`);
}

async function applyRootColor(id: WallpaperId): Promise<void> {
  const colors: Record<WallpaperId, string> = {
    void: "#000000",
    carbon: "#111111",
    "dark-grid": "#202020",
    arrows: "#3a3a3a",
  };
  await execFileAsync("xsetroot", ["-solid", colors[id]], {
    env: displayEnv(),
    timeout: 3000,
  });
}

function desktopConfPath(): string {
  return path.join(ensureJail(), ".config/pcmanfm/default/desktop-items-0.conf");
}

function gtkSettingsPath(): string {
  return path.join(ensureJail(), ".config/gtk-3.0/settings.ini");
}

function openboxRcPath(): string {
  return path.join(ensureJail(), ".config/openbox/rc.xml");
}

function setConfValue(file: string, key: string, value: string): void {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    throw new HttpError(500, { error: `config missing: ${file}` });
  }
  const re = new RegExp(`^${key}=.*$`, "m");
  const line = `${key}=${value}`;
  text = re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`;
  fs.writeFileSync(file, text);
}

function setGtkPreferDark(dark: boolean): void {
  const file = gtkSettingsPath();
  const line = `gtk-application-prefer-dark-theme=${dark ? "1" : "0"}`;
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    text = "";
  }
  if (/^gtk-application-prefer-dark-theme=.*$/m.test(text)) {
    text = text.replace(/^gtk-application-prefer-dark-theme=.*$/m, line);
  } else if (/\[Settings\]/m.test(text)) {
    text = text.replace(/\[Settings\]/m, `[Settings]\n${line}`);
  } else {
    text = `[Settings]\n${line}\n`;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function killPcmanfm(): void {
  let pids: string[] = [];
  try {
    pids = fs.readdirSync("/proc").filter((p) => /^\d+$/.test(p));
  } catch {
    return;
  }
  for (const pid of pids) {
    try {
      const comm = fs.readFileSync(`/proc/${pid}/comm`, "utf8").trim();
      // Wrapper execs /usr/bin/pcmanfm.real, so comm is "pcmanfm.real"
      // (15-char kernel limit; this name fits). Match both.
      if (comm === "pcmanfm" || comm === "pcmanfm.real") {
        process.kill(Number(pid), "SIGTERM");
      }
    } catch {
      /* process vanished or not ours */
    }
  }
}

async function restartDesktop(): Promise<void> {
  killPcmanfm();
  await new Promise((r) => setTimeout(r, 400));
  const child = spawn("pcmanfm", ["--desktop", "--profile=default"], {
    env: displayEnv(),
    detached: true,
    stdio: "ignore",
  });
  // spawn failure (no pcmanfm, e.g. laptop dev shim) is an async 'error'
  // event, not a rejection — swallow it so the bridge process survives.
  child.on("error", () => {});
  child.unref();
}

export async function readAppearance(): Promise<Appearance> {
  const has = await xfconfAvailable();
  if (!has) {
    if (inDocker() || allowJsonAppearance()) return readJson();
    throw new HttpError(500, { error: "xfconf-query missing" });
  }
  const props = await xfconfList("xfce4-desktop");
  const imageProp = props.find((p) => p.endsWith("/last-image"));
  const image = imageProp
    ? await xfconfGet("xfce4-desktop", imageProp)
    : null;
  const gtk = await xfconfGet("xsettings", "/Net/ThemeName");
  const theme: ThemeId =
    gtk && /dark/i.test(gtk) ? "dark" : gtk ? "light" : "dark";
  return {
    name: process.env.MACHINE_NAME ?? process.env.MACHINE_ID ?? "machine",
    theme,
    wallpaper: wallpaperIdFromPath(image),
  };
}

export async function applyWallpaper(id: WallpaperId): Promise<Appearance> {
  const has = await xfconfAvailable();
  if (!has) {
    if (inDocker() || allowJsonAppearance()) {
      const file = wallpaperPath(id);
      if (inDocker() && !fs.existsSync(file)) {
        throw new HttpError(500, { error: `wallpaper missing: ${file}` });
      }
      try {
        await applyRootColor(id);
      } catch {
        /* xsetroot optional */
      }
      // No D-Bus session bus in this image, so pcmanfm's GApplication IPC
      // cannot reach the running desktop. Rewrite config and restart it.
      try {
        setConfValue(desktopConfPath(), "wallpaper", file);
        setConfValue(desktopConfPath(), "wallpaper_mode", "crop");
        await restartDesktop();
      } catch {
        /* desktop repaint is best-effort; json state still updates */
      }
      const next = { ...readJson(), wallpaper: id };
      writeJson(next);
      return next;
    }
    throw new HttpError(500, { error: "xfconf-query missing" });
  }
  const file = wallpaperPath(id);
  if (!fs.existsSync(file)) {
    throw new HttpError(500, { error: `wallpaper missing: ${file}` });
  }
  const props = await xfconfList("xfce4-desktop");
  const imageProps = props.filter(
    (p) => p.endsWith("/last-image") || p.endsWith("/image-path"),
  );
  const targets =
    imageProps.length > 0
      ? imageProps
      : ["/backdrop/screen0/monitor0/workspace0/last-image"];
  let ok = 0;
  for (const prop of targets) {
    try {
      await xfconfSet("xfce4-desktop", prop, file);
      ok += 1;
    } catch {
      /* try next monitor key */
    }
  }
  if (ok === 0) {
    throw new HttpError(500, { error: "xfconf wallpaper set failed" });
  }
  try {
    await execFileAsync("xfdesktop", ["--reload"], {
      env: displayEnv(),
      timeout: 5000,
    });
  } catch {
    /* optional */
  }
  return readAppearance();
}

export async function applyTheme(theme: ThemeId): Promise<Appearance> {
  const has = await xfconfAvailable();
  const gtk = theme === "dark" ? "Adwaita-dark" : "Adwaita";
  if (!has) {
    if (inDocker() || allowJsonAppearance()) {
      const dark = theme === "dark";
      try {
        setGtkPreferDark(dark);
      } catch {
        /* gtk settings optional */
      }
      try {
        const rc = openboxRcPath();
        const xml = fs.readFileSync(rc, "utf8");
        const nextXml = xml.replace(
          /<name>Webmcp(?:Dark|Light)<\/name>/,
          `<name>Webmcp${dark ? "Dark" : "Light"}</name>`,
        );
        if (nextXml !== xml) {
          fs.writeFileSync(rc, nextXml);
          await execFileAsync("openbox", ["--reconfigure"], {
            env: displayEnv(),
            timeout: 5000,
          });
        }
      } catch {
        /* openbox retheme optional */
      }
      try {
        await restartDesktop();
      } catch {
        /* gtk only reads settings.ini at startup; restart is best-effort */
      }
      const next = { ...readJson(), theme };
      writeJson(next);
      return next;
    }
    throw new HttpError(500, { error: "xfconf-query missing" });
  }
  await xfconfSet("xsettings", "/Net/ThemeName", gtk);
  try {
    await xfconfSet("xfwm4", "/general/theme", gtk);
  } catch {
    /* window manager theme is optional */
  }
  return readAppearance();
}
