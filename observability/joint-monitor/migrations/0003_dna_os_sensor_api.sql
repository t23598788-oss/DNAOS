-- observability/joint-monitor/migrations/0003_dna_os_sensor_api.sql
--
-- หน้าที่: the only doors into dna_os_sensor, plus the scheduled retention job.
--
-- WHY RPC AND NOT A TABLE ENDPOINT: PostgREST on this project exposes
-- `public, graphql_public` only. Exposing `dna_os_sensor` would mean changing
-- a project-wide API setting for one capability's needs. Two SECURITY DEFINER
-- functions in `public` (both namespaced `dna_os_sensor_*`) reach the schema
-- without changing that setting and without widening anything else.
--
-- WHY NOT THE service_role KEY: service_role bypasses RLS on EVERY table in
-- this project, including the business ones (companies, customer_orders,
-- bank_statement_transactions). Handing that to an observability container to
-- write telemetry would be the widest possible credential for the narrowest
-- possible job. Instead: two purpose-built roles, each granted execute on
-- exactly the functions it needs and nothing else.
--
-- Idempotent by construction: safe to re-run.

-- ---------------------------------------------------------------------------
-- Least-privilege roles
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'dna_os_sensor_writer') then
    create role dna_os_sensor_writer nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'dna_os_sensor_reader') then
    create role dna_os_sensor_reader nologin;
  end if;
end
$$;

-- PostgREST switches into these roles from the JWT's `role` claim.
grant dna_os_sensor_writer to authenticator;
grant dna_os_sensor_reader to authenticator;

-- Neither role gets table privileges: everything goes through the functions
-- below, so the write path cannot UPDATE or DELETE and the read path cannot
-- write, regardless of what SQL a caller tries to send.
revoke all on schema dna_os_sensor from dna_os_sensor_writer, dna_os_sensor_reader;
revoke all on all tables in schema dna_os_sensor from dna_os_sensor_writer, dna_os_sensor_reader;

-- ---------------------------------------------------------------------------
-- Write path: append-only ingest, idempotent on event_id
-- ---------------------------------------------------------------------------

create or replace function public.dna_os_sensor_ingest(events jsonb)
returns jsonb
language plpgsql
security definer
set search_path = dna_os_sensor, public, pg_temp
as $$
declare
  v_received bigint;
  v_inserted bigint;
begin
  if jsonb_typeof(events) <> 'array' then
    raise exception 'events must be a JSON array, got %', jsonb_typeof(events);
  end if;

  select count(*) into v_received from jsonb_array_elements(events);

  -- ON CONFLICT DO NOTHING is the whole idempotency story: the Sensor is
  -- fire-and-forget and may retry, and a retried event carries the same
  -- collector-minted event_id, so a resend can never become a second row.
  with incoming as (
    select
      (e->>'event_id')::uuid           as event_id,
      (e->>'occurred_at')::timestamptz as occurred_at,
      (e->>'occurred_seq')::bigint     as occurred_seq,
       e->>'reporter_run_id'           as reporter_run_id,
      (e->>'received_at')::timestamptz as received_at,
       e->>'source_boundary'           as source_boundary,
       e->>'target_boundary'           as target_boundary,
       e->>'event_type'                as event_type,
       e->>'state_before'              as state_before,
       e->>'state_after'               as state_after,
       e->>'result'                    as result,
       e->>'failure_class'             as failure_class,
       e->>'task_ref'                  as task_ref,
       e->>'correlation_ref'           as correlation_ref,
       e->>'evidence_source'           as evidence_source,
       e->>'evidence_ref'              as evidence_ref,
       e->>'summary'                   as summary
    from jsonb_array_elements(events) as e
  ), inserted as (
    insert into dna_os_sensor.sensor_event (
      event_id, occurred_at, occurred_seq, reporter_run_id, received_at,
      source_boundary, target_boundary, event_type, state_before, state_after,
      result, failure_class, task_ref, correlation_ref,
      evidence_source, evidence_ref, summary
    )
    select
      event_id, occurred_at, occurred_seq, reporter_run_id, received_at,
      source_boundary, target_boundary, event_type, state_before, state_after,
      result, failure_class, task_ref, correlation_ref,
      evidence_source, evidence_ref, summary
    from incoming
    on conflict (event_id) do nothing
    returning 1
  )
  select count(*) into v_inserted from inserted;

  return jsonb_build_object('received', v_received, 'inserted', v_inserted, 'duplicates_ignored', v_received - v_inserted);
end;
$$;

comment on function public.dna_os_sensor_ingest(jsonb) is
  'Append-only Sensor ingest. Idempotent on event_id. The only write path into dna_os_sensor.';

-- REVOKE FROM PUBLIC IS NOT ENOUGH ON SUPABASE (found live, 2026-08-26: the
-- anon key could call this function after only the PUBLIC revoke). Supabase
-- ships `alter default privileges in schema public grant all on functions to
-- anon, authenticated, service_role`, so every new function in `public` starts
-- with those three roles explicitly granted. They must be revoked by name.
revoke all on function public.dna_os_sensor_ingest(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.dna_os_sensor_ingest(jsonb) to dna_os_sensor_writer;

-- ---------------------------------------------------------------------------
-- Read path: read-only, and the shape the next round's AI Sandbox consumes
-- ---------------------------------------------------------------------------

create or replace function public.dna_os_sensor_events(p_task_ref text default null, p_limit integer default 200)
returns setof dna_os_sensor.sensor_event
language sql
stable
security definer
set search_path = dna_os_sensor, public, pg_temp
as $$
  select *
  from dna_os_sensor.sensor_event
  where p_task_ref is null or task_ref = p_task_ref
  order by occurred_at, occurred_seq, event_id
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
$$;

comment on function public.dna_os_sensor_events(text, integer) is
  'Raw events in EVENT_OCCURRED_ORDER. Read-only. Ordering never uses received_at.';

create or replace function public.dna_os_sensor_pattern(p_name text)
returns jsonb
language plpgsql
stable
security definer
set search_path = dna_os_sensor, public, pg_temp
as $$
declare
  v_result jsonb;
begin
  -- A fixed allow-list, not dynamic SQL over a caller-supplied name: the read
  -- surface stays exactly these six views no matter what a caller sends.
  case p_name
    when 'duplicate_event'       then select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) into v_result from dna_os_sensor.v_pattern_duplicate_event v;
    when 'repeated_failure'      then select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) into v_result from dna_os_sensor.v_pattern_repeated_failure v;
    when 'repeated_sequence'     then select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) into v_result from dna_os_sensor.v_pattern_repeated_sequence v;
    when 'joint_health'          then select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) into v_result from dna_os_sensor.v_pattern_joint_health v;
    when 'latency_outlier'       then select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) into v_result from dna_os_sensor.v_pattern_latency_outlier v;
    when 'unexpected_transition' then select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) into v_result from dna_os_sensor.v_pattern_unexpected_transition v;
    when 'state_transition'      then select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) into v_result from dna_os_sensor.v_state_transition v;
    else raise exception 'unknown pattern %, expected one of: duplicate_event, repeated_failure, repeated_sequence, joint_health, latency_outlier, unexpected_transition, state_transition', p_name;
  end case;
  return v_result;
end;
$$;

comment on function public.dna_os_sensor_pattern(text) is
  'Deterministic pattern output for the read-only AI Sandbox input. Counts and groupings only — every row carries event_ids back to the raw events.';

revoke all on function public.dna_os_sensor_events(text, integer) from public, anon, authenticated, service_role;
revoke all on function public.dna_os_sensor_pattern(text)         from public, anon, authenticated, service_role;
grant execute on function public.dna_os_sensor_events(text, integer) to dna_os_sensor_reader;
grant execute on function public.dna_os_sensor_pattern(text)         to dna_os_sensor_reader;

-- ---------------------------------------------------------------------------
-- Scheduled retention (pg_cron 1.6.4, already installed on this project)
-- ---------------------------------------------------------------------------

do $$
begin
  perform cron.unschedule('dna-os-sensor-retention')
  where exists (select 1 from cron.job where jobname = 'dna-os-sensor-retention');

  perform cron.schedule('dna-os-sensor-retention', '30 3 * * *', 'select dna_os_sensor.enforce_retention()');
end
$$;
