import { execFile } from "node:child_process";
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
      try {
        await applyRootColor(id);
      } catch {
        /* xsetroot optional */
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
