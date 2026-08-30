-- Recipes (Teach & Replay) and home archives.
--
-- Applied by the migration runner (apps/api/src/migrate.ts) in numeric order and
-- recorded in schema_migrations. `if not exists` keeps it safe over a legacy DB
-- that predates the runner; 003 later recreates these with a NOT NULL user_id.

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
