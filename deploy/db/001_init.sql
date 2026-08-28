-- Action tape (mutating POST /api/act events). Screenshots live in MinIO;
-- this table holds the event metadata + input/output. Newest-first, capped in app.
CREATE TABLE IF NOT EXISTS tape_events (
  id          text PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  actor       text,
  computer_id text NOT NULL,
  op          text,
  detail      text,
  input       jsonb,
  output      jsonb,
  error       jsonb,
  has_before  boolean NOT NULL DEFAULT false,
  has_after   boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS tape_events_at_idx ON tape_events (at DESC);
CREATE INDEX IF NOT EXISTS tape_events_computer_idx ON tape_events (computer_id, at DESC);
