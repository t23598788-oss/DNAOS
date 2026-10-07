-- observability/joint-monitor/migrations/0001_dna_os_sensor_event.sql
--
-- หน้าที่: central, viewer-independent storage for the Sensor events this
-- capability already collects (Owner, 2026-08-26). The Sensor itself is
-- unchanged: `observability/joint-monitor/client.ts#reportJoint` remains the
-- only producer, `control/agent-gateway/gateway.ts#persistStatus` and
-- `control/command-router/router.ts#admitAndBuildResult` remain its only real
-- call sites, and no business logic in either was touched to add this.
--
-- WHY ITS OWN SCHEMA, NOT `public`: this project's `public` schema is the
-- business database (companies, customer_orders, bank_statement_transactions,
-- debt_events...). `connections/supabase/README.md` and the root README's
-- boundary rule both forbid infrastructure/observability data from coupling to
-- it. `dna_os_sensor` shares the physical project the Owner pointed at, and
-- shares nothing else: no foreign key, no trigger, no view of any business
-- table, in either direction.
--
-- WHAT IS DELIBERATELY NOT STORED: no business payload. A joint event carries
-- boundary names, a state name, a task reference and evidence pointers — the
-- gateway's own `intent_text` (the Owner's literal words) is never sent here
-- and has no column to land in.
--
-- SOURCE OF TRUTH: rows may only be written by the deterministic Sensor path.
-- No AI writes here, and no column holds AI-generated text. Patterns are SQL
-- views over these rows — countable, re-derivable, and never an interpretation.
--
-- Idempotent by construction: safe to re-run.

create schema if not exists dna_os_sensor;

comment on schema dna_os_sensor is
  'DNA OS Sensor telemetry. Written only by observability/joint-monitor. No business data, no AI-generated rows.';

-- ---------------------------------------------------------------------------
-- Raw event table
-- ---------------------------------------------------------------------------

create table if not exists dna_os_sensor.sensor_event (
  -- Identity: minted by the collector (joint-store.ts#recordJoint), never by
  -- the reporter. Primary key, so redelivering the same event is a no-op.
  event_id             uuid        primary key,

  -- EVENT_OCCURRED_ORDER — the reporter's own emission order. The ONLY thing
  -- ordering may be derived from (see ../types.ts for why: arrival order was
  -- proven wrong against a real production task).
  occurred_at          timestamptz not null,
  occurred_seq         bigint      not null check (occurred_seq >= 0),
  reporter_run_id      text        not null check (length(reporter_run_id) > 0),

  -- COLLECTOR_RECEIVED_AT — when the collector actually got it. Never used for
  -- ordering; kept because the gap between the two is the transport latency.
  received_at          timestamptz not null,
  -- When this row reached storage. A third, independent clock: it makes an
  -- ingestion backlog visible separately from a transport delay.
  ingested_at          timestamptz not null default now(),

  source_boundary      text        not null check (length(source_boundary) > 0),
  target_boundary      text        not null check (length(target_boundary) > 0),
  -- The joint identity, derived — never supplied, so it can never disagree
  -- with the two boundaries it is made of.
  joint_id             text        generated always as (source_boundary || ' -> ' || target_boundary) stored,

  event_type           text        not null check (event_type in ('JOINT_STATUS', 'BOUNDARY_VIOLATION')),

  -- state_before is nullable on purpose: today's Sensor reports only the state
  -- it transitioned INTO, so this stays null rather than being invented here.
  -- The real previous state is derived deterministically by
  -- v_state_transition below, from the events themselves.
  state_before         text,
  state_after          text,

  result               text        not null check (result in ('OK', 'FAILED', 'BLOCKED', 'PENDING', 'UNKNOWN')),
  failure_class        text,

  -- Transport latency, derived from the two clocks. Stored (not computed at
  -- read time) so latency outliers can be indexed.
  transport_latency_ms integer     generated always as (
                         (extract(epoch from (received_at - occurred_at)) * 1000)::integer
                       ) stored,

  -- Correlation, by reference only — never the business content behind it.
  task_ref             text,
  correlation_ref      text,

  -- Evidence pointers back to the raw record this row was derived from.
  evidence_source      text        not null check (length(evidence_source) > 0),
  evidence_ref         text        not null check (length(evidence_ref) > 0),

  -- The Sensor's own one-line system summary (e.g. "task <id> -> FAILED").
  -- System text produced by code, never by a model.
  summary              text
);

comment on column dna_os_sensor.sensor_event.occurred_at is 'EVENT_OCCURRED_ORDER: stamped in the reporting process before the send. Ordering source of truth.';
comment on column dna_os_sensor.sensor_event.received_at is 'COLLECTOR_RECEIVED_AT: stamped by the collector on arrival. Never used for ordering.';
comment on column dna_os_sensor.sensor_event.state_before is 'Null until a Sensor really reports one. Derived previous state lives in v_state_transition, never guessed into this column.';
comment on column dna_os_sensor.sensor_event.evidence_ref is 'Pointer back to the raw collector record (jsonl file # event_id).';

-- One reporter run cannot emit the same sequence number twice. Excludes the
-- unstamped-legacy marker, where seq is always 0 by definition.
create unique index if not exists sensor_event_reporter_seq_uidx
  on dna_os_sensor.sensor_event (reporter_run_id, occurred_seq)
  where reporter_run_id <> 'legacy-reporter-unstamped';

create index if not exists sensor_event_occurred_idx    on dna_os_sensor.sensor_event (occurred_at desc);
create index if not exists sensor_event_task_idx        on dna_os_sensor.sensor_event (task_ref, occurred_at, occurred_seq);
create index if not exists sensor_event_joint_idx       on dna_os_sensor.sensor_event (joint_id, occurred_at desc);
create index if not exists sensor_event_failure_idx     on dna_os_sensor.sensor_event (joint_id, failure_class) where result = 'FAILED';
create index if not exists sensor_event_latency_idx     on dna_os_sensor.sensor_event (joint_id, transport_latency_ms);

-- ---------------------------------------------------------------------------
-- Retention: raw Sensor events expire. Nothing accumulates forever by default.
-- ---------------------------------------------------------------------------

create table if not exists dna_os_sensor.retention_policy (
  table_name  text        primary key,
  retain_days integer     not null check (retain_days > 0),
  reason      text        not null,
  updated_at  timestamptz not null default now()
);

insert into dna_os_sensor.retention_policy (table_name, retain_days, reason)
values ('sensor_event', 30,
        'Raw per-event telemetry. 30 days covers the pattern windows this schema serves (repeat failures, repeated sequences, latency drift) without keeping a permanent record of every internal call.')
on conflict (table_name) do nothing;

-- Every deletion run leaves its own record, so "the data is gone" is always
-- distinguishable from "the data never arrived".
create table if not exists dna_os_sensor.retention_run (
  run_id       bigserial   primary key,
  table_name   text        not null,
  ran_at       timestamptz not null default now(),
  cutoff       timestamptz not null,
  deleted_rows bigint      not null
);

create or replace function dna_os_sensor.enforce_retention()
returns bigint
language plpgsql
security definer
set search_path = dna_os_sensor, pg_temp
as $$
declare
  v_retain_days integer;
  v_cutoff      timestamptz;
  v_deleted     bigint;
begin
  select retain_days into v_retain_days
  from dna_os_sensor.retention_policy
  where table_name = 'sensor_event';

  if v_retain_days is null then
    raise exception 'no retention policy row for sensor_event — refusing to delete';
  end if;

  v_cutoff := now() - make_interval(days => v_retain_days);

  delete from dna_os_sensor.sensor_event where occurred_at < v_cutoff;
  get diagnostics v_deleted = row_count;

  insert into dna_os_sensor.retention_run (table_name, cutoff, deleted_rows)
  values ('sensor_event', v_cutoff, v_deleted);

  return v_deleted;
end;
$$;

comment on function dna_os_sensor.enforce_retention() is
  'Deletes sensor_event rows older than retention_policy.retain_days and records the run. Scheduled by pg_cron; also safe to call by hand.';
