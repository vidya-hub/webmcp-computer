const KEY = "webmcp.sound";

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setSoundEnabled(v: boolean): void {
  try {
    localStorage.setItem(KEY, v ? "1" : "0");
  } catch {
    /* private mode */
  }
}

let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(
  freq: number,
  at: number,
  dur: number,
  type: OscillatorType,
  gain: number,
  slideTo?: number,
): void {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0004, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export type Blip = "tick" | "spawn" | "chime";

export function blip(kind: Blip): void {
  if (!soundEnabled()) return;
  if (kind === "tick") tone(880, 0, 0.035, "square", 0.018);
  if (kind === "spawn") tone(220, 0, 0.18, "sine", 0.05, 110);
  if (kind === "chime") {
    tone(660, 0, 0.28, "sine", 0.035);
    tone(880, 0.09, 0.3, "sine", 0.03);
  }
}
