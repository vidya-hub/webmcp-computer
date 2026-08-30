// Selects the tape backend at startup: Postgres + MinIO when configured
// (STORAGE_BACKEND=pg, or DATABASE_URL + S3 creds present), else the local
// filesystem store used for laptop/dev + tests.
const usePg =
  process.env.STORAGE_BACKEND === "pg" ||
  (!!process.env.DATABASE_URL && !!process.env.S3_ACCESS_KEY);

const impl = usePg
  ? await import("./tape-store-pg.ts")
  : await import("./tape-store-fs.ts");

export const listTape = impl.listTape;
export const getShot = impl.getShot;
export const putShot = impl.putShot;
export const appendEvent = impl.appendEvent;
export const pruneTape = impl.pruneTape;

// Run retention on an interval instead of on every write. Guarded against
// overlap; errors are logged, never thrown.
export function startRetention(intervalMs = 60_000): void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await pruneTape();
    } catch (err) {
      console.error("tape retention:", err);
    } finally {
      running = false;
    }
  };
  const t = setInterval(tick, intervalMs);
  t.unref?.();
  void tick();
}
