import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveAuthPhase, screenFor } from "./gate.ts";

const session = { email: "alice@example.com" };

test("screenFor: a session always renders the app", () => {
  assert.equal(screenFor(session, "loading"), "app");
  assert.equal(screenFor(session, "login"), "app");
});

test("screenFor: no session shows boot only while loading", () => {
  assert.equal(screenFor(null, "loading"), "boot");
  assert.equal(screenFor(null, "login"), "login");
  assert.equal(screenFor(null, "closed"), "closed");
});

test("cookie session → clearSession → login screen, never stuck on boot", async () => {
  let loggedIn = true;
  let applied: { email: string } | null = null;
  const deps = {
    fetchMe: async () => (loggedIn ? session : null),
    fetchConfig: async () => ({ publicLogin: true }),
    applySession: (s: { email: string }) => {
      applied = s;
    },
  };

  // Initial boot with a cookie session → app.
  const p1 = await resolveAuthPhase(deps);
  assert.deepEqual(applied, session);
  assert.equal(screenFor(session, p1), "app");

  // Logout clears the session; the gate re-runs boot with no cookie.
  loggedIn = false;
  const p2 = await resolveAuthPhase(deps);
  // The key regression guard: NOT "boot".
  assert.equal(screenFor(null, p2), "login");
});

test("logout on a closed instance shows the closed screen", async () => {
  const deps = {
    fetchMe: async () => null,
    fetchConfig: async () => ({ publicLogin: false }),
    applySession: () => {},
  };
  const phase = await resolveAuthPhase(deps);
  assert.equal(screenFor(null, phase), "closed");
});
