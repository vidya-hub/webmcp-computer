// Pure AuthGate decision logic, kept free of React/DOM imports so it is unit
// testable on its own (the component in ui/AuthGate.tsx consumes these).

import type { Session } from "../store/slices/ui.ts";

// "loading" is transient (initial boot or a post-logout re-check); it must
// always resolve to a terminal phase so the gate never sticks on BootScreen.
export type Phase = "loading" | "login" | "closed";
export type Screen = "app" | "boot" | "login" | "closed";

/** What to render, purely from the session + boot phase. */
export function screenFor(session: Session | null, phase: Phase): Screen {
  if (session) return "app";
  if (phase === "loading") return "boot";
  return phase;
}

export interface BootDeps {
  fetchMe: () => Promise<{ email: string } | null>;
  fetchConfig: () => Promise<{ publicLogin: boolean }>;
  applySession: (session: { email: string }) => void;
}

/**
 * Run the boot handshake for a session-less gate: me → (apply | config). The
 * returned phase is only meaningful when there is no session; on a live session
 * it returns "loading" because applySession sets the session and the app
 * renders regardless. Crucially it NEVER returns a stuck state — logged out it
 * always yields "login" or "closed".
 */
export async function resolveAuthPhase(deps: BootDeps): Promise<Phase> {
  const me = await deps.fetchMe();
  if (me) {
    deps.applySession(me);
    return "loading";
  }
  const cfg = await deps.fetchConfig();
  return cfg.publicLogin ? "login" : "closed";
}
