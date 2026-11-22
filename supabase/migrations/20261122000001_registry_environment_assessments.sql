-- Append-only environment and source/live status assessments for the internal
-- repository registry. Values identifying specific environments are stored as
-- private database records, not embedded in this migration source.

do $preflight$
begin
  if to_regnamespace('dnaos_registry') is null then
    raise exception 'dnaos_registry is missing; apply the current system registry baseline first';
  end if;
  if exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20261122000001'
  ) then
    raise exception 'migration version 20261122000001 already exists';
  end if;
end
$preflight$;

create table dnaos_registry.binding_assessments (
  assessment_id uuid primary key default gen_random_uuid(),
  binding_id uuid not null references dnaos_registry.repository_bindings(binding_id),
  status text not null check (status in (
    'DECLARED_IN_SOURCE', 'VERIFIED_ONLINE', 'UNVERIFIED_LINK'
  )),
  environment_class text not null check (environment_class in (
    'LOCAL', 'STAGING', 'PRODUCTION', 'UNCLASSIFIED'
  )),
  evidence_reference text not null,
  assessed_at timestamptz not null default now(),
  interpretation text not null
);

create table dnaos_registry.environment_assessments (
  assessment_id uuid primary key default gen_random_uuid(),
  subject_kind text not null check (subject_kind in (
    'SUPABASE_CONFIG_PROJECT', 'DATABASE_INSTANCE'
  )),
  subject_reference text not null,
  environment_class text not null check (environment_class in (
    'LOCAL', 'STAGING', 'PRODUCTION', 'UNCLASSIFIED'
  )),
  evidence_status text not null check (evidence_status in (
    'DECLARED_IN_SOURCE', 'OBSERVED_LOCAL', 'VERIFIED_ONLINE', 'UNVERIFIED'
  )),
  evidence_reference text not null,
  assessed_at timestamptz not null default now(),
  interpretation text not null
);

alter table dnaos_registry.binding_assessments enable row level security;
alter table dnaos_registry.environment_assessments enable row level security;
revoke all on dnaos_registry.binding_assessments, dnaos_registry.environment_assessments
  from public, anon, authenticated;
grant select, insert on dnaos_registry.binding_assessments,
  dnaos_registry.environment_assessments to service_role;

insert into supabase_migrations.schema_migrations(version, name)
values ('20261122000001', 'registry_environment_assessments');

