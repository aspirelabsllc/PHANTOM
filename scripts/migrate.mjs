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
