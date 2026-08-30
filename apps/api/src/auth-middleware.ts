// Session authentication + path-based actor for the control plane.
//
// The session (who) comes from the access-token cookie minted by apps/auth,
// verified here with the shared jose module and checked against Redis for
// revocation. The actor (which policy) comes from the URL, never a header:
// POST /api/act is the agent surface (WebMCP tools); every other route is the
// human operator. A spoofed `x-actor` header cannot change this.

import { type Actor } from "@webmcp-computer/contract";
import { ACCESS_COOKIE, jwtSecrets, verifyAccess } from "@webmcp-computer/session";
import type { Context as HonoContext, Next } from "hono";
import { getCookie } from "hono/cookie";
import { HttpError } from "./http-error.ts";
import { redis } from "./redis.ts";

type Context = HonoContext<AppEnv>;

// Read at call time (not module load) so tests can flip it per case.
function authRequired(): boolean {
  return (process.env.AUTH_REQUIRED ?? "").toLowerCase() === "true";
}

// In dev (AUTH_REQUIRED=false) requests with no session act as this single
// tenant, so the app and tests run without standing up auth.
const DEV_USER = "dev-user";

// Only the `get` used for revoke checks; injectable so tests can supply a fake
// (same trick as workspace-store.test.ts). Defaults to the real Redis client.
type RevokeStore = { get(key: string): Promise<string | null> };
let revokeStore: RevokeStore = redis;
export function setRevokeStoreForTest(store: RevokeStore): void {
  revokeStore = store;
}

export interface Session {
  userId: string;
  email: string;
  sid: string;
}

/** Hono context variables set by middleware. */
export type AppEnv = {
  Variables: { requestId: string; userId: string; email: string };
};

async function sessionFromToken(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  const claims = await verifyAccess(token, jwtSecrets());
  if (!claims) return null;
  try {
    if (await revokeStore.get(`revoked:${claims.sid}`)) return null;
  } catch {
    // Redis down: fail closed only in production.
    if (authRequired()) return null;
  }
  return { userId: claims.sub, email: claims.email, sid: claims.sid };
}

async function resolveSession(c: Context): Promise<Session | null> {
  return sessionFromToken(getCookie(c, ACCESS_COOKIE));
}

/** Parse the access cookie from a raw Cookie header (for the WS/desktop path). */
function tokenFromCookieHeader(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const s = part.trim();
    if (s.startsWith(`${ACCESS_COOKIE}=`)) {
      return decodeURIComponent(s.slice(ACCESS_COOKIE.length + 1));
    }
  }
  return undefined;
}

/**
 * Resolve the owning userId for a raw upgrade/HTTP request (no Hono Context):
 * the session's userId, or the dev tenant when AUTH_REQUIRED is off, or null
 * when auth is required and there is no valid session.
 */
export async function userIdFromCookieHeader(
  header: string | undefined,
): Promise<string | null> {
  const session = await sessionFromToken(tokenFromCookieHeader(header));
  if (session) return session.userId;
  return authRequired() ? null : DEV_USER;
}

/** Gate /api/* on a valid session. Sets userId/email on the context. */
export async function requireAuth(c: Context, next: Next): Promise<Response | void> {
  const session = await resolveSession(c);
  if (session) {
    c.set("userId", session.userId);
    c.set("email", session.email);
    return next();
  }
  if (!authRequired()) {
    c.set("userId", DEV_USER);
    c.set("email", "dev@local");
    return next();
  }
  return c.json({ error: "unauthenticated" }, 401);
}

// Handlers run behind requireAuth, so userId is always set. If it is somehow
// absent, never silently fall back to the dev tenant under AUTH_REQUIRED —
// that would serve another user's data. Throw 401 instead.
export function userIdOf(c: Context): string {
  const uid = c.get("userId") as string | undefined;
  if (uid) return uid;
  if (authRequired()) throw new HttpError(401, { error: "unauthenticated" });
  return DEV_USER;
}

/** Actor is the path: exactly POST /api/act is the agent; everything else human. */
export function actorOf(c: Context): Actor {
  // Normalize a trailing slash so `/api/act/` cannot flip policy to human.
  const path = c.req.path.replace(/\/+$/, "") || "/";
  return c.req.method === "POST" && path === "/api/act" ? "agent" : "human";
}
