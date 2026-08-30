// Home-archive storage: the tar.gz blob lives in object storage, metadata in
// Postgres (fs fallback for dev). Archives are user work saved on destroy and
// seeded into a future computer — not a full VM/profile clone.

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
  putArchive(id: string, name: string | undefined, computerId: string, bytes: Buffer): Promise<HomeArchive>;
  getArchiveBytes(id: string): Promise<Buffer | null>;
  listArchives(): Promise<HomeArchive[]>;
  getArchive(id: string): Promise<HomeArchive | null>;
  deleteArchive(id: string): Promise<void>;
}

function key(id: string): string {
  return `homes/${id}.tar.gz`;
}

function pgStore(): ArchiveStore {
  const poolPromise = import("./pg.ts").then((m) => m.pool);
  const s3Promise = import("./s3.ts");
  return {
    async putArchive(id, name, computerId, bytes) {
      const { s3, BUCKET } = await s3Promise;
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      try {
        await s3.send(
          new PutObjectCommand({
            Bucket: BUCKET,
            Key: key(id),
            Body: bytes,
            ContentType: "application/gzip",
          }),
        );
        const pool = await poolPromise;
        const createdAt = new Date().toISOString();
        await pool.query(
          `insert into home_archives (id, name, computer_id, size_bytes, created_at)
           values ($1,$2,$3,$4,$5)`,
          [id, name ?? null, computerId, bytes.length, createdAt],
        );
        return { id, name, computerId, sizeBytes: bytes.length, createdAt };
      } catch (err) {
        // Never leave a partial blob without a row.
        await deletePgBlob(id).catch(() => undefined);
        throw err;
      }
    },
    async getArchiveBytes(id) {
      const { s3, BUCKET } = await s3Promise;
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      try {
        const res = await s3.send(
          new GetObjectCommand({ Bucket: BUCKET, Key: key(id) }),
        );
        const body = res.Body as unknown as AsyncIterable<Uint8Array>;
        const chunks: Buffer[] = [];
        for await (const c of body) chunks.push(Buffer.from(c));
        return Buffer.concat(chunks);
      } catch {
        return null;
      }
    },
    async listArchives() {
      const pool = await poolPromise;
      const { rows } = await pool.query(
        `select id, name, computer_id, size_bytes, created_at
           from home_archives order by created_at desc limit 200`,
      );
      return rows.map(rowToArchive);
    },
    async getArchive(id) {
      const pool = await poolPromise;
      const { rows } = await pool.query(
        `select id, name, computer_id, size_bytes, created_at
           from home_archives where id = $1`,
        [id],
      );
      return rows[0] ? rowToArchive(rows[0]) : null;
    },
    async deleteArchive(id) {
      const pool = await poolPromise;
      await pool.query("delete from home_archives where id = $1", [id]);
      await deletePgBlob(id).catch(() => undefined);
    },
  };

  async function deletePgBlob(id: string): Promise<void> {
    const { s3, BUCKET } = await s3Promise;
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key(id) }));
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
  const ROOT = path.resolve(process.env.TAPE_DIR ?? "data/tape", "homes");
  const blob = (id: string) => path.join(ROOT, `${id}.tar.gz`);
  const meta = (id: string) => path.join(ROOT, `${id}.json`);
  return {
    async putArchive(id, name, computerId, bytes) {
      await fsp.mkdir(ROOT, { recursive: true });
      await fsp.writeFile(blob(id), bytes);
      const rec: HomeArchive = {
        id,
        name,
        computerId: computerId as HomeArchive["computerId"],
        sizeBytes: bytes.length,
        createdAt: new Date().toISOString(),
      };
      await fsp.writeFile(meta(id), JSON.stringify(rec), "utf8");
      return rec;
    },
    async getArchiveBytes(id) {
      try {
        return await fsp.readFile(blob(id));
      } catch {
        return null;
      }
    },
    async listArchives() {
      if (!fs.existsSync(ROOT)) return [];
      const names = await fsp.readdir(ROOT);
      const out: HomeArchive[] = [];
      for (const n of names) {
        if (!n.endsWith(".json")) continue;
        try {
          out.push(JSON.parse(await fsp.readFile(path.join(ROOT, n), "utf8")));
        } catch {
          /* skip */
        }
      }
      return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async getArchive(id) {
      try {
        return JSON.parse(await fsp.readFile(meta(id), "utf8"));
      } catch {
        return null;
      }
    },
    async deleteArchive(id) {
      await fsp.rm(blob(id), { force: true });
      await fsp.rm(meta(id), { force: true });
    },
  };
}

const impl = usePg ? pgStore() : fsStore();

export const putArchive = impl.putArchive;
export const getArchiveBytes = impl.getArchiveBytes;
export const listArchives = impl.listArchives;
export const getArchive = impl.getArchive;
export const deleteArchive = impl.deleteArchive;
