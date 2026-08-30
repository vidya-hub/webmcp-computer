// Shared Postgres pool.
//
// One hardened pool is reused by the tape store, the recorded-action store and
// the home-archive store. The pool error handler is essential: without it
// node-postgres throws on an idle-connection drop and crashes the process.
//
// The schema is owned by numbered SQL migrations (deploy/db/NNN_*.sql) applied
// through ./migrate.ts — not by DDL here. See migrate() for the source of truth.

import { Pool } from "pg";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 10_000,
});

pool.on("error", (err) => {
  console.error("pg pool idle error:", err.message);
});

/** Liveness check for /api/ready. */
export async function pingPg(): Promise<boolean> {
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  }
}
