-- Current-state baseline for the three canonical DNA OS repositories.
-- This is an internal registry, not business data and not a production claim.
-- Apply to the current Local database only; do not use db push for this baseline.

do $preflight$
begin
  if to_regnamespace('dnaos_registry') is not null then
    raise exception 'dnaos_registry already exists; inspect it before applying this baseline';
  end if;
  if exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20261122000000'
  ) then
    raise exception 'migration version 20261122000000 already exists';
  end if;
end
$preflight$;

create schema dnaos_registry;
revoke all on schema dnaos_registry from public, anon, authenticated;
grant usage on schema dnaos_registry to service_role;

create table dnaos_registry.repositories (
  repository_id text primary key,
  owner_name text not null,
  repository_name text not null,
  remote_url text not null,
  default_branch text not null check (default_branch = 'main'),
  responsibility text not null check (responsibility in (
    'CORE_APPLICATION_AND_SCHEMA_SOURCE',
    'INFRASTRUCTURE_CONTROL_PLANE',
    'PRODUCT_CONTROL_WORKSPACE'
  )),
  responsibility_basis text not null,
  recorded_at timestamptz not null default now(),
  unique (owner_name, repository_name),
  check (repository_id = 'repository://' || owner_name || '/' || repository_name)
);

create table dnaos_registry.repository_observations (
  observation_id uuid primary key default gen_random_uuid(),
  repository_id text not null references dnaos_registry.repositories(repository_id),
  ref_name text not null check (ref_name = 'refs/heads/main'),
  commit_sha char(40) not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  observed_at timestamptz not null default now(),
  observation_method text not null,
  evidence_reference text not null,
  observation_status text not null check (observation_status in ('CURRENT_MAIN_BASELINE'))
);

create table dnaos_registry.repository_bindings (
  binding_id uuid primary key default gen_random_uuid(),
  repository_id text not null references dnaos_registry.repositories(repository_id),
  observation_id uuid references dnaos_registry.repository_observations(observation_id),
  relation_kind text not null check (relation_kind in (
    'HAS_SOURCE_BOUNDARY',
    'DECLARES_ENTRYPOINT',
    'DECLARES_DATABASE_CONFIGURATION',
    'PROXIES_TO_REPOSITORY',
    'LOCAL_DATABASE_CANDIDATE'
  )),
  target_kind text not null check (target_kind in (
    'SOURCE_PATH', 'HTTP_ROUTE', 'DATABASE_CONFIGURATION', 'REPOSITORY', 'LOCAL_DATABASE'
  )),
  target_reference text not null,
  evidence_status text not null check (evidence_status in (
    'SOURCE_CONFIRMED',
    'CONFIGURED_NOT_LIVE_VERIFIED',
    'OBSERVED_LOCAL',
    'UNVERIFIED_LINK'
  )),
  evidence_references text[] not null check (cardinality(evidence_references) > 0),
  interpretation text not null,
  recorded_at timestamptz not null default now()
);

create table dnaos_registry.database_observations (
  observation_id uuid primary key default gen_random_uuid(),
  instance_reference text not null,
  database_name text not null,
  observed_at timestamptz not null default now(),
  observation_scope text not null check (observation_scope = 'LOCAL_ONLY'),
  schema_sha256 char(64) not null check (schema_sha256 ~ '^[0-9a-f]{64}$'),
  relation_count integer not null check (relation_count >= 0),
  public_table_count integer not null check (public_table_count >= 0),
  system_table_count integer not null check (system_table_count >= 0),
  applied_migration_count integer not null check (applied_migration_count >= 0),
  max_applied_migration text,
  evidence_reference text not null,
  interpretation text not null
);

alter table dnaos_registry.repositories enable row level security;
alter table dnaos_registry.repository_observations enable row level security;
alter table dnaos_registry.repository_bindings enable row level security;
alter table dnaos_registry.database_observations enable row level security;

-- No browser role can read or write this internal registry. service_role is the
-- only Data API role granted access; application users see no infrastructure data.
revoke all on all tables in schema dnaos_registry from public, anon, authenticated;
grant select, insert on all tables in schema dnaos_registry to service_role;

insert into dnaos_registry.repositories
  (repository_id, owner_name, repository_name, remote_url, default_branch, responsibility, responsibility_basis)
values
  ('repository://t23598788-oss/---------------DNA-OS', 't23598788-oss', '---------------DNA-OS',
   'https://github.com/t23598788-oss/---------------DNA-OS.git', 'main',
   'CORE_APPLICATION_AND_SCHEMA_SOURCE',
   'The repository contains the application workers and Supabase migration source. This does not assert that every Local catalog object came from this repository.'),
  ('repository://t23598788-oss/-DNA-OS-INFRASTRUCTURE-', 't23598788-oss', '-DNA-OS-INFRASTRUCTURE-',
   'https://github.com/t23598788-oss/-DNA-OS-INFRASTRUCTURE-.git', 'main',
   'INFRASTRUCTURE_CONTROL_PLANE',
   'The repository contains the Core owner-command transport and infrastructure control plane; it is not the business-data owner.'),
  ('repository://t23598788-oss/dna-os-control-workspace', 't23598788-oss', 'dna-os-control-workspace',
   'https://github.com/t23598788-oss/dna-os-control-workspace.git', 'main',
   'PRODUCT_CONTROL_WORKSPACE',
   'The repository README identifies this as a product UI/proxy that sends requests to Core and does not access the Production database directly.');

insert into dnaos_registry.repository_observations
  (repository_id, ref_name, commit_sha, observation_method, evidence_reference, observation_status)
values
  ('repository://t23598788-oss/---------------DNA-OS', 'refs/heads/main',
   'f78e09eda3391e065f66e38f7f9a185e22436a28', 'git ls-remote origin refs/heads/main',
   'GitHub remote main; repository identity verified from git remote', 'CURRENT_MAIN_BASELINE'),
  ('repository://t23598788-oss/-DNA-OS-INFRASTRUCTURE-', 'refs/heads/main',
   '9ffe56baed0eb14fceda4ebde8073daf98ca38fc', 'git ls-remote origin refs/heads/main',
   'GitHub remote main; repository identity verified from git remote', 'CURRENT_MAIN_BASELINE'),
  ('repository://t23598788-oss/dna-os-control-workspace', 'refs/heads/main',
   '167f06da64d91573e0de3106a67f442b92caaf28', 'git ls-remote origin refs/heads/main',
   'GitHub remote main; shallow clone HEAD matched remote ref', 'CURRENT_MAIN_BASELINE');

insert into dnaos_registry.repository_bindings
  (repository_id, observation_id, relation_kind, target_kind, target_reference, evidence_status, evidence_references, interpretation)
select r.repository_id, o.observation_id, b.relation_kind, b.target_kind, b.target_reference,
       b.evidence_status, b.evidence_references, b.interpretation
from (values
  ('repository://t23598788-oss/---------------DNA-OS', 'HAS_SOURCE_BOUNDARY', 'SOURCE_PATH', 'workers/auth-entry/index.ts', 'SOURCE_CONFIRMED', array['workers/auth-entry/index.ts','workers/auth-entry/cloudflare.config.ts'], 'Auth entry worker source exists in the current main checkout.'),
  ('repository://t23598788-oss/---------------DNA-OS', 'DECLARES_ENTRYPOINT', 'HTTP_ROUTE', 'dnaos.dev/login; /start; /v1/auth/*', 'CONFIGURED_NOT_LIVE_VERIFIED', array['workers/auth-entry/cloudflare.config.ts'], 'Routes are declared in source configuration; this record does not certify the deployed Worker or live route.'),
  ('repository://t23598788-oss/---------------DNA-OS', 'DECLARES_DATABASE_CONFIGURATION', 'DATABASE_CONFIGURATION', 'supabase/config.toml project_id=vibrant-hawking', 'SOURCE_CONFIRMED', array['supabase/config.toml'], 'This is the project_id in this main checkout configuration, not proof that it identifies the currently observed Local container.'),
  ('repository://t23598788-oss/---------------DNA-OS', 'LOCAL_DATABASE_CANDIDATE', 'LOCAL_DATABASE', 'Local container supabase_db_dnaos-clean-v2 / database postgres', 'UNVERIFIED_LINK', array['supabase/config.toml','Local catalog observation at this migration application'], 'The checked main config says vibrant-hawking while the observed container is named dnaos-clean-v2; no identity link is asserted.'),
  ('repository://t23598788-oss/-DNA-OS-INFRASTRUCTURE-', 'HAS_SOURCE_BOUNDARY', 'SOURCE_PATH', 'transport/owner-command-http/server.ts', 'SOURCE_CONFIRMED', array['transport/owner-command-http/server.ts','control/owner-command/'], 'Infrastructure Core owns the owner-command transport and control-plane source.'),
  ('repository://t23598788-oss/dna-os-control-workspace', 'HAS_SOURCE_BOUNDARY', 'SOURCE_PATH', 'server/server.mjs', 'SOURCE_CONFIRMED', array['README.md','server/server.mjs','server/core-endpoints.mjs'], 'The product server proxies UI requests to Core; README states it does not directly access the Production database or hold provider master credentials.'),
  ('repository://t23598788-oss/dna-os-control-workspace', 'PROXIES_TO_REPOSITORY', 'REPOSITORY', 'repository://t23598788-oss/-DNA-OS-INFRASTRUCTURE-', 'SOURCE_CONFIRMED', array['README.md','server/core-endpoints.mjs'], 'The current main source describes and configures the Product-to-Core HTTP proxy; this is a source relationship, not proof of a live runtime connection.')
) as b(repository_id, relation_kind, target_kind, target_reference, evidence_status, evidence_references, interpretation)
join dnaos_registry.repositories r on r.repository_id = b.repository_id
left join dnaos_registry.repository_observations o
  on o.repository_id = r.repository_id and o.ref_name = 'refs/heads/main'
where o.observation_id is not null;

insert into supabase_migrations.schema_migrations(version, name)
values ('20261122000000', 'current_system_registry_baseline');

