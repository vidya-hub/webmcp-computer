import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HOME_JAIL_DEFAULT } from "@webmcp-computer/contract";
import { HttpError } from "./http-error.ts";

export function jailRoot(): string {
  return process.env.HOME_JAIL ?? HOME_JAIL_DEFAULT;
}

export function allowJsonAppearance(): boolean {
  return process.env.ALLOW_JSON_APPEARANCE === "1";
}

export function inDocker(): boolean {
  return fs.existsSync("/.dockerenv");
}

export function ensureJail(): string {
  const jail = path.resolve(jailRoot());
  if (fs.existsSync(jail)) return fs.realpathSync(jail);
  if (allowJsonAppearance()) {
    fs.mkdirSync(jail, { recursive: true });
    return fs.realpathSync(jail);
  }
  throw new HttpError(500, { error: "jail missing" });
}

function assertInside(jail: string, resolved: string): string {
  const rel = path.relative(jail, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new HttpError(400, { error: "path outside jail" });
  }
  return resolved;
}

function realpathPrefix(target: string): string {
  let cur = target;
  let rest = "";
  while (true) {
    try {
      const real = fs.realpathSync(cur);
      return rest ? path.join(real, rest) : real;
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return rest ? path.join(cur, rest) : cur;
      rest = rest ? path.join(path.basename(cur), rest) : path.basename(cur);
      cur = parent;
    }
  }
}

export function resolveInJail(input: string, base?: string): string {
  const jail = ensureJail();
  const from = base ?? jail;
  const candidate = path.resolve(from, input);
  return assertInside(jail, realpathPrefix(candidate));
}

export function formatBytes(n: number): string {
  const gb = n / 1024 ** 3;
  if (gb >= 1) {
    const v = Math.round(gb * 10) / 10;
    return `${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)}GB`;
  }
  const mb = n / 1024 ** 2;
  if (mb >= 1) {
    const v = Math.round(mb * 10) / 10;
    return `${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)}MB`;
  }
  return `${Math.max(0, Math.round(n))}B`;
}

export function hostname(): string {
  return os.hostname();
}
