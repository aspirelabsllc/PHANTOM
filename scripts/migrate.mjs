// One-off migration: phantom_projects table + RLS + private storage bucket.
// Run: node scripts/migrate.mjs
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";

// --- load .env.local (no dotenv dep) ---
const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const SQL = `
create extension if not exists pgcrypto;

create table if not exists public.phantom_projects (
  id           uuid primary key default gen_random_uuid(),
  owner        uuid not null references auth.users(id) on delete cascade,
  name         text not null default 'Untitled Invocation',
  state        text not null default 'dormant'
                 check (state in ('manifested','condensing','dormant')),
  brand        jsonb,
  offerings    jsonb not null default '[]'::jsonb,
  domain       text,
  thumb        text,
  progress     int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists phantom_projects_owner_idx on public.phantom_projects (owner, created_at desc);

-- the CodeSandbox VM backing this project's Manifest (site build)
alter table public.phantom_projects add column if not exists sandbox_id text;

-- the Agent SDK session id, so build turns resume the same conversation
alter table public.phantom_projects add column if not exists agent_session_id text;

-- the claimed apparition ('one'|'two'|'three'; null = summons still open)
alter table public.phantom_projects add column if not exists chosen_variant text;

-- per-variant Agent SDK session ids, so each apparition keeps its own memory
alter table public.phantom_projects add column if not exists agent_sessions jsonb not null default '{}'::jsonb;

-- atomic offering append: the image gateway registers conjured assets from
-- concurrent agent runs, so a read-modify-write would lose updates
create or replace function public.phantom_append_offering(pid uuid, off jsonb)
returns void language sql security definer set search_path = public as $$
  update public.phantom_projects
     set offerings = coalesce(offerings, '[]'::jsonb) || jsonb_build_array(off),
         updated_at = now()
   where id = pid;
$$;

-- the in-flight build turn: {started_at, expect:[variants], got:[variants]}.
-- null = no build running. Set by the build route, cleared atomically as the
-- VM-side runners report in (survives route death and app restarts).
alter table public.phantom_projects add column if not exists building jsonb;

-- a runner finished: merge its session, mark its variant done, and clear
-- building when every expected variant has reported. Row lock serializes
-- concurrent finishers.
create or replace function public.phantom_finish_variant(pid uuid, v text, sess text)
returns void language sql security definer set search_path = public as $$
  update public.phantom_projects
     set agent_sessions = coalesce(agent_sessions, '{}'::jsonb)
           || case when sess is null or sess = '' then '{}'::jsonb
                   else jsonb_build_object(v, sess) end,
         building = case
           when building is null then null
           when (building->'expect') <@ (coalesce(building->'got', '[]'::jsonb) || jsonb_build_array(v))
             then null
           else jsonb_set(building, '{got}', coalesce(building->'got', '[]'::jsonb) || jsonb_build_array(v))
         end,
         updated_at = now()
   where id = pid;
$$;

alter table public.phantom_projects enable row level security;

drop policy if exists "own_select" on public.phantom_projects;
drop policy if exists "own_insert" on public.phantom_projects;
drop policy if exists "own_update" on public.phantom_projects;
drop policy if exists "own_delete" on public.phantom_projects;

create policy "own_select" on public.phantom_projects for select using (owner = auth.uid());
create policy "own_insert" on public.phantom_projects for insert with check (owner = auth.uid());
create policy "own_update" on public.phantom_projects for update using (owner = auth.uid());
create policy "own_delete" on public.phantom_projects for delete using (owner = auth.uid());

-- durable build-chat transcript (one row per streamed event; ordered by seq)
create table if not exists public.phantom_messages (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.phantom_projects(id) on delete cascade,
  role         text not null check (role in ('user','phantom')),
  kind         text not null default 'say'
                 check (kind in ('say','log','error')),
  content      jsonb not null default '{}'::jsonb,
  seq          bigserial,
  created_at   timestamptz not null default now()
);

create index if not exists phantom_messages_project_idx
  on public.phantom_messages (project_id, seq);

alter table public.phantom_messages enable row level security;

drop policy if exists "msg_own_select" on public.phantom_messages;
drop policy if exists "msg_own_insert" on public.phantom_messages;
drop policy if exists "msg_own_delete" on public.phantom_messages;

-- ownership flows through the parent project row (RLS on phantom_projects)
create policy "msg_own_select" on public.phantom_messages for select using (
  exists (select 1 from public.phantom_projects p
          where p.id = project_id and p.owner = auth.uid()));
create policy "msg_own_insert" on public.phantom_messages for insert with check (
  exists (select 1 from public.phantom_projects p
          where p.id = project_id and p.owner = auth.uid()));
create policy "msg_own_delete" on public.phantom_messages for delete using (
  exists (select 1 from public.phantom_projects p
          where p.id = project_id and p.owner = auth.uid()));

-- shared secret between the app and this project's in-VM daemon (control auth)
alter table public.phantom_projects add column if not exists daemon_secret text;

-- per-project plugin registry: [{name, repo, enabled}]. null = use the built-in
-- default set (ui-ux-pro-max + image generation). User-toggled in the UI.
alter table public.phantom_projects add column if not exists plugins jsonb;

-- the full agent event stream (M8): one row per SDK event, written by the
-- in-VM daemon through POST /api/events (service role). seq is assigned by
-- the daemon and monotonic per project; the UI orders and de-dupes on it.
create table if not exists public.phantom_events (
  id           bigserial primary key,
  project_id   uuid not null references public.phantom_projects(id) on delete cascade,
  seq          bigint not null,
  turn_id      text,
  type         text not null,
  payload      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  unique (project_id, seq)
);

create index if not exists phantom_events_project_idx
  on public.phantom_events (project_id, seq);

alter table public.phantom_events enable row level security;

drop policy if exists "evt_own_select" on public.phantom_events;
drop policy if exists "evt_own_delete" on public.phantom_events;

-- reads flow through project ownership; inserts happen only via service role
create policy "evt_own_select" on public.phantom_events for select using (
  exists (select 1 from public.phantom_projects p
          where p.id = project_id and p.owner = auth.uid()));
create policy "evt_own_delete" on public.phantom_events for delete using (
  exists (select 1 from public.phantom_projects p
          where p.id = project_id and p.owner = auth.uid()));
`;

const pg = new Client({ connectionString: env.SUPABASE_DATABASE_URL });
await pg.connect();
await pg.query(SQL);
console.log("✓ phantom_projects + phantom_messages tables + RLS ready");
await pg.end();

// --- private storage bucket (idempotent) ---
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
const { data: buckets } = await admin.storage.listBuckets();
if (!buckets?.some((b) => b.name === "phantom-offerings")) {
  const { error } = await admin.storage.createBucket("phantom-offerings", {
    public: false,
    fileSizeLimit: "26214400", // 25 MB per offering
  });
  if (error) throw error;
  console.log("✓ created private bucket phantom-offerings");
} else {
  console.log("✓ bucket phantom-offerings already exists");
}
console.log("migration complete");
