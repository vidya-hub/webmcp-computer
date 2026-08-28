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
