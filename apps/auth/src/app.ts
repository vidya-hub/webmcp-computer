import { verify as argonVerify } from "@node-rs/argon2";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  signAccess,
  verifyAccess,
} from "@webmcp-computer/session";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { config, emailAllowed } from "./config.ts";
import {
  createSession,
  findUserByEmail,
  findUserById,
  revokeFamily,
  rotateSession,
} from "./db.ts";
import { loginRateOk, redis, revoke } from "./redis.ts";

function clientIp(c: { req: { header: (n: string) => string | undefined } }): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return c.req.header("x-real-ip") ?? "unknown";
}

async function setAuthCookies(
  c: Context,
  opts: { userId: string; email: string; familyId: string; refreshToken: string },
): Promise<void> {
  const access = await signAccess(
    { sub: opts.userId, email: opts.email, sid: opts.familyId },
    config.jwtSecret,
    config.accessTtl,
  );
  setCookie(c, ACCESS_COOKIE, access, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "Lax",
    path: "/",
    maxAge: config.accessTtl,
  });
  setCookie(c, REFRESH_COOKIE, opts.refreshToken, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "Lax",
    path: "/auth",
    maxAge: config.refreshTtl,
  });
}

function clearAuthCookies(c: Context): void {
  deleteCookie(c, ACCESS_COOKIE, { path: "/" });
  deleteCookie(c, REFRESH_COOKIE, { path: "/auth" });
}

export function createApp(): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  // Non-sensitive launch policy for the SPA: is a login form offered at all?
  app.get("/auth/config", (c) => c.json({ publicLogin: config.publicLogin }));

  app.get("/auth/me", async (c) => {
    const token = getCookie(c, ACCESS_COOKIE);
    if (!token) return c.json({ error: "unauthenticated" }, 401);
    const claims = await verifyAccess(token, [
      config.jwtSecret,
      config.jwtSecretPrevious,
    ]);
    if (!claims) return c.json({ error: "unauthenticated" }, 401);
    if (await redis.get(`revoked:${claims.sid}`)) {
      return c.json({ error: "unauthenticated" }, 401);
    }
    return c.json({ email: claims.email });
  });

  app.post("/auth/login", async (c) => {
    if (!config.publicLogin) {
      return c.json({ error: "login disabled" }, 403);
    }
    if (!(await loginRateOk(clientIp(c)))) {
      return c.json({ error: "too many attempts" }, 429);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      email?: string;
      password?: string;
    };
    const email = (body.email ?? "").trim().toLowerCase();
    const password = body.password ?? "";
    // Uniform failure — never reveal whether the email exists.
    const deny = () => c.json({ error: "invalid email or password" }, 401);
    if (!email || !password) return deny();
    if (!emailAllowed(email)) return deny();

    const user = await findUserByEmail(email);
    if (!user) return deny();
    let ok = false;
    try {
      ok = await argonVerify(user.passwordHash, password);
    } catch {
      ok = false;
    }
    if (!ok) return deny();

    const { familyId, refreshToken } = await createSession(user.id);
    await setAuthCookies(c, {
      userId: user.id,
      email: user.email,
      familyId,
      refreshToken,
    });
    return c.json({ email: user.email });
  });

  app.post("/auth/refresh", async (c) => {
    const token = getCookie(c, REFRESH_COOKIE);
    if (!token) return c.json({ error: "unauthenticated" }, 401);
    const result = await rotateSession(token);
    if (!result.ok) {
      if (result.reuse && result.familyId) await revoke(result.familyId);
      clearAuthCookies(c);
      return c.json({ error: "unauthenticated" }, 401);
    }
    const user = await findUserById(result.userId);
    if (!user) {
      clearAuthCookies(c);
      return c.json({ error: "unauthenticated" }, 401);
    }
    await setAuthCookies(c, {
      userId: user.id,
      email: user.email,
      familyId: result.familyId,
      refreshToken: result.refreshToken,
    });
    return c.json({ email: user.email });
  });

  app.post("/auth/logout", async (c) => {
    const token = getCookie(c, ACCESS_COOKIE);
    if (token) {
      const claims = await verifyAccess(token, [
        config.jwtSecret,
        config.jwtSecretPrevious,
      ]);
      if (claims) {
        await revokeFamily(claims.sid);
        await revoke(claims.sid);
      }
    }
    clearAuthCookies(c);
    return c.json({ ok: true });
  });

  return app;
}
