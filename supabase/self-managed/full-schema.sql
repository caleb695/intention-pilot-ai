
-- profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  playwright_server_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile" ON public.profiles FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- conversations
CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New conversation',
  status TEXT NOT NULL DEFAULT 'active',
  task_mode TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own conv" ON public.conversations FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX conv_user_idx ON public.conversations(user_id, updated_at DESC);

-- messages
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  model TEXT,
  tool_calls JSONB,
  tool_call_id TEXT,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own msg" ON public.messages FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX msg_conv_idx ON public.messages(conversation_id, created_at);

-- tasks
CREATE TABLE public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal TEXT NOT NULL,
  plan JSONB,
  status TEXT NOT NULL DEFAULT 'planning',
  current_step INT NOT NULL DEFAULT 0,
  total_steps INT NOT NULL DEFAULT 0,
  activity_log JSONB NOT NULL DEFAULT '[]'::jsonb,
  approved BOOLEAN NOT NULL DEFAULT false,
  mode TEXT NOT NULL DEFAULT 'one_time',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own task" ON public.tasks FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX task_user_idx ON public.tasks(user_id, updated_at DESC);

-- memories
CREATE TABLE public.memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'note',
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.memories TO authenticated;
GRANT ALL ON public.memories TO service_role;
ALTER TABLE public.memories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own mem" ON public.memories FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER t_profiles BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER t_conv BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER t_tasks BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER t_mem BEFORE UPDATE ON public.memories FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- profile auto-create on signup
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
-- Add username to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username text;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_unique ON public.profiles (lower(username)) WHERE username IS NOT NULL;

-- Table to enforce globally-unique passwords (sha256 hash). Service-role only.
CREATE TABLE IF NOT EXISTS public.password_fingerprints (
  hash text PRIMARY KEY,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.password_fingerprints TO service_role;
ALTER TABLE public.password_fingerprints ENABLE ROW LEVEL SECURITY;
-- No policies => no anon/authenticated access. Only service_role (bypasses RLS) can touch it.

-- Update handle_new_user trigger to also seed username from metadata when provided
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, username)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'username'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;

-- Ensure trigger exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS custom_instructions text;create table if not exists public.op_facts (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant all on public.op_facts to service_role;
alter table public.op_facts enable row level security;

create table if not exists public.op_tasks (
  id uuid primary key default gen_random_uuid(),
  goal text not null,
  status text not null default 'running',
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant all on public.op_tasks to service_role;
alter table public.op_tasks enable row level security;

create table if not exists public.op_checkpoints (
  task_id uuid primary key references public.op_tasks(id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
grant all on public.op_checkpoints to service_role;
alter table public.op_checkpoints enable row level security;

create table if not exists public.op_session_state (
  id int primary key default 1,
  url text,
  scroll int,
  form_values jsonb,
  updated_at timestamptz not null default now(),
  check (id = 1)
);
grant all on public.op_session_state to service_role;
alter table public.op_session_state enable row level security;

create table if not exists public.op_credentials (
  id uuid primary key default gen_random_uuid(),
  site text not null,
  username text,
  secret_ciphertext text not null,
  notes text,
  created_at timestamptz not null default now()
);
grant all on public.op_credentials to service_role;
alter table public.op_credentials enable row level security;

create or replace function public.op_touch_updated_at()
returns trigger language plpgsql
set search_path = public
as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists op_facts_touch on public.op_facts;
create trigger op_facts_touch before update on public.op_facts
  for each row execute function public.op_touch_updated_at();

drop trigger if exists op_tasks_touch on public.op_tasks;
create trigger op_tasks_touch before update on public.op_tasks
  for each row execute function public.op_touch_updated_at();

drop trigger if exists op_checkpoints_touch on public.op_checkpoints;
create trigger op_checkpoints_touch before update on public.op_checkpoints
  for each row execute function public.op_touch_updated_at();CREATE TABLE IF NOT EXISTS public.op_session_endpoint (
  id int PRIMARY KEY DEFAULT 1,
  url text,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  run_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (id = 1)
);
GRANT SELECT ON public.op_session_endpoint TO anon, authenticated;
GRANT ALL ON public.op_session_endpoint TO service_role;
ALTER TABLE public.op_session_endpoint ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read endpoint" ON public.op_session_endpoint FOR SELECT USING (true);
DROP TRIGGER IF EXISTS op_session_endpoint_touch ON public.op_session_endpoint;
CREATE TRIGGER op_session_endpoint_touch BEFORE UPDATE ON public.op_session_endpoint
  FOR EACH ROW EXECUTE FUNCTION public.op_touch_updated_at();
INSERT INTO public.op_session_endpoint (id, url) VALUES (1, NULL) ON CONFLICT (id) DO NOTHING;