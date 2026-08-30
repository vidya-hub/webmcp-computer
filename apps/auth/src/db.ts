// Postgres access for auth: users + rotating refresh sessions.
//
// Refresh tokens rotate: each is stored as one auth_sessions row (sid) under a
// family_id. On use, the row is revoked and a fresh one is inserted in the same
// family. Presenting an already-revoked refresh token = theft → the whole family
// is revoked. The stable family_id is what the access JWT carries as `sid`, so
// the API can revoke a live session immediately via Redis.

import crypto from "node:crypto";
import { Pool } from "pg";
import { config } from "./config.ts";

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 10_000,
});

pool.on("error", (err) => console.error("auth pg idle error:", err.message));

export interface User {
  id: string;
  email: string;
  passwordHash: string;
}

export function hashRefresh(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function newToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const { rows } = await pool.query(
    "select id, email, password_hash from users where email = $1",
    [email.toLowerCase()],
  );
  const r = rows[0];
  return r
    ? { id: r.id, email: r.email, passwordHash: r.password_hash }
    : null;
}

export async function findUserById(id: string): Promise<User | null> {
  const { rows } = await pool.query(
    "select id, email, password_hash from users where id = $1",
    [id],
  );
  const r = rows[0];
  return r
    ? { id: r.id, email: r.email, passwordHash: r.password_hash }
    : null;
}

/** Insert a user (+ default quota) if absent. Returns the user id. */
export async function upsertUser(
  email: string,
  passwordHash: string,
): Promise<string> {
  const id = crypto.randomUUID();
  const { rows } = await pool.query(
    `insert into users (id, email, password_hash) values ($1, $2, $3)
     on conflict (email) do update set email = excluded.email
     returning id`,
    [id, email.toLowerCase(), passwordHash],
  );
  const userId = rows[0].id as string;
  await pool.query(
    `insert into quotas (user_id, max_computers) values ($1, $2)
     on conflict (user_id) do nothing`,
    [userId, config.defaultQuota],
  );
  return userId;
}

export interface NewSession {
  familyId: string;
  refreshToken: string;
}

/** Start a new session family and issue its first refresh token. */
export async function createSession(userId: string): Promise<NewSession> {
  const familyId = crypto.randomUUID();
  const sid = crypto.randomUUID();
  const refreshToken = newToken();
  const expires = new Date(Date.now() + config.refreshTtl * 1000);
  await pool.query(
    `insert into auth_sessions (sid, user_id, family_id, refresh_hash, expires_at)
     values ($1, $2, $3, $4, $5)`,
    [sid, userId, familyId, hashRefresh(refreshToken), expires],
  );
  return { familyId, refreshToken };
}

export type RotateResult =
  | { ok: true; userId: string; familyId: string; refreshToken: string }
  | { ok: false; reuse: boolean; familyId?: string };

/** Validate + rotate a refresh token. Detects reuse of a revoked token. */
export async function rotateSession(
  refreshToken: string,
): Promise<RotateResult> {
  const hash = hashRefresh(refreshToken);
  const { rows } = await pool.query(
    `select sid, user_id, family_id, revoked_at, expires_at
       from auth_sessions where refresh_hash = $1`,
    [hash],
  );
  const row = rows[0];
  if (!row) return { ok: false, reuse: false };

  if (row.revoked_at || new Date(row.expires_at).getTime() < Date.now()) {
    // A revoked token was presented → assume theft, burn the family.
    await revokeFamily(row.family_id);
    return { ok: false, reuse: true, familyId: row.family_id };
  }

  // Revoke the used token, mint the next one in the same family.
  const next = newToken();
  const sid = crypto.randomUUID();
  const expires = new Date(Date.now() + config.refreshTtl * 1000);
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      "update auth_sessions set revoked_at = now() where sid = $1",
      [row.sid],
    );
    await client.query(
      `insert into auth_sessions (sid, user_id, family_id, refresh_hash, expires_at)
       values ($1, $2, $3, $4, $5)`,
      [sid, row.user_id, row.family_id, hashRefresh(next), expires],
    );
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return {
    ok: true,
    userId: row.user_id,
    familyId: row.family_id,
    refreshToken: next,
  };
}

export async function revokeFamily(familyId: string): Promise<void> {
  await pool.query(
    "update auth_sessions set revoked_at = now() where family_id = $1 and revoked_at is null",
    [familyId],
  );
}

export async function pingDb(): Promise<boolean> {
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  }
}

/** Highest applied migration version, or null if the runner hasn't run yet. */
export async function schemaVersion(): Promise<number | null> {
  try {
    const { rows } = await pool.query<{ max: number | null }>(
      "select max(version) as max from schema_migrations",
    );
    return rows[0]?.max ?? null;
  } catch {
    return null; // table absent
  }
}
