-- Recipes (Teach & Replay) and home archives.
--
-- 001_init.sql only runs on first DB init, so the API also creates these at
-- boot via ensureSchema() in apps/api/src/pg.ts. This file documents the schema
-- and can be applied by hand to an existing database:
--   psql "$DATABASE_URL" -f deploy/db/002_actions_archives.sql

create table if not exists recorded_actions (
  id text primary key,
  name text not null,
  description text not null,
  source text not null default 'authored',   -- 'tape' | 'authored'
  computer_id text,                            -- origin metadata, not a target
  created_at timestamptz not null default now(),
  steps jsonb not null                         -- RecipeStep[]
);
create index if not exists recorded_actions_created_idx
  on recorded_actions (created_at desc);

create table if not exists home_archives (
  id text primary key,
  name text,
  computer_id text not null,
  size_bytes bigint not null,
  created_at timestamptz not null default now()
);
create index if not exists home_archives_created_idx
  on home_archives (created_at desc);
