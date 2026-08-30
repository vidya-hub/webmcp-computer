import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import type { TapeEvent } from "@webmcp-computer/contract";
import { pool } from "./pg.ts";
import { s3, BUCKET } from "./s3.ts";

const CAP = Number(process.env.TAPE_CAP ?? 100);

type Row = {
  id: string;
  at: Date | string;
  actor: TapeEvent["actor"];
  computer_id: string;
  op: string;
  detail: string;
  input: unknown;
  output: unknown;
  error: unknown;
  log: string | null;
  has_before: boolean;
  has_after: boolean;
};

function shotKey(computerId: string, eventId: string, side: "before" | "after") {
  return `${computerId}/${eventId}-${side}.png`;
}

function rowToEvent(r: Row): TapeEvent {
  return {
    id: r.id,
    at: r.at instanceof Date ? r.at.toISOString() : String(r.at),
    actor: r.actor,
    computerId: r.computer_id,
    op: r.op,
    detail: r.detail,
    input: r.input ?? undefined,
    output: r.output ?? undefined,
    error: (r.error ?? undefined) as string | undefined,
    log: r.log ?? undefined,
    before: r.has_before,
    after: r.has_after,
  };
}

export async function listTape(): Promise<TapeEvent[]> {
  const { rows } = await pool.query<Row>(
    "select * from tape_events order by at desc limit $1",
    [CAP],
  );
  return rows.map(rowToEvent);
}

export async function getShot(
  eventId: string,
  side: "before" | "after",
): Promise<Buffer | null> {
  const { rows } = await pool.query<{ computer_id: string }>(
    "select computer_id from tape_events where id = $1",
    [eventId],
  );
  const computerId = rows[0]?.computer_id;
  if (!computerId) return null;
  try {
    const out = await s3.send(
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: shotKey(computerId, eventId, side),
      }),
    );
    const bytes = await out.Body!.transformToByteArray();
    return Buffer.from(bytes);
  } catch {
    return null;
  }
}

export async function putShot(
  computerId: string,
  eventId: string,
  side: "before" | "after",
  bytes: Buffer,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: shotKey(computerId, eventId, side),
      Body: bytes,
      ContentType: "image/png",
    }),
  );
}

export async function appendEvent(ev: TapeEvent): Promise<void> {
  // Insert only — retention runs on a background interval (startRetention), not
  // on this hot path, so a slow MinIO can't back up the tape write queue.
  await pool.query(
    `insert into tape_events
       (id, at, actor, computer_id, op, detail, input, output, error, log, has_before, has_after)
     values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12)
     on conflict (id) do nothing`,
    [
      ev.id,
      ev.at,
      ev.actor,
      ev.computerId,
      ev.op,
      ev.detail,
      ev.input === undefined ? null : JSON.stringify(ev.input),
      ev.output === undefined ? null : JSON.stringify(ev.output),
      ev.error === undefined ? null : JSON.stringify(ev.error),
      ev.log ?? null,
      ev.before,
      ev.after,
    ],
  );
}

// Delete events past the cap and their screenshots in one pass. Safe to call on
// an interval; a single statement returns the keys to purge from object storage.
export async function pruneTape(): Promise<void> {
  const { rows: stale } = await pool.query<{ id: string; computer_id: string }>(
    `delete from tape_events
      where id in (select id from tape_events order by at desc offset $1)
      returning id, computer_id`,
    [CAP],
  );
  if (stale.length === 0) return;
  await Promise.all(
    stale.flatMap((s) =>
      (["before", "after"] as const).map((side) =>
        s3
          .send(
            new DeleteObjectCommand({
              Bucket: BUCKET,
              Key: shotKey(s.computer_id, s.id, side),
            }),
          )
          .catch(() => undefined),
      ),
    ),
  );
}
