// Recorded-action storage. Actions are small JSON documents (no blobs), so the
// pg and fs backends both live here and are chosen the same way as the tape
// store: Postgres when configured, else the local filesystem for dev/tests.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { RecordedAction } from "@webmcp-computer/contract";

const usePg =
  process.env.STORAGE_BACKEND === "pg" ||
  (!!process.env.DATABASE_URL && !!process.env.S3_ACCESS_KEY);

export interface ActionStore {
  saveAction(action: RecordedAction): Promise<void>;
  listActions(): Promise<RecordedAction[]>;
  getAction(id: string): Promise<RecordedAction | null>;
  deleteAction(id: string): Promise<void>;
}

function pgStore(): ActionStore {
  // Lazily import so the fs path never pulls in pg.
  const poolPromise = import("./pg.ts").then((m) => m.pool);
  return {
    async saveAction(a) {
      const pool = await poolPromise;
      await pool.query(
        `insert into recorded_actions
           (id, name, description, source, computer_id, created_at, steps)
         values ($1,$2,$3,$4,$5,$6,$7::jsonb)
         on conflict (id) do update set
           name = excluded.name, description = excluded.description,
           source = excluded.source, steps = excluded.steps`,
        [a.id, a.name, a.description, a.source, a.computerId ?? null, a.createdAt, JSON.stringify(a.steps)],
      );
    },
    async listActions() {
      const pool = await poolPromise;
      const { rows } = await pool.query(
        `select id, name, description, source, computer_id, created_at, steps
           from recorded_actions order by created_at desc limit 200`,
      );
      return rows.map(rowToAction);
    },
    async getAction(id) {
      const pool = await poolPromise;
      const { rows } = await pool.query(
        `select id, name, description, source, computer_id, created_at, steps
           from recorded_actions where id = $1`,
        [id],
      );
      return rows[0] ? rowToAction(rows[0]) : null;
    },
    async deleteAction(id) {
      const pool = await poolPromise;
      await pool.query("delete from recorded_actions where id = $1", [id]);
    },
  };
}

function rowToAction(r: Record<string, unknown>): RecordedAction {
  return {
    id: String(r.id),
    name: String(r.name),
    description: String(r.description),
    source:
      r.source === "tape" || r.source === "recorded"
        ? r.source
        : "authored",
    computerId: r.computer_id
      ? (String(r.computer_id) as RecordedAction["computerId"])
      : undefined,
    createdAt:
      r.created_at instanceof Date
        ? r.created_at.toISOString()
        : String(r.created_at),
    steps: (r.steps ?? []) as RecordedAction["steps"],
  };
}

function fsStore(): ActionStore {
  const ROOT = path.resolve(process.env.TAPE_DIR ?? "data/tape", "actions");
  const file = (id: string) => path.join(ROOT, `${id}.json`);
  return {
    async saveAction(a) {
      await fsp.mkdir(ROOT, { recursive: true });
      await fsp.writeFile(file(a.id), JSON.stringify(a), "utf8");
    },
    async listActions() {
      if (!fs.existsSync(ROOT)) return [];
      const names = await fsp.readdir(ROOT);
      const out: RecordedAction[] = [];
      for (const n of names) {
        if (!n.endsWith(".json")) continue;
        try {
          out.push(JSON.parse(await fsp.readFile(path.join(ROOT, n), "utf8")));
        } catch {
          /* skip corrupt */
        }
      }
      return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async getAction(id) {
      try {
        return JSON.parse(await fsp.readFile(file(id), "utf8"));
      } catch {
        return null;
      }
    },
    async deleteAction(id) {
      await fsp.rm(file(id), { force: true });
    },
  };
}

const impl = usePg ? pgStore() : fsStore();

export const saveAction = impl.saveAction;
export const listActions = impl.listActions;
export const getAction = impl.getAction;
export const deleteAction = impl.deleteAction;
