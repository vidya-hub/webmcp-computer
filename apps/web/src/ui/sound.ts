import { createUISFX, type CueName } from "uisfx";

const KEY = "webmcp.sound";

const ui = createUISFX({
  pack: "minimal",
  volume: 0.45,
  enabled: readStored(),
});

let unlocked = false;

function readStored(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function soundEnabled(): boolean {
  return ui.isEnabled();
}

export function setSoundEnabled(v: boolean): void {
  try {
    localStorage.setItem(KEY, v ? "1" : "0");
  } catch {
    /* private mode */
  }
  if (!v) ui.stopAll();
  ui.setEnabled(v);
}

export function stopAll(): void {
  ui.stopAll();
}

export function unlockSound(): void {
  if (unlocked) return;
  unlocked = true;
  void ui.unlock();
}

export function play(
  cue: CueName,
  opts?: { volume?: number },
): { stop: () => void } | null {
  if (!unlocked) return null;
  if (!ui.isEnabled()) return null;
  return ui.play(cue, opts) ?? null;
}
