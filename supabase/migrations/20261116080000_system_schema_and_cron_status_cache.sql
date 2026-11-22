-- Keep the existing single Supabase project, but separate system metadata
-- from business data by schema. The system schema is intentionally not
-- granted to browser-facing roles.
begin;

create schema if not exists system;
alter schema system owner to postgres;
revoke all on schema system from public, anon, authenticated;
grant usage on schema system to service_role;
-- Expose the schema through PostgREST so server-side service_role clients can
-- select it explicitly. Object grants/RLS still deny browser roles access.
alter role authenticator set pgrst.db_schemas = 'public, graphql_public, system';
notify pgrst, 'reload config';

do $move_system_tables$
declare
  table_name text;
begin
  foreach table_name in array array[
    'system_adapters',
    'event_stream',
    'location_zones',
    'inferred_inventory_states',
    'routing_policies',
    'usage_meter_logs'
  ] loop
    if to_regclass(format('system.%I', table_name)) is null
       and to_regclass(format('public.%I', table_name)) is not null then
      execute format('alter table public.%I set schema system', table_name);
    end if;
  end loop;
end
$move_system_tables$;

grant select, insert, update on system.system_adapters to service_role;
grant select, insert on system.event_stream to service_role;
grant select, insert, update on system.location_zones to service_role;
grant select, insert on system.inferred_inventory_states to service_role;
grant select, insert, update on system.routing_policies to service_role;
grant select, insert on system.usage_meter_logs to service_role;

-- Keep only the latest run per job from the last 26 hours. A daily job with
-- no recent run is intentionally stale and is reported as unhealthy. This
-- performs the history scan at most once every ten minutes instead of for
-- every status RPC call.
create materialized view if not exists system.cron_job_status_snapshot as
select distinct on (d.jobid)
  d.jobid,
  d.status as last_status,
  d.start_time as last_run_at
from cron.job_run_details as d
where d.start_time >= now() - interval '26 hours'
order by d.jobid, d.start_time desc;

create unique index if not exists cron_job_status_snapshot_jobid_uidx
  on system.cron_job_status_snapshot (jobid);

revoke all on system.cron_job_status_snapshot from public, anon, authenticated;
grant select on system.cron_job_status_snapshot to service_role;

create or replace function public.get_cron_job_status()
returns table(
  jobname text,
  schedule text,
  active boolean,
  last_status text,
  last_run_at timestamptz,
  ok boolean
)
language sql
security definer
set search_path = pg_catalog, public, system, cron
as $function$
  select
    j.jobname::text,
    j.schedule::text,
    j.active,
    snapshot.last_status::text,
    snapshot.last_run_at,
    coalesce((
      j.active
      and snapshot.last_status = 'succeeded'
      and snapshot.last_run_at > now() - (
        case
          when j.schedule ~ '^\*/(\d+) \* \* \* \*$'
            then (substring(j.schedule from '^\*/(\d+)')::int * 3 || ' minutes')::interval
          else interval '26 hours'
        end
      )
    ), false) as ok
  from cron.job as j
  left join system.cron_job_status_snapshot as snapshot
    on snapshot.jobid = j.jobid
  -- This maintenance job refreshes the snapshot it would need to monitor;
  -- excluding it avoids a self-referential first-run failure state.
  where j.jobname <> 'refresh-cron-job-status-snapshot';
$function$;

revoke all on function public.get_cron_job_status() from public, anon, authenticated;
grant execute on function public.get_cron_job_status() to service_role;

do $schedule_snapshot_refresh$
begin
  if not exists (
    select 1 from cron.job where jobname = 'refresh-cron-job-status-snapshot'
  ) then
    perform cron.schedule(
      'refresh-cron-job-status-snapshot',
      '*/10 * * * *',
      'refresh materialized view concurrently system.cron_job_status_snapshot'
    );
  end if;
end
$schedule_snapshot_refresh$;

commit;
