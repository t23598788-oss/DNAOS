-- Durable, append-only provenance for DNA OS development and releases.
-- Store references and hashes only; never put credentials, OTPs, user records,
-- payment amounts, or business payloads in this ledger.

begin;

do $preflight$
begin
  if to_regnamespace('system') is null then
    raise exception 'development provenance preflight failed: system schema is missing';
  end if;
end
$preflight$;

create table if not exists system.development_lineages (
  dna_id uuid primary key default gen_random_uuid(),
  record_key text not null unique
    check (record_key ~ '^[a-z0-9][a-z0-9._-]{1,79}$'),
  created_at timestamptz not null default clock_timestamp()
);

insert into system.development_lineages (record_key)
values ('dnaos-platform')
on conflict (record_key) do nothing;

create table if not exists system.development_events (
  event_id uuid primary key default gen_random_uuid(),
  lineage_id uuid not null references system.development_lineages(dna_id) on delete restrict,
  sequence_no bigint not null default 0 check (sequence_no > 0),
  event_key text not null unique
    check (length(event_key) between 8 and 200),
  event_type text not null check (event_type in (
    'work_started', 'code_committed', 'github_published', 'github_ci_completed',
    'migration_applied', 'migration_verified', 'build_verified',
    'deployment_completed', 'live_route_verified'
  )),
  status text not null check (status in ('passed', 'failed', 'blocked', 'recorded')),
  repository text not null check (length(repository) between 1 and 200),
  branch text check (branch is null or length(branch) <= 200),
  commit_sha text check (commit_sha is null or commit_sha ~ '^[0-9a-f]{40}$'),
  migration_id text check (migration_id is null or length(migration_id) between 1 and 120),
  sql_sha256 text check (sql_sha256 is null or sql_sha256 ~ '^[0-9a-f]{64}$'),
  environment text check (environment is null or environment in ('local', 'staging', 'production')),
  deployment_id text check (deployment_id is null or length(deployment_id) <= 200),
  evidence_sha256 text check (evidence_sha256 is null or evidence_sha256 ~ '^[0-9a-f]{64}$'),
  source text not null check (source in ('codex', 'github_actions', 'supabase_cli', 'operator')),
  previous_event_id uuid,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  unique (lineage_id, event_id),
  unique (lineage_id, sequence_no),
  foreign key (lineage_id, previous_event_id)
    references system.development_events(lineage_id, event_id) on delete restrict,
  check ((migration_id is null) = (sql_sha256 is null))
);

create index if not exists development_events_lineage_time_idx
  on system.development_events (lineage_id, occurred_at, event_id);
create index if not exists development_events_commit_idx
  on system.development_events (lineage_id, commit_sha, event_type)
  where commit_sha is not null;

create or replace function system.assign_development_event_sequence()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, system
as $function$
declare
  v_previous_id uuid;
  v_previous_sequence bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.lineage_id::text, 0));
  select event_id, sequence_no
    into v_previous_id, v_previous_sequence
  from system.development_events
  where lineage_id = new.lineage_id
  order by sequence_no desc
  limit 1;
  new.sequence_no := coalesce(v_previous_sequence, 0) + 1;
  new.previous_event_id := v_previous_id;
  return new;
end;
$function$;

revoke all on function system.assign_development_event_sequence() from public, anon, authenticated;
drop trigger if exists development_events_assign_sequence
  on system.development_events;
create trigger development_events_assign_sequence
  before insert on system.development_events
  for each row execute function system.assign_development_event_sequence();

create or replace function system.reject_development_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception 'development provenance is append-only';
end;
$function$;

revoke all on function system.reject_development_event_mutation() from public, anon, authenticated;

drop trigger if exists development_lineages_no_update_delete
  on system.development_lineages;
create trigger development_lineages_no_update_delete
  before update or delete on system.development_lineages
  for each row execute function system.reject_development_event_mutation();
drop trigger if exists development_lineages_no_truncate
  on system.development_lineages;
create trigger development_lineages_no_truncate
  before truncate on system.development_lineages
  for each statement execute function system.reject_development_event_mutation();

drop trigger if exists development_events_no_update_delete
  on system.development_events;
create trigger development_events_no_update_delete
  before update or delete on system.development_events
  for each row execute function system.reject_development_event_mutation();

drop trigger if exists development_events_no_truncate
  on system.development_events;
create trigger development_events_no_truncate
  before truncate on system.development_events
  for each statement execute function system.reject_development_event_mutation();

alter table system.development_lineages enable row level security;
alter table system.development_events enable row level security;
revoke all on system.development_lineages, system.development_events from public, anon, authenticated;
grant select on system.development_lineages, system.development_events to service_role;
grant insert on system.development_events to service_role;

comment on table system.development_lineages is
  'Stable DNA IDs for code/system lineages; contains no business or account data.';
comment on table system.development_events is
  'Append-only development provenance: commit, migration/hash, check, build and deployment references only.';

-- AI clients can read the bounded technical history through this projection,
-- but receive no direct table access or write capability. The projection never
-- returns event idempotency keys, actor data, credentials, or business payloads.
create or replace function public.read_development_history(
  p_record_key text default 'dnaos-platform',
  p_limit integer default 50
)
returns table (
  event_id uuid,
  sequence_no bigint,
  event_type text,
  status text,
  repository text,
  branch text,
  commit_sha text,
  migration_id text,
  sql_sha256 text,
  environment text,
  deployment_id text,
  evidence_sha256 text,
  source text,
  previous_event_id uuid,
  occurred_at timestamptz,
  recorded_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, system
as $function$
begin
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'p_limit must be between 1 and 200';
  end if;
  if p_record_key is null or length(p_record_key) > 80 then
    raise exception 'invalid development record key';
  end if;

  return query
  select e.event_id, e.sequence_no, e.event_type, e.status, e.repository,
         e.branch, e.commit_sha, e.migration_id, e.sql_sha256, e.environment,
         e.deployment_id, e.evidence_sha256, e.source, e.previous_event_id,
         e.occurred_at, e.recorded_at
  from system.development_events e
  join system.development_lineages l on l.dna_id = e.lineage_id
  where l.record_key = p_record_key
  order by e.sequence_no desc
  limit p_limit;
end;
$function$;

revoke all on function public.read_development_history(text, integer) from public;
grant execute on function public.read_development_history(text, integer) to anon, authenticated, service_role;

create or replace function system.development_release_readiness(
  p_lineage_id uuid,
  p_commit_sha text
)
returns table (ready boolean, missing_evidence text[])
language sql
stable
security invoker
set search_path = pg_catalog, system
as $function$
  with matching as (
    select event_type, status, environment, migration_id, sql_sha256
    from system.development_events
    where lineage_id = p_lineage_id
      and commit_sha = lower(p_commit_sha)
  ), required as (
    select unnest(array[
      'github_published', 'build_verified', 'deployment_completed', 'live_route_verified'
    ]) as event_type
  ), missing_required as (
    select r.event_type
    from required r
    where not exists (
      select 1 from matching m
      where m.event_type = r.event_type
        and m.status = 'passed'
        and (r.event_type <> 'deployment_completed' or m.environment = 'production')
        and (r.event_type <> 'live_route_verified' or m.environment = 'production')
    )
  ), applied_migrations as (
    select distinct migration_id, sql_sha256
    from matching
    where event_type = 'migration_applied' and status = 'passed'
  ), missing_migrations as (
    select a.migration_id
    from applied_migrations a
    where not exists (
      select 1 from matching m
      where m.event_type = 'migration_verified'
        and m.status = 'passed'
        and m.migration_id = a.migration_id
        and m.sql_sha256 = a.sql_sha256
    )
  ), all_missing as (
    select event_type as evidence from missing_required
    union all
    select 'migration_verified:' || migration_id from missing_migrations
  )
  select not exists (select 1 from all_missing),
         coalesce(array_agg(evidence order by evidence), array[]::text[])
  from all_missing;
$function$;

revoke all on function system.development_release_readiness(uuid, text) from public, anon, authenticated;
grant execute on function system.development_release_readiness(uuid, text) to service_role;

commit;
