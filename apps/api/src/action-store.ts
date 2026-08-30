// Recorded-action storage. Actions are small JSON documents (no blobs), so the
// pg and fs backends both live here and are chosen the same way as the tape
// store: Postgres when configured, else the local filesystem for dev/tests.
//
// Every operation is scoped to the owning userId (multi-tenant). A get/delete
// for another user's action returns null / no-op — never another tenant's row.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { RecordedAction } from "@webmcp-computer/contract";

const usePg =
  process.env.STORAGE_BACKEND === "pg" ||
  (!!process.env.DATABASE_URL && !!process.env.S3_ACCESS_KEY);

export interface ActionStore {
  saveAction(userId: string, action: RecordedAction): Promise<void>;
  listActions(userId: string): Promise<RecordedAction[]>;
  getAction(userId: string, id: string): Promise<RecordedAction | null>;
  /** True if a row was deleted; false if none matched (unknown/other owner). */
  deleteAction(userId: string, id: string): Promise<boolean>;
}

function pgStore(): ActionStore {
  // Lazily import so the fs path never pulls in pg.
  const poolPromise = import("./pg.ts").then((m) => m.pool);
  return {
    async saveAction(userId, a) {
      const pool = await poolPromise;
      await pool.query(
        `insert into recorded_actions
           (id, user_id, name, description, source, computer_id, created_at, steps)
         values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
         on conflict (id) do update set
           name = excluded.name, description = excluded.description,
           source = excluded.source, steps = excluded.steps
         where recorded_actions.user_id = excluded.user_id`,
        [
          a.id,
          userId,
          a.name,
          a.description,
          a.source,
          a.computerId ?? null,
          a.createdAt,
          JSON.stringify(a.steps),
        ],
      );
    },
    async listActions(userId) {
      const pool = await poolPromise;
      const { rows } = await pool.query(
        `select id, name, description, source, computer_id, created_at, steps
           from recorded_actions where user_id = $1
           order by created_at desc limit 200`,
        [userId],
      );
      return rows.map(rowToAction);
    },
    async getAction(userId, id) {
      const pool = await poolPromise;
      const { rows } = await pool.query(
        `select id, name, description, source, computer_id, created_at, steps
           from recorded_actions where id = $1 and user_id = $2`,
        [id, userId],
      );
      return rows[0] ? rowToAction(rows[0]) : null;
    },
    async deleteAction(userId, id) {
      const pool = await poolPromise;
      const { rowCount } = await pool.query(
        "delete from recorded_actions where id = $1 and user_id = $2",
        [id, userId],
      );
      return (rowCount ?? 0) > 0;
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
  const base = path.resolve(process.env.TAPE_DIR ?? "data/tape");
  const dir = (userId: string) => path.join(base, userId, "actions");
  const file = (userId: string, id: string) =>
    path.join(dir(userId), `${id}.json`);
  return {
    async saveAction(userId, a) {
      await fsp.mkdir(dir(userId), { recursive: true });
      await fsp.writeFile(file(userId, a.id), JSON.stringify(a), "utf8");
    },
    async listActions(userId) {
      const root = dir(userId);
      if (!fs.existsSync(root)) return [];
      const names = await fsp.readdir(root);
      const out: RecordedAction[] = [];
      for (const n of names) {
        if (!n.endsWith(".json")) continue;
        try {
          out.push(JSON.parse(await fsp.readFile(path.join(root, n), "utf8")));
        } catch {
          /* skip corrupt */
        }
      }
      return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async getAction(userId, id) {
      try {
        return JSON.parse(await fsp.readFile(file(userId, id), "utf8"));
      } catch {
        return null;
      }
    },
    async deleteAction(userId, id) {
      const f = file(userId, id);
      try {
        await fsp.access(f);
      } catch {
        return false;
      }
      await fsp.rm(f, { force: true });
      return true;
    },
  };
}

const impl = usePg ? pgStore() : fsStore();

export const saveAction = impl.saveAction;
export const listActions = impl.listActions;
export const getAction = impl.getAction;
export const deleteAction = impl.deleteAction;
