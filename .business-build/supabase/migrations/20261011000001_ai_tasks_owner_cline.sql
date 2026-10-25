-- Owner Workspace AI tasks on the Railway Linux Cline worker (DNA-000218,
-- RAILWAY NATIVE CLINE RUNTIME, 2026-10-11). Extends the EXISTING ai_tasks
-- contract (same table the LINE ai-task-watcher/ai-callback pipeline uses) —
-- no parallel queue, no new authority. RLS stays service_role_only: the owner
-- session cookie bound to a task never leaves Supabase + the worker process.
alter table public.ai_tasks drop constraint if exists ai_tasks_kind_check;
alter table public.ai_tasks
  add constraint ai_tasks_kind_check check (kind in ('handle_text', 'classify_image', 'owner_cline_command'));
alter table public.ai_tasks drop constraint if exists ai_tasks_status_check;
alter table public.ai_tasks
  add constraint ai_tasks_status_check check (status in ('pending', 'processing', 'done', 'failed'));
alter table public.ai_tasks add column if not exists owner_user_id uuid;
alter table public.ai_tasks add column if not exists session_key text;
alter table public.ai_tasks add column if not exists session_cookie text;
alter table public.ai_tasks add column if not exists claimed_by text;
alter table public.ai_tasks add column if not exists claimed_at timestamptz;
alter table public.ai_tasks add column if not exists expires_at timestamptz;
create index if not exists ai_tasks_owner_cline_idx
  on public.ai_tasks (status, created_at) where kind = 'owner_cline_command';
