-- Owner instruction 2026-07-10: every schema change (new table, dropped
-- table, altered column — anything) must be logged BEFORE it starts and
-- AFTER it finishes, no matter who or what makes the change (AI, human,
-- Prisma, psql, anything with the DB password). App-level conventions
-- (registry/module-registry.json etc.) can't catch this — the incident that
-- prompted this rule (pit_profiles/pit_materials/vehicle_types dropped, ~30
-- unrelated tables appeared) happened via a RAW database connection that
-- never touched this app or its git history at all. Only a Postgres event
-- trigger is enforced regardless of which client connects — that's why this
-- lives in the database itself, not in application code.

create table if not exists public.schema_change_log (
  id            bigint generated always as identity primary key,
  phase         text not null check (phase in ('start', 'end')),
  command_tag   text not null,
  object_type   text,
  object_identity text,
  executed_by   text not null default current_user,
  client_addr   inet,
  occurred_at   timestamptz not null default now()
);

alter table public.schema_change_log enable row level security;
drop policy if exists service_role_only on public.schema_change_log;
create policy service_role_only on public.schema_change_log for all using (false);

-- "Before" — fires the moment a DDL command begins, before it has taken
-- effect. Doesn't yet know the object identity (it may not exist yet, e.g.
-- CREATE TABLE), only the command being attempted.
create or replace function public.log_ddl_start()
returns event_trigger
language plpgsql
security definer
as $$
begin
  insert into public.schema_change_log (phase, command_tag, client_addr)
  values ('start', tg_tag, inet_client_addr());
end;
$$;

-- "After" — fires once the DDL command has completed, with the real object
-- identity now resolvable (per-object, since one statement can affect
-- several objects, e.g. DROP TABLE a, b).
create or replace function public.log_ddl_end()
returns event_trigger
language plpgsql
security definer
as $$
declare
  obj record;
begin
  for obj in select * from pg_event_trigger_ddl_commands() loop
    insert into public.schema_change_log (phase, command_tag, object_type, object_identity, client_addr)
    values ('end', obj.command_tag, obj.object_type, obj.object_identity, inet_client_addr());
  end loop;
end;
$$;

-- "After" for drops — pg_event_trigger_ddl_commands() doesn't report DROPped
-- objects (they're gone by the time it runs), so DROP needs its own hook.
create or replace function public.log_ddl_drop()
returns event_trigger
language plpgsql
security definer
as $$
declare
  obj record;
begin
  for obj in select * from pg_event_trigger_dropped_objects() loop
    insert into public.schema_change_log (phase, command_tag, object_type, object_identity, client_addr)
    values ('end', 'DROP', obj.object_type, obj.object_identity, inet_client_addr());
  end loop;
end;
$$;

drop event trigger if exists dna_os_ddl_start;
create event trigger dna_os_ddl_start
  on ddl_command_start
  execute function public.log_ddl_start();

drop event trigger if exists dna_os_ddl_end;
create event trigger dna_os_ddl_end
  on ddl_command_end
  execute function public.log_ddl_end();

drop event trigger if exists dna_os_ddl_drop;
create event trigger dna_os_ddl_drop
  on sql_drop
  execute function public.log_ddl_drop();
