-- Real pg_cron execution status RPC (owner, 2026-08-04)
--
-- "Verify periodically that cron really executes" — cron.job/cron.job_run_
-- details already ARE pg_cron's own real execution log (no new storage
-- needed, per owner instruction "no duplicate storage"). This just exposes
-- them to system-health-check via a SECURITY DEFINER function, since the
-- cron schema isn't reachable through PostgREST directly.
--
-- "ok" is a real computed signal, not a guess: a job counts healthy only if
-- its most recent real run both succeeded AND happened within 3x its own
-- declared schedule interval (a job that hasn't run at all in a long time
-- is exactly the silent-failure shape KM-012 already found once).
create or replace function public.get_cron_job_status()
returns table (
  jobname text,
  schedule text,
  active boolean,
  last_status text,
  last_run_at timestamptz,
  ok boolean
)
language sql
security definer
set search_path = public, cron
as $$
  with last_run as (
    select distinct on (d.jobid)
      d.jobid, d.status, d.start_time
    from cron.job_run_details d
    order by d.jobid, d.start_time desc
  )
  select
    j.jobname,
    j.schedule,
    j.active,
    lr.status as last_status,
    lr.start_time as last_run_at,
    (
      j.active
      and lr.status = 'succeeded'
      -- 3x a rough interval-minutes estimate parsed from "*/N * * * *" style
      -- schedules; non-"*/N" schedules (e.g. daily "0 6 * * *") fall back to
      -- a flat 26h tolerance instead of guessing their exact interval.
      and lr.start_time > now() - (
        case
          when j.schedule ~ '^\*/(\d+) \* \* \* \*$'
            then (substring(j.schedule from '^\*/(\d+)')::int * 3 || ' minutes')::interval
          else interval '26 hours'
        end
      )
    ) as ok
  from cron.job j
  left join last_run lr on lr.jobid = j.jobid;
$$;

grant execute on function public.get_cron_job_status() to service_role;
