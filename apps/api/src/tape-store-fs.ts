import fs from "node:fs";
import path from "node:path";
import type { TapeEvent } from "@webmcp-computer/contract";

// Dev/test tape store, namespaced per user under TAPE_DIR/{userId}/ so tenants
// (and tests for different users) stay isolated. Events load lazily per user.

const ROOT = path.resolve(process.env.TAPE_DIR ?? "data/tape");
const CAP = 100;
const byUser = new Map<string, TapeEvent[]>();

function userRoot(userId: string): string {
  return path.join(ROOT, userId);
}

function loadEvents(userId: string): TapeEvent[] {
  try {
    const raw = fs.readFileSync(
      path.join(userRoot(userId), "events.jsonl"),
      "utf8",
    );
    const parsed: TapeEvent[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        parsed.push(JSON.parse(line) as TapeEvent);
      } catch {
        /* */
      }
    }
    return parsed.slice(-CAP).reverse();
  } catch {
    return [];
  }
}

function events(userId: string): TapeEvent[] {
  let list = byUser.get(userId);
  if (!list) byUser.set(userId, (list = loadEvents(userId)));
  return list;
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function shotPath(
  userId: string,
  computerId: string,
  eventId: string,
  side: "before" | "after",
) {
  return path.join(userRoot(userId), computerId, `${eventId}-${side}.png`);
}

export function listTape(userId: string): TapeEvent[] {
  return [...events(userId)];
}

export function getShot(
  userId: string,
  eventId: string,
  side: "before" | "after",
): Buffer | null {
  const ev = events(userId).find((e) => e.id === eventId);
  if (!ev) return null; // not this user's event → no shot
  try {
    return fs.readFileSync(shotPath(userId, ev.computerId, eventId, side));
  } catch {
    return null;
  }
}

export function putShot(
  userId: string,
  computerId: string,
  eventId: string,
  side: "before" | "after",
  bytes: Buffer,
): void {
  const file = shotPath(userId, computerId, eventId, side);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, bytes);
}

export function appendEvent(userId: string, ev: TapeEvent): void {
  const list = events(userId);
  list.unshift(ev);
  ensureDir(userRoot(userId));
  fs.appendFileSync(
    path.join(userRoot(userId), "events.jsonl"),
    `${JSON.stringify(ev)}\n`,
  );
  while (list.length > CAP) {
    const old = list.pop();
    if (!old) break;
    for (const side of ["before", "after"] as const) {
      try {
        fs.unlinkSync(shotPath(userId, old.computerId, old.id, side));
      } catch {
        /* */
      }
    }
  }
}

// Rewrite each loaded user's events.jsonl to its capped in-memory set so the
// append-only log doesn't grow without bound. Called on the retention interval.
export function pruneTape(): void {
  for (const [userId, list] of byUser) {
    try {
      ensureDir(userRoot(userId));
      const body = list
        .slice()
        .reverse()
        .map((e) => JSON.stringify(e))
        .join("\n");
      fs.writeFileSync(
        path.join(userRoot(userId), "events.jsonl"),
        body ? `${body}\n` : "",
      );
    } catch {
      /* best-effort */
    }
  }
}
