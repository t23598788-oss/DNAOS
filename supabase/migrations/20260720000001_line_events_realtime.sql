-- LINE chat is the live source of truth for the admin workspace.
-- Company matching remains optional enrichment and must not block read/display.

do $$
begin
  -- add to realtime only when the publication exists (Supabase); plain Postgres skips
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'line_events'
  ) then
    alter publication supabase_realtime add table public.line_events;
  end if;
end
$$;

create or replace function public.is_admin_workspace_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('super_admin', 'admin', 'employee')
  );
$$;

revoke all on function public.is_admin_workspace_user() from public;
grant execute on function public.is_admin_workspace_user() to authenticated;

drop policy if exists admin_workspace_read_line_events on public.line_events;
create policy admin_workspace_read_line_events
  on public.line_events
  for select
  to authenticated
  using (public.is_admin_workspace_user());
