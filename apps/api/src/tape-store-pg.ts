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

// S3 keys are namespaced by owner so tenants cannot collide or read each other.
function shotKey(
  userId: string,
  computerId: string,
  eventId: string,
  side: "before" | "after",
) {
  return `users/${userId}/tape/${computerId}/${eventId}-${side}.png`;
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

export async function listTape(userId: string): Promise<TapeEvent[]> {
  const { rows } = await pool.query<Row>(
    "select * from tape_events where user_id = $1 order by at desc limit $2",
    [userId, CAP],
  );
  return rows.map(rowToEvent);
}

export async function getShot(
  userId: string,
  eventId: string,
  side: "before" | "after",
): Promise<Buffer | null> {
  // Ownership is enforced in SQL: a wrong-owner event id returns no row → null,
  // never another tenant's screenshot.
  const { rows } = await pool.query<{ computer_id: string }>(
    "select computer_id from tape_events where id = $1 and user_id = $2",
    [eventId, userId],
  );
  const computerId = rows[0]?.computer_id;
  if (!computerId) return null;
  try {
    const out = await s3.send(
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: shotKey(userId, computerId, eventId, side),
      }),
    );
    const bytes = await out.Body!.transformToByteArray();
    return Buffer.from(bytes);
  } catch {
    return null;
  }
}

export async function putShot(
  userId: string,
  computerId: string,
  eventId: string,
  side: "before" | "after",
  bytes: Buffer,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: shotKey(userId, computerId, eventId, side),
      Body: bytes,
      ContentType: "image/png",
    }),
  );
}

export async function appendEvent(
  userId: string,
  ev: TapeEvent,
): Promise<void> {
  // Insert only — retention runs on a background interval (startRetention), not
  // on this hot path, so a slow MinIO can't back up the tape write queue.
  await pool.query(
    `insert into tape_events
       (id, user_id, at, actor, computer_id, op, detail, input, output, error, log, has_before, has_after)
     values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13)
     on conflict (id) do nothing`,
    [
      ev.id,
      userId,
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

// Delete events past the cap PER USER (not a global OFFSET) and their
// screenshots in one pass. Safe to call on an interval.
export async function pruneTape(): Promise<void> {
  const { rows: stale } = await pool.query<{
    id: string;
    user_id: string;
    computer_id: string;
  }>(
    `delete from tape_events
      where id in (
        select id from (
          select id,
                 row_number() over (partition by user_id order by at desc) as rn
            from tape_events
        ) t where rn > $1
      )
      returning id, user_id, computer_id`,
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
              Key: shotKey(s.user_id, s.computer_id, s.id, side),
            }),
          )
          .catch(() => undefined),
      ),
    ),
  );
}
