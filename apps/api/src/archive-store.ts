// Home-archive storage: the tar.gz blob lives in object storage, metadata in
// Postgres (fs fallback for dev). Archives are user work saved on destroy and
// seeded into a future computer — not a full VM/profile clone.
//
// Every operation is scoped to the owning userId; blobs are namespaced under
// users/{userId}/homes/ and metadata carries user_id, so restore/list/delete
// can never touch another tenant's archive.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { HomeArchive } from "@webmcp-computer/contract";

export const ARCHIVE_EXCLUDES = [
  "node_modules",
  ".cache",
  ".npm",
  "Notes/shots",
  ".config/chromium",
  ".vnc",
  ".Xauthority",
  ".local/share/Trash",
];

export const ARCHIVE_CAP_BYTES = 512 * 1024 * 1024;

const usePg =
  process.env.STORAGE_BACKEND === "pg" ||
  (!!process.env.DATABASE_URL && !!process.env.S3_ACCESS_KEY);

export interface ArchiveStore {
  putArchive(
    userId: string,
    id: string,
    name: string | undefined,
    computerId: string,
    bytes: Buffer,
  ): Promise<HomeArchive>;
  getArchiveBytes(userId: string, id: string): Promise<Buffer | null>;
  listArchives(userId: string): Promise<HomeArchive[]>;
  getArchive(userId: string, id: string): Promise<HomeArchive | null>;
  /** True if a row was deleted; false if none matched (unknown/other owner). */
  deleteArchive(userId: string, id: string): Promise<boolean>;
}

function key(userId: string, id: string): string {
  return `users/${userId}/homes/${id}.tar.gz`;
}

function pgStore(): ArchiveStore {
  const poolPromise = import("./pg.ts").then((m) => m.pool);
  const s3Promise = import("./s3.ts");
  return {
    async putArchive(userId, id, name, computerId, bytes) {
      const { s3, BUCKET } = await s3Promise;
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      try {
        await s3.send(
          new PutObjectCommand({
            Bucket: BUCKET,
            Key: key(userId, id),
            Body: bytes,
            ContentType: "application/gzip",
          }),
        );
        const pool = await poolPromise;
        const createdAt = new Date().toISOString();
        await pool.query(
          `insert into home_archives (id, user_id, name, computer_id, size_bytes, created_at)
           values ($1,$2,$3,$4,$5,$6)`,
          [id, userId, name ?? null, computerId, bytes.length, createdAt],
        );
        return { id, name, computerId, sizeBytes: bytes.length, createdAt };
      } catch (err) {
        // Never leave a partial blob without a row.
        await deletePgBlob(userId, id).catch(() => undefined);
        throw err;
      }
    },
    async getArchiveBytes(userId, id) {
      const pool = await poolPromise;
      const { rows } = await pool.query(
        "select 1 from home_archives where id = $1 and user_id = $2",
        [id, userId],
      );
      if (!rows[0]) return null; // not this user's archive
      const { s3, BUCKET } = await s3Promise;
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      try {
        const res = await s3.send(
          new GetObjectCommand({ Bucket: BUCKET, Key: key(userId, id) }),
        );
        const body = res.Body as unknown as AsyncIterable<Uint8Array>;
        const chunks: Buffer[] = [];
        for await (const c of body) chunks.push(Buffer.from(c));
        return Buffer.concat(chunks);
      } catch {
        return null;
      }
    },
    async listArchives(userId) {
      const pool = await poolPromise;
      const { rows } = await pool.query(
        `select id, name, computer_id, size_bytes, created_at
           from home_archives where user_id = $1
           order by created_at desc limit 200`,
        [userId],
      );
      return rows.map(rowToArchive);
    },
    async getArchive(userId, id) {
      const pool = await poolPromise;
      const { rows } = await pool.query(
        `select id, name, computer_id, size_bytes, created_at
           from home_archives where id = $1 and user_id = $2`,
        [id, userId],
      );
      return rows[0] ? rowToArchive(rows[0]) : null;
    },
    async deleteArchive(userId, id) {
      const pool = await poolPromise;
      const { rowCount } = await pool.query(
        "delete from home_archives where id = $1 and user_id = $2",
        [id, userId],
      );
      if (rowCount) await deletePgBlob(userId, id).catch(() => undefined);
      return (rowCount ?? 0) > 0;
    },
  };

  async function deletePgBlob(userId: string, id: string): Promise<void> {
    const { s3, BUCKET } = await s3Promise;
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key(userId, id) }));
  }
}

function rowToArchive(r: Record<string, unknown>): HomeArchive {
  return {
    id: String(r.id),
    name: r.name ? String(r.name) : undefined,
    computerId: String(r.computer_id) as HomeArchive["computerId"],
    sizeBytes: Number(r.size_bytes),
    createdAt:
      r.created_at instanceof Date
        ? r.created_at.toISOString()
        : String(r.created_at),
  };
}

function fsStore(): ArchiveStore {
  const base = path.resolve(process.env.TAPE_DIR ?? "data/tape");
  const dir = (userId: string) => path.join(base, userId, "homes");
  const blob = (userId: string, id: string) =>
    path.join(dir(userId), `${id}.tar.gz`);
  const meta = (userId: string, id: string) =>
    path.join(dir(userId), `${id}.json`);
  return {
    async putArchive(userId, id, name, computerId, bytes) {
      await fsp.mkdir(dir(userId), { recursive: true });
      await fsp.writeFile(blob(userId, id), bytes);
      const rec: HomeArchive = {
        id,
        name,
        computerId: computerId as HomeArchive["computerId"],
        sizeBytes: bytes.length,
        createdAt: new Date().toISOString(),
      };
      await fsp.writeFile(meta(userId, id), JSON.stringify(rec), "utf8");
      return rec;
    },
    async getArchiveBytes(userId, id) {
      try {
        return await fsp.readFile(blob(userId, id));
      } catch {
        return null;
      }
    },
    async listArchives(userId) {
      const root = dir(userId);
      if (!fs.existsSync(root)) return [];
      const names = await fsp.readdir(root);
      const out: HomeArchive[] = [];
      for (const n of names) {
        if (!n.endsWith(".json")) continue;
        try {
          out.push(JSON.parse(await fsp.readFile(path.join(root, n), "utf8")));
        } catch {
          /* skip */
        }
      }
      return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async getArchive(userId, id) {
      try {
        return JSON.parse(await fsp.readFile(meta(userId, id), "utf8"));
      } catch {
        return null;
      }
    },
    async deleteArchive(userId, id) {
      let existed = false;
      try {
        await fsp.access(meta(userId, id));
        existed = true;
      } catch {
        existed = false;
      }
      await fsp.rm(blob(userId, id), { force: true });
      await fsp.rm(meta(userId, id), { force: true });
      return existed;
    },
  };
}

const impl = usePg ? pgStore() : fsStore();

export const putArchive = impl.putArchive;
export const getArchiveBytes = impl.getArchiveBytes;
export const listArchives = impl.listArchives;
export const getArchive = impl.getArchive;
export const deleteArchive = impl.deleteArchive;
