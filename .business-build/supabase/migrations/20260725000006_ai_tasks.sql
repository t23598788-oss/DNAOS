-- Local-AI task queue (owner, 2026-07-25): "ย้ายทุกอย่างมาประมวลผลในเครื่อง
-- Mac" — root cause found live: ANTHROPIC_API_KEY was never actually set as
-- a Supabase secret (confirmed via `supabase secrets list`), so every
-- Claude call in the LINE webhook (document classification, tool routing,
-- conversational fallback) has been silently failing since it was built —
-- not a PII-refusal issue as first (wrongly) diagnosed. The owner has no
-- cloud AI budget and explicitly wants everything processed locally via
-- Ollama on his own Mac instead of buying a cloud API key.
--
-- Same bridge pattern as print_jobs (Deno edge function can't reach a
-- process on the owner's home WiFi) but inverted: the cloud webhook can't
-- reach the Mac, so instead of the Mac polling for print jobs, it polls
-- this queue for AI work, does it locally with Ollama, and pushes the LINE
-- reply itself (not via replyToken — those expire in ~1 minute, too short
-- for a 20-30s poll interval; the local watcher uses the LINE push API).
create table if not exists public.ai_tasks (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('handle_text', 'classify_image')),
  line_user_id text not null,
  line_event_id uuid,
  input_text text,
  media_path text,
  status text not null default 'pending'
    check (status in ('pending', 'done', 'failed')),
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists ai_tasks_status_idx on public.ai_tasks (status);

alter table public.ai_tasks enable row level security;

create policy service_role_only on public.ai_tasks
  for all using (false);
