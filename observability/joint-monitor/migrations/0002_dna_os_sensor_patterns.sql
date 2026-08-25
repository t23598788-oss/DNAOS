-- observability/joint-monitor/migrations/0002_dna_os_sensor_patterns.sql
--
-- หน้าที่: the pattern layer over dna_os_sensor.sensor_event — plain SQL views,
-- deliberately not a service and not a model (Owner, 2026-08-26: "ยังไม่สร้าง AI
-- ในรอบนี้").
--
-- Every view here obeys two rules:
--   1. It COUNTS and GROUPS. It never interprets, scores, or explains. A row in
--      any of these views is a fact that can be recomputed by anyone with the
--      same raw events, not an opinion about them.
--   2. It carries `event_ids` back to the raw rows it was derived from, so any
--      pattern can always be traced to the exact events behind it.
--
-- Idempotent by construction: safe to re-run.

-- ---------------------------------------------------------------------------
-- Derived transitions. state_before is NOT stored on the raw row (today's
-- Sensor does not report one); it is derived here from the events themselves,
-- in EVENT_OCCURRED_ORDER, per task and per reporter run.
-- ---------------------------------------------------------------------------

create or replace view dna_os_sensor.v_state_transition as
select
  e.event_id,
  e.task_ref,
  e.joint_id,
  e.reporter_run_id,
  lag(e.state_after) over w                                                              as derived_state_before,
  e.state_after,
  e.occurred_at,
  (extract(epoch from (e.occurred_at - lag(e.occurred_at) over w)) * 1000)::integer      as state_duration_ms,
  e.transport_latency_ms,
  e.result,
  e.failure_class
from dna_os_sensor.sensor_event e
where e.task_ref is not null
window w as (partition by e.task_ref, e.reporter_run_id order by e.occurred_at, e.occurred_seq, e.event_id);

comment on view dna_os_sensor.v_state_transition is
  'Per-task transitions in EVENT_OCCURRED_ORDER. derived_state_before comes from lag() over the real events — never from a guess written into the raw table.';

-- ---------------------------------------------------------------------------
-- What the software is actually allowed to do. Seeded from the real code paths
-- in control/agent-gateway/gateway.ts (persistStatus call sites), so an
-- "unexpected transition" means the observed events disagree with the code —
-- not that a model found it surprising.
-- ---------------------------------------------------------------------------

create table if not exists dna_os_sensor.state_transition_rule (
  from_state    text not null,
  to_state      text not null,
  code_evidence text not null,
  primary key (from_state, to_state)
);

insert into dna_os_sensor.state_transition_rule (from_state, to_state, code_evidence) values
  ('RECEIVED',                'ROUTING',                 'control/agent-gateway/gateway.ts:283'),
  ('ROUTING',                 'POLICY_CHECK',            'control/agent-gateway/gateway.ts:292'),
  ('ROUTING',                 'BLOCKED',                 'control/agent-gateway/gateway.ts:287'),
  ('POLICY_CHECK',            'EXECUTING',               'control/agent-gateway/gateway.ts:316'),
  ('POLICY_CHECK',            'WAITING_OWNER_DECISION',  'control/agent-gateway/gateway.ts:312'),
  ('POLICY_CHECK',            'BLOCKED',                 'control/agent-gateway/gateway.ts:297'),
  ('WAITING_OWNER_DECISION',  'EXECUTING',               'control/agent-gateway/gateway.ts:378'),
  ('WAITING_OWNER_DECISION',  'BLOCKED',                 'control/agent-gateway/gateway.ts:374'),
  ('EXECUTING',               'VERIFYING',               'control/agent-gateway/gateway.ts:158'),
  ('EXECUTING',               'BLOCKED',                 'control/agent-gateway/gateway.ts:321'),
  ('VERIFYING',               'COMPLETED',               'control/agent-gateway/gateway.ts:167'),
  ('VERIFYING',               'FAILED',                  'control/agent-gateway/gateway.ts:162')
on conflict (from_state, to_state) do nothing;

-- ---------------------------------------------------------------------------
-- 1. Duplicate events: the same event, emitted more than once.
-- ---------------------------------------------------------------------------

create or replace view dna_os_sensor.v_pattern_duplicate_event as
select
  joint_id,
  event_type,
  state_after,
  task_ref,
  occurred_at,
  count(*)                        as occurrences,
  array_agg(event_id order by event_id) as event_ids
from dna_os_sensor.sensor_event
group by joint_id, event_type, state_after, task_ref, occurred_at
having count(*) > 1;

comment on view dna_os_sensor.v_pattern_duplicate_event is
  'Distinct event_ids describing the identical event at the identical instant. Redelivery of ONE event cannot appear here — event_id is the primary key, so a resend is a no-op.';

-- ---------------------------------------------------------------------------
-- 2. Repeated failures on the same joint.
-- ---------------------------------------------------------------------------

create or replace view dna_os_sensor.v_pattern_repeated_failure as
select
  joint_id,
  coalesce(failure_class, 'UNCLASSIFIED')          as failure_class,
  count(*)                                         as occurrences,
  count(distinct task_ref)                         as distinct_tasks,
  min(occurred_at)                                 as first_seen,
  max(occurred_at)                                 as last_seen,
  array_agg(event_id order by occurred_at, occurred_seq) as event_ids
from dna_os_sensor.sensor_event
where result = 'FAILED'
group by joint_id, coalesce(failure_class, 'UNCLASSIFIED')
having count(*) > 1;

-- ---------------------------------------------------------------------------
-- 3. Repeated sequences: the same ordered state path walked more than once.
-- ---------------------------------------------------------------------------

create or replace view dna_os_sensor.v_pattern_repeated_sequence as
with per_task as (
  select
    task_ref,
    joint_id,
    string_agg(state_after, ' -> ' order by occurred_at, occurred_seq, event_id) as state_sequence,
    array_agg(event_id order by occurred_at, occurred_seq, event_id)             as event_ids,
    min(occurred_at)                                                            as started_at,
    max(occurred_at)                                                            as ended_at
  from dna_os_sensor.sensor_event
  where task_ref is not null and event_type = 'JOINT_STATUS'
  group by task_ref, joint_id
)
select
  joint_id,
  state_sequence,
  count(*)                                              as occurrences,
  array_agg(task_ref order by started_at)                as task_refs,
  min(started_at)                                        as first_seen,
  max(ended_at)                                          as last_seen,
  (array_agg(event_ids order by started_at))             as event_ids_per_occurrence
from per_task
group by joint_id, state_sequence
having count(*) > 1;

comment on view dna_os_sensor.v_pattern_repeated_sequence is
  'Identical ordered state paths repeated across different tasks. The sequence is built in EVENT_OCCURRED_ORDER, so a scrambled arrival cannot produce a false pattern.';

-- ---------------------------------------------------------------------------
-- 4. Per-joint health: which joint is abnormal, by counting only.
-- ---------------------------------------------------------------------------

create or replace view dna_os_sensor.v_pattern_joint_health as
select
  joint_id,
  count(*)                                                     as events,
  count(*) filter (where result = 'FAILED')                    as failures,
  count(*) filter (where result = 'BLOCKED')                   as blocked,
  count(distinct task_ref)                                     as tasks,
  round(
    count(*) filter (where result = 'FAILED')::numeric
    / nullif(count(*), 0), 4)                                  as failure_rate,
  min(occurred_at)                                             as first_seen,
  max(occurred_at)                                             as last_seen,
  round(avg(transport_latency_ms)::numeric, 1)                 as avg_latency_ms,
  max(transport_latency_ms)                                    as max_latency_ms
from dna_os_sensor.sensor_event
group by joint_id;

-- ---------------------------------------------------------------------------
-- 5. Latency outliers, against each joint's own history.
-- ---------------------------------------------------------------------------

create or replace view dna_os_sensor.v_pattern_latency_outlier as
with stats as (
  select
    joint_id,
    count(*)                                as sample_size,
    avg(transport_latency_ms)               as mean_ms,
    stddev_samp(transport_latency_ms)       as stddev_ms
  from dna_os_sensor.sensor_event
  group by joint_id
)
select
  e.event_id,
  e.joint_id,
  e.task_ref,
  e.occurred_at,
  e.transport_latency_ms,
  round(s.mean_ms::numeric, 1)                          as joint_mean_ms,
  round(s.stddev_ms::numeric, 1)                        as joint_stddev_ms,
  s.sample_size,
  round(((e.transport_latency_ms - s.mean_ms) / nullif(s.stddev_ms, 0))::numeric, 2) as sigma
from dna_os_sensor.sensor_event e
join stats s using (joint_id)
where s.sample_size >= 5
  and s.stddev_ms > 0
  and e.transport_latency_ms > s.mean_ms + 3 * s.stddev_ms;

comment on view dna_os_sensor.v_pattern_latency_outlier is
  'Fixed, stated rule: beyond 3 sigma of that joint own history, minimum 5 samples. A threshold anyone can recompute — not a learned one.';

-- ---------------------------------------------------------------------------
-- 6. Transitions the code has no path for.
-- ---------------------------------------------------------------------------

create or replace view dna_os_sensor.v_pattern_unexpected_transition as
select
  t.event_id,
  t.task_ref,
  t.joint_id,
  t.derived_state_before,
  t.state_after,
  t.occurred_at,
  t.state_duration_ms
from dna_os_sensor.v_state_transition t
left join dna_os_sensor.state_transition_rule r
  on r.from_state = t.derived_state_before
 and r.to_state   = t.state_after
where t.derived_state_before is not null
  and r.from_state is null;

comment on view dna_os_sensor.v_pattern_unexpected_transition is
  'Observed transition with no matching row in state_transition_rule, i.e. no code path in control/agent-gateway/gateway.ts produces it.';
