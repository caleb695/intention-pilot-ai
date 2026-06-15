-- Operator v2 memory schema. Run once against the Supabase project.
-- Service-role only; no public-facing client touches these tables, so we
-- keep RLS off and grants narrow.

create table if not exists public.op_facts (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                       -- 'fact' | 'preference' | 'credential_hint'
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant all on public.op_facts to service_role;

create table if not exists public.op_tasks (
  id uuid primary key default gen_random_uuid(),
  goal text not null,
  status text not null default 'running',   -- running | done | failed | handoff
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant all on public.op_tasks to service_role;

create table if not exists public.op_checkpoints (
  task_id uuid primary key references public.op_tasks(id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
grant all on public.op_checkpoints to service_role;

create table if not exists public.op_session_state (
  id int primary key default 1,             -- singleton row
  url text,
  scroll int,
  form_values jsonb,
  updated_at timestamptz not null default now(),
  check (id = 1)
);
grant all on public.op_session_state to service_role;

create table if not exists public.op_credentials (
  id uuid primary key default gen_random_uuid(),
  site text not null,
  username text,
  secret_ciphertext text not null,          -- AES-GCM, key held only on the Space
  notes text,
  created_at timestamptz not null default now()
);
grant all on public.op_credentials to service_role;

-- updated_at trigger
create or replace function public.op_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists op_facts_touch on public.op_facts;
create trigger op_facts_touch before update on public.op_facts
  for each row execute function public.op_touch_updated_at();

drop trigger if exists op_tasks_touch on public.op_tasks;
create trigger op_tasks_touch before update on public.op_tasks
  for each row execute function public.op_touch_updated_at();

drop trigger if exists op_checkpoints_touch on public.op_checkpoints;
create trigger op_checkpoints_touch before update on public.op_checkpoints
  for each row execute function public.op_touch_updated_at();
