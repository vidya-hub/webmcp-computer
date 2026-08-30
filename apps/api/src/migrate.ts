// Numbered SQL migrations are the single source of truth for the schema.
//
// Files live in deploy/db/NNN_*.sql. Each is applied at most once, in numeric
// order, inside a transaction, and recorded in schema_migrations. Boot refuses
// to continue if the database ends up behind the highest migration on disk.
//
// 001/002 use `create ... if not exists`, so re-applying them over a legacy DB
// that predates schema_migrations is safe; 003 performs the intended wipe.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pg.ts";

function migrationsDir(): string {
  if (process.env.DB_MIGRATIONS_DIR) return process.env.DB_MIGRATIONS_DIR;
  // apps/api/src/migrate.ts -> repo root -> deploy/db
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../deploy/db");
}

interface Migration {
  version: number;
  name: string;
  file: string;
}

function discover(dir: string): Migration[] {
  const out: Migration[] = [];
  for (const name of fs.readdirSync(dir)) {
    const m = name.match(/^(\d+)_.*\.sql$/);
    if (!m) continue;
    out.push({ version: Number(m[1]), name, file: path.join(dir, name) });
  }
  return out.sort((a, b) => a.version - b.version);
}

export async function migrate(): Promise<void> {
  const dir = migrationsDir();
  if (!fs.existsSync(dir)) {
    throw new Error(`migrations dir not found: ${dir}`);
  }
  const migrations = discover(dir);
  if (migrations.length === 0) throw new Error(`no migrations in ${dir}`);

  await pool.query(`
    create table if not exists schema_migrations (
      version    int primary key,
      name       text not null,
      applied_at timestamptz not null default now()
    );
  `);

  const { rows } = await pool.query<{ version: number }>(
    "select version from schema_migrations",
  );
  const applied = new Set(rows.map((r) => r.version));

  for (const mig of migrations) {
    if (applied.has(mig.version)) continue;
    const sql = fs.readFileSync(mig.file, "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query(
        "insert into schema_migrations (version, name) values ($1, $2)",
        [mig.version, mig.name],
      );
      await client.query("commit");
      console.log(`migration applied: ${mig.name}`);
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw new Error(`migration ${mig.name} failed: ${String(err)}`);
    } finally {
      client.release();
    }
  }

  const head = migrations[migrations.length - 1]!.version;
  const { rows: after } = await pool.query<{ max: number | null }>(
    "select max(version) as max from schema_migrations",
  );
  const dbVersion = after[0]?.max ?? 0;
  if (dbVersion < head) {
    throw new Error(
      `schema behind: db at ${dbVersion}, migrations require ${head}`,
    );
  }
}
