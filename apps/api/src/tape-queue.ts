// Best-effort, serialized tape writer.
//
// The action tape (Postgres rows + MinIO screenshots) is an audit trail, not a
// control-path dependency. Recording work must never block or fail an agent
// operation: a storage outage previously 500'd every mutating op and, worse,
// made agents retry non-idempotent actions after the desktop had already
// mutated. Everything here swallows errors (logging them) and runs off the
// request path so act() returns as soon as the real work is done.

type TapeJob = () => Promise<void>;

let tail: Promise<void> = Promise.resolve();
let depth = 0;
const MAX_DEPTH = 200;

export function enqueueTape(job: TapeJob): void {
  if (depth >= MAX_DEPTH) {
    // A dead backend must not grow memory unboundedly; drop and move on.
    console.error("tape queue full, dropping event");
    return;
  }
  depth += 1;
  tail = tail
    .then(job)
    .catch((err) => console.error("tape:", err))
    .finally(() => {
      depth -= 1;
    });
}

export function tapeQueueDepth(): number {
  return depth;
}
