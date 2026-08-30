import assert from "node:assert/strict";
import { test } from "node:test";

// Set a secret before importing the middleware/session (jwtSecrets reads env).
process.env.JWT_SECRET = "test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const { ACCESS_COOKIE, signAccess } = await import("@webmcp-computer/session");
const { actorOf, requireAuth, userIdOf, setRevokeStoreForTest } = await import(
  "./auth-middleware.ts"
);

// actorOf reads only c.req.path + c.req.method, so a minimal fake context is
// enough to lock the policy: the actor is the path, never a header.
function ctx(method: string, path: string) {
  return { req: { method, path } } as never;
}

test("POST /api/act is the agent surface", () => {
  assert.equal(actorOf(ctx("POST", "/api/act")), "agent");
});

test("a trailing slash cannot flip /api/act to human", () => {
  assert.equal(actorOf(ctx("POST", "/api/act/")), "agent");
});

test("only POST /api/act is agent — GET is not", () => {
  assert.equal(actorOf(ctx("GET", "/api/act")), "human");
});

test("every other route is the human operator", () => {
  assert.equal(actorOf(ctx("POST", "/api/actions/x/replay")), "human");
  assert.equal(actorOf(ctx("POST", "/api/record/start")), "human");
  assert.equal(actorOf(ctx("POST", "/api/spawn")), "human");
  assert.equal(actorOf(ctx("DELETE", "/api/actions/x")), "human");
});

test("an x-actor header is irrelevant — actorOf never reads headers", () => {
  // Even a context that would return "human" from a header stays human;
  // the agent surface is the path alone.
  const c = { req: { method: "POST", path: "/api/actions", header: () => "agent" } } as never;
  assert.equal(actorOf(c), "human");
});

// --- requireAuth (fake revoke store, same trick as workspace-store.test) ---

function fakeCtx(cookie?: string) {
  const vars = new Map<string, unknown>();
  let jsonStatus: number | undefined;
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  return {
    ctx: {
      req: {
        raw: { headers },
        header: (n: string) =>
          n.toLowerCase() === "cookie" ? cookie : undefined,
      },
      set: (k: string, v: unknown) => vars.set(k, v),
      get: (k: string) => vars.get(k),
      json: (_b: unknown, s?: number) => {
        jsonStatus = s;
        return { status: s } as never;
      },
    } as never,
    userId: () => vars.get("userId") as string | undefined,
    status: () => jsonStatus,
  };
}

async function tokenFor(sid: string): Promise<string> {
  return signAccess(
    { sub: "alice", email: "alice@example.com", sid },
    process.env.JWT_SECRET!,
    900,
  );
}

test("requireAuth: no cookie + AUTH_REQUIRED → 401, next not called", async () => {
  process.env.AUTH_REQUIRED = "true";
  setRevokeStoreForTest({ async get() { return null; } });
  const f = fakeCtx();
  let nexted = false;
  await requireAuth(f.ctx, async () => {
    nexted = true;
  });
  assert.equal(f.status(), 401);
  assert.equal(nexted, false);
  delete process.env.AUTH_REQUIRED;
});

test("requireAuth: revoked sid → 401", async () => {
  process.env.AUTH_REQUIRED = "true";
  setRevokeStoreForTest({ async get() { return "1"; } }); // revoked
  const token = await tokenFor("fam-revoked");
  const f = fakeCtx(`${ACCESS_COOKIE}=${token}`);
  let nexted = false;
  await requireAuth(f.ctx, async () => {
    nexted = true;
  });
  assert.equal(f.status(), 401);
  assert.equal(nexted, false);
  delete process.env.AUTH_REQUIRED;
});

test("requireAuth: valid session → next runs with userId", async () => {
  process.env.AUTH_REQUIRED = "true";
  setRevokeStoreForTest({ async get() { return null; } }); // not revoked
  const token = await tokenFor("fam-ok");
  const f = fakeCtx(`${ACCESS_COOKIE}=${token}`);
  let nexted = false;
  await requireAuth(f.ctx, async () => {
    nexted = true;
  });
  assert.equal(nexted, true);
  assert.equal(f.userId(), "alice");
  delete process.env.AUTH_REQUIRED;
});

test("requireAuth: AUTH_REQUIRED off → dev-user fallback", async () => {
  delete process.env.AUTH_REQUIRED;
  setRevokeStoreForTest({ async get() { return null; } });
  const f = fakeCtx();
  let nexted = false;
  await requireAuth(f.ctx, async () => {
    nexted = true;
  });
  assert.equal(nexted, true);
  assert.equal(f.userId(), "dev-user");
});

test("userIdOf: throws 401 under AUTH_REQUIRED when unset", () => {
  process.env.AUTH_REQUIRED = "true";
  const f = fakeCtx();
  assert.throws(
    () => userIdOf(f.ctx),
    (err: unknown) => (err as { status?: number })?.status === 401,
  );
  delete process.env.AUTH_REQUIRED;
});
