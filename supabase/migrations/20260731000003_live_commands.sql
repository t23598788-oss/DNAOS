-- Live Commands (owner, 2026-07-31): "กูสั่งจาก LINE โน้ตบุ๊กนี้ขยับตามได้เลยแหละ"
-- — a command typed into LINE by the owner should live-push to whatever
-- admin dashboard tab the owner already has open, not just reply in LINE.
--
-- This table is the bridge: supabase/functions/line-webhook-v2/handlers/text.ts
-- inserts one row per owner command (after running it through the same
-- cognitive/pipeline.ts the dashboard's own SecretaryChat uses), and the
-- dashboard subscribes to it via Supabase Realtime to navigate/react live.
create table if not exists live_commands (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null,
  command_text text not null,
  reply_text text,
  navigate_url text,
  workspace jsonb,
  created_at timestamptz not null default now()
);

create index if not exists live_commands_line_user_id_created_at_idx
  on live_commands (line_user_id, created_at desc);

alter table live_commands enable row level security;

-- Read-only for the dashboard's realtime subscription (anon key, single-owner
-- dev-phase system — see feedback_single_owner_dev_phase_auth.md, admin auth
-- is a separate cookie-based gate, not Supabase Auth, so RLS here can't key
-- off auth.uid()). Writes only ever come from the service role (Edge Function).
create policy "live_commands_select_anon" on live_commands
  for select
  to anon, authenticated
  using (true);

-- add to realtime only when the publication exists (Supabase); plain Postgres skips
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'live_commands'
     ) then
    alter publication supabase_realtime add table public.live_commands;
  end if;
end
$$;
