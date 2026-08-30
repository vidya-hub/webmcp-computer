import fs from "node:fs";
import path from "node:path";
import type { TapeEvent } from "@webmcp-computer/contract";

const ROOT = path.resolve(process.env.TAPE_DIR ?? "data/tape");
const CAP = 100;
const events: TapeEvent[] = loadEvents();

function loadEvents(): TapeEvent[] {
  try {
    const raw = fs.readFileSync(path.join(ROOT, "events.jsonl"), "utf8");
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

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function shotPath(computerId: string, eventId: string, side: "before" | "after") {
  return path.join(ROOT, computerId, `${eventId}-${side}.png`);
}

export function listTape(): TapeEvent[] {
  return [...events];
}

export function getShot(
  eventId: string,
  side: "before" | "after",
): Buffer | null {
  const ev = events.find((e) => e.id === eventId);
  if (!ev) return null;
  const file = shotPath(ev.computerId, eventId, side);
  try {
    return fs.readFileSync(file);
  } catch {
    return null;
  }
}

export function putShot(
  computerId: string,
  eventId: string,
  side: "before" | "after",
  bytes: Buffer,
): void {
  const file = shotPath(computerId, eventId, side);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, bytes);
}

export function appendEvent(ev: TapeEvent): void {
  events.unshift(ev);
  ensureDir(ROOT);
  fs.appendFileSync(
    path.join(ROOT, "events.jsonl"),
    `${JSON.stringify(ev)}\n`,
  );
  while (events.length > CAP) {
    const old = events.pop();
    if (!old) break;
    for (const side of ["before", "after"] as const) {
      try {
        fs.unlinkSync(shotPath(old.computerId, old.id, side));
      } catch {
        /* */
      }
    }
  }
}

// events.jsonl is append-only above; rewrite it to the capped in-memory set so
// it doesn't grow without bound. Called on the retention interval.
export function pruneTape(): void {
  try {
    ensureDir(ROOT);
    const body = events
      .slice()
      .reverse()
      .map((e) => JSON.stringify(e))
      .join("\n");
    fs.writeFileSync(
      path.join(ROOT, "events.jsonl"),
      body ? `${body}\n` : "",
    );
  } catch {
    /* best-effort */
  }
}
