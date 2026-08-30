-- 003: authentication + multi-tenancy.
--
-- WIPE-CLEAN (dev host, decided): the owner-scoped data tables (tape_events,
-- recorded_actions, home_archives) are dropped and recreated with a NOT NULL
-- user_id. There is no backfill; existing rows and unlabeled containers are
-- discarded on deploy. Applied exactly once via the migration runner
-- (apps/api/src/migrate.ts), which records it in schema_migrations.

-- Accounts -------------------------------------------------------------------
create table if not exists users (
  id            text primary key,
  email         text not null unique,          -- stored lowercased
  password_hash text not null,
  created_at    timestamptz not null default now()
);

-- Rotating refresh sessions. reuse of a rotated token revokes the whole family.
create table if not exists auth_sessions (
  sid          text primary key,
  user_id      text not null references users(id) on delete cascade,
  family_id    text not null,
  refresh_hash text not null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz
);
create index if not exists auth_sessions_user_idx   on auth_sessions (user_id);
create index if not exists auth_sessions_family_idx on auth_sessions (family_id);

-- Per-user quotas (source of truth, not a compiled constant).
create table if not exists quotas (
  user_id       text primary key references users(id) on delete cascade,
  max_computers int not null default 4
);

-- Computer ownership + placement. Control stores placement; it does not assume
-- it is the only worker.
create table if not exists computers (
  id         text primary key,
  user_id    text not null references users(id) on delete cascade,
  worker_id  text not null default 'worker-0',
  sku        text not null default 'desktop.standard',
  name       text,
  status     text not null default 'starting',
  created_at timestamptz not null default now()
);
create index if not exists computers_user_idx on computers (user_id, created_at desc);

-- Owner-scoped data tables: wipe + recreate with NOT NULL user_id ------------
drop table if exists tape_events;
create table tape_events (
  id          text primary key,
  user_id     text not null,
  at          timestamptz not null default now(),
  actor       text,
  computer_id text not null,
  op          text,
  detail      text,
  input       jsonb,
  output      jsonb,
  error       jsonb,
  has_before  boolean not null default false,
  has_after   boolean not null default false,
  log         text
);
create index tape_events_user_at_idx  on tape_events (user_id, at desc);
create index tape_events_computer_idx on tape_events (computer_id, at desc);

drop table if exists recorded_actions;
create table recorded_actions (
  id          text primary key,
  user_id     text not null,
  name        text not null,
  description text not null,
  source      text not null default 'authored',   -- 'tape' | 'authored' | 'recorded'
  computer_id text,
  created_at  timestamptz not null default now(),
  steps       jsonb not null
);
create index recorded_actions_user_idx on recorded_actions (user_id, created_at desc);

drop table if exists home_archives;
create table home_archives (
  id          text primary key,
  user_id     text not null,
  name        text,
  computer_id text not null,
  size_bytes  bigint not null,
  created_at  timestamptz not null default now()
);
create index home_archives_user_idx on home_archives (user_id, created_at desc);
