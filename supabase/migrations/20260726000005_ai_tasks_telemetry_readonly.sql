-- Real-Time 3D Telemetry (owner, 2026-07-26): the admin globe view needs to
-- watch real ai_tasks rows change (pending -> done) to fire a real command
-- beam / ACK reflection beam, not a fake animation loop. ai_tasks itself is
-- `service_role_only using (false)` (20260725000006_ai_tasks.sql) — correct
-- for the Deno/local-watcher write path, but that also blocks the browser's
-- authenticated read for this dashboard. Reusing the exact existing
-- admin-read pattern (`is_admin_workspace_user()`, from
-- 20260720000001_line_events_realtime.sql) instead of inventing a new
-- function — this is read-only telemetry, no new write surface.
do $$
begin
  -- add to realtime only when the publication exists (Supabase); plain Postgres skips
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'ai_tasks'
  ) then
    alter publication supabase_realtime add table public.ai_tasks;
  end if;
end
$$;

drop policy if exists admin_workspace_read_ai_tasks on public.ai_tasks;
create policy admin_workspace_read_ai_tasks
  on public.ai_tasks
  for select
  to authenticated
  using (public.is_admin_workspace_user());
