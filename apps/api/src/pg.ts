// Shared Postgres pool + schema bootstrap.
//
// One hardened pool is reused by the tape store, the recorded-action store and
// the home-archive store. The pool error handler is essential: without it
// node-postgres throws on an idle-connection drop and crashes the process.

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

// Idempotent DDL run at boot. 001_init.sql only runs on first DB init, so new
// tables must be created here to land without a volume wipe. Mirrored for
// documentation in deploy/db/002_actions_archives.sql.
export async function ensureSchema(): Promise<void> {
  await pool.query(`
    create table if not exists recorded_actions (
      id text primary key,
      name text not null,
      description text not null,
      source text not null default 'authored',
      computer_id text,
      created_at timestamptz not null default now(),
      steps jsonb not null
    );
    create index if not exists recorded_actions_created_idx
      on recorded_actions (created_at desc);

    create table if not exists home_archives (
      id text primary key,
      name text,
      computer_id text not null,
      size_bytes bigint not null,
      created_at timestamptz not null default now()
    );
    create index if not exists home_archives_created_idx
      on home_archives (created_at desc);
  `);
}
