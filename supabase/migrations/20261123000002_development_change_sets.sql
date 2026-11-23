-- Group related implementation files and release evidence into immutable DNA bundles.
-- GitHub Actions is evidence when available, not the sole source of a release record.
-- No credentials, customer/account records, or business payloads belong here.

begin;

do $preflight$
begin
  if to_regclass('public.companies') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.organizations') is null
     or to_regclass('public.org_members') is null then
    raise exception 'development change-set preflight failed: company, profile, organization, and membership relations must exist';
  end if;
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.companies'::regclass
      and attname = 'organization_id' and not attisdropped
  ) then
    raise exception 'development change-set preflight failed: companies.organization_id is required to verify company-to-organization authority';
  end if;
end
$preflight$;

alter table system.development_events
  drop constraint if exists development_events_event_type_check;
alter table system.development_events
  add constraint development_events_event_type_check check (event_type in (
    'work_started', 'code_committed', 'github_published', 'github_main_merged',
    'github_ci_completed', 'manual_checks_completed', 'migration_applied',
    'migration_verified', 'build_verified', 'deployment_completed',
    'live_route_verified'
  ));

alter table system.development_events
  drop constraint if exists development_events_environment_check;
alter table system.development_events
  add constraint development_events_environment_check
  check (environment is null or environment in ('local', 'development', 'staging', 'production'));

alter table system.development_events
  drop constraint if exists development_events_main_merge_branch_check;
alter table system.development_events
  add constraint development_events_main_merge_branch_check
  check (event_type <> 'github_main_merged' or branch = 'main');

create table if not exists system.development_change_sets (
  change_set_id uuid primary key default gen_random_uuid(),
  lineage_id uuid not null references system.development_lineages(dna_id) on delete restrict,
  change_set_key text not null unique
    check (change_set_key ~ '^[a-z0-9][a-z0-9._-]{2,119}$'),
  category text not null check (category in (
    'database_schema', 'business_formula', 'business_policy', 'application_api',
    'integration', 'infrastructure', 'authentication_email', 'documentation'
  )),
  title text not null check (length(title) between 1 and 200),
  summary text not null check (length(summary) between 1 and 2000),
  repository text not null check (length(repository) between 1 and 200),
  operation text not null check (operation in (
    'source_publish', 'main_merge', 'database_migration', 'worker_deploy',
    'auth_template_update', 'production_release'
  )),
  target_kind text not null check (target_kind in (
    'github_repository', 'supabase_project', 'cloudflare_worker', 'production_company', 'other'
  )),
  target_environment text check (target_environment is null or target_environment in (
    'local', 'development', 'staging', 'production'
  )),
  environment_id text check (environment_id is null or length(environment_id) <= 200),
  target_ref text check (target_ref is null or length(target_ref) <= 200),
  target_company_id uuid references public.companies(id) on delete restrict,
  target_organization_id uuid references public.organizations(id) on delete restrict,
  policy_ref text check (policy_ref is null or length(policy_ref) <= 200),
  policy_version text check (policy_version is null or length(policy_version) <= 120),
  policy_sha256 text check (policy_sha256 is null or policy_sha256 ~ '^[0-9a-f]{64}$'),
  credential_class text check (credential_class is null or credential_class in (
    'read_only', 'development_scoped_write', 'staging_scoped_write', 'production_release_scoped'
  )),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  source_started_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  check (
    target_environment not in ('staging', 'production') or environment_id is not null
  ),
  check (
    target_environment <> 'production'
    or (target_ref is not null and target_company_id is not null and target_organization_id is not null
        and policy_ref is not null and policy_version is not null and policy_sha256 is not null
        and operation is not null
        and credential_class = 'production_release_scoped')
  )
);

create table if not exists system.development_change_files (
  change_set_id uuid not null references system.development_change_sets(change_set_id) on delete restrict,
  repository_path text not null check (
    length(repository_path) between 1 and 500
    and repository_path not like '/%'
    and repository_path !~ '(^|/)\.\.(/|$)'
  ),
  previous_path text check (previous_path is null or length(previous_path) <= 500),
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  change_kind text not null check (change_kind in ('added', 'modified', 'deleted', 'renamed')),
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (change_set_id, repository_path, commit_sha),
  check ((change_kind = 'renamed') = (previous_path is not null)),
  check ((change_kind = 'deleted') = (content_sha256 is null))
);

create table if not exists system.development_event_change_sets (
  event_id uuid not null references system.development_events(event_id) on delete restrict,
  change_set_id uuid not null references system.development_change_sets(change_set_id) on delete restrict,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (event_id, change_set_id)
);

create table if not exists system.development_change_set_approvals (
  approval_id uuid primary key default gen_random_uuid(),
  change_set_id uuid not null unique
    references system.development_change_sets(change_set_id) on delete restrict,
  target_company_id uuid not null references public.companies(id) on delete restrict,
  target_organization_id uuid not null references public.organizations(id) on delete restrict,
  approver_profile_id uuid not null references public.profiles(id) on delete restrict,
  operation text not null,
  policy_sha256 text not null check (policy_sha256 ~ '^[0-9a-f]{64}$'),
  approved_at timestamptz not null default clock_timestamp(),
  recorded_at timestamptz not null default clock_timestamp()
);

create index if not exists development_change_sets_lineage_time_idx
  on system.development_change_sets (lineage_id, source_started_at desc);
create index if not exists development_change_files_commit_idx
  on system.development_change_files (commit_sha, change_set_id);
create index if not exists development_event_change_sets_bundle_idx
  on system.development_event_change_sets (change_set_id, event_id);

alter table system.development_change_sets enable row level security;
alter table system.development_change_files enable row level security;
alter table system.development_event_change_sets enable row level security;
alter table system.development_change_set_approvals enable row level security;
revoke all on system.development_change_sets, system.development_change_files,
  system.development_event_change_sets, system.development_change_set_approvals
  from public, anon, authenticated;
grant select on system.development_change_sets, system.development_change_files,
  system.development_event_change_sets, system.development_change_set_approvals to service_role;

drop trigger if exists development_change_sets_no_update_delete on system.development_change_sets;
create trigger development_change_sets_no_update_delete
  before update or delete on system.development_change_sets
  for each row execute function system.reject_development_event_mutation();
drop trigger if exists development_change_sets_no_truncate on system.development_change_sets;
create trigger development_change_sets_no_truncate
  before truncate on system.development_change_sets
  for each statement execute function system.reject_development_event_mutation();
drop trigger if exists development_change_files_no_update_delete on system.development_change_files;
create trigger development_change_files_no_update_delete
  before update or delete on system.development_change_files
  for each row execute function system.reject_development_event_mutation();
drop trigger if exists development_change_files_no_truncate on system.development_change_files;
create trigger development_change_files_no_truncate
  before truncate on system.development_change_files
  for each statement execute function system.reject_development_event_mutation();
drop trigger if exists development_event_change_sets_no_update_delete on system.development_event_change_sets;
create trigger development_event_change_sets_no_update_delete
  before update or delete on system.development_event_change_sets
  for each row execute function system.reject_development_event_mutation();
drop trigger if exists development_event_change_sets_no_truncate on system.development_event_change_sets;
create trigger development_event_change_sets_no_truncate
  before truncate on system.development_event_change_sets
  for each statement execute function system.reject_development_event_mutation();
drop trigger if exists development_change_set_approvals_no_update_delete on system.development_change_set_approvals;
create trigger development_change_set_approvals_no_update_delete
  before update or delete on system.development_change_set_approvals
  for each row execute function system.reject_development_event_mutation();
drop trigger if exists development_change_set_approvals_no_truncate on system.development_change_set_approvals;
create trigger development_change_set_approvals_no_truncate
  before truncate on system.development_change_set_approvals
  for each statement execute function system.reject_development_event_mutation();

comment on table system.development_change_sets is
  'Immutable capability-sized DNA work bundles with category, target authority references, and policy hash.';
comment on table system.development_change_files is
  'Repository-relative files and per-commit content hashes attached to a DNA work bundle.';
comment on table system.development_event_change_sets is
  'Links append-only GitHub, verification, migration, build, and deployment events to one DNA work bundle.';
comment on table system.development_change_set_approvals is
  'Immutable Production approval captured from the authenticated owner of the target organization; no platform super-admin bypass.';

create or replace function public.register_development_change_set(
  p_record_key text,
  p_change_set_key text,
  p_category text,
  p_title text,
  p_summary text,
  p_repository text,
  p_operation text,
  p_target_kind text,
  p_target_environment text,
  p_environment_id text,
  p_target_ref text,
  p_target_company_id uuid,
  p_target_organization_id uuid,
  p_policy_ref text,
  p_policy_version text,
  p_policy_sha256 text,
  p_credential_class text,
  p_manifest_sha256 text,
  p_source_started_at timestamptz,
  p_files jsonb
)
returns table (change_set_id uuid, created boolean)
language plpgsql
security definer
set search_path = pg_catalog, system
as $function$
declare
  v_lineage_id uuid;
  v_change_set_id uuid;
  v_existing system.development_change_sets%rowtype;
  v_created boolean := false;
  v_file jsonb;
  v_file_count integer;
  v_existing_file_count integer;
begin
  if p_record_key is null or length(p_record_key) > 80
     or p_change_set_key is null or length(p_change_set_key) > 120 then
    raise exception 'invalid development change-set key';
  end if;
  if p_files is null or jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) < 1
     or jsonb_array_length(p_files) > 1000 then
    raise exception 'file manifest must contain between 1 and 1000 entries';
  end if;

  select dna_id into v_lineage_id from system.development_lineages where record_key = p_record_key;
  if v_lineage_id is null then raise exception 'development lineage is not present'; end if;

  for v_file in select value from jsonb_array_elements(p_files) loop
    if coalesce(v_file->>'path', '') = '' or length(v_file->>'path') > 500
       or (v_file->>'path') like '/%'
       or (v_file->>'path') ~ '(^|/)\.\.(/|$)'
       or ((v_file->>'change_kind' = 'renamed') <> (v_file->>'previous_path' is not null))
       or (v_file->>'previous_path' like '/%')
       or (v_file->>'previous_path' ~ '(^|/)\.\.(/|$)')
       or coalesce(v_file->>'commit_sha', '') !~ '^[0-9a-f]{40}$'
       or coalesce(v_file->>'change_kind', '') not in ('added', 'modified', 'deleted', 'renamed')
       or ((v_file->>'change_kind' = 'deleted') <> (v_file->>'content_sha256' is null))
       or (v_file->>'content_sha256' is not null and v_file->>'content_sha256' !~ '^[0-9a-f]{64}$') then
      raise exception 'invalid file manifest entry';
    end if;
  end loop;

  if exists (
    select 1 from jsonb_array_elements(p_files) as files(file)
    group by file->>'path', file->>'commit_sha' having count(*) > 1
  ) then raise exception 'file manifest contains duplicate path/commit entries'; end if;

  insert into system.development_change_sets (
    lineage_id, change_set_key, category, title, summary, repository, operation,
    target_kind, target_environment, environment_id, target_ref, target_company_id, target_organization_id,
    policy_ref, policy_version, policy_sha256, credential_class,
    manifest_sha256, source_started_at
  ) values (
    v_lineage_id, p_change_set_key, p_category, p_title, p_summary, p_repository, p_operation,
    p_target_kind, p_target_environment, p_environment_id, p_target_ref, p_target_company_id, p_target_organization_id,
    p_policy_ref, p_policy_version, p_policy_sha256, p_credential_class,
    p_manifest_sha256, p_source_started_at
  ) on conflict (change_set_key) do nothing
  returning system.development_change_sets.change_set_id into v_change_set_id;

  if v_change_set_id is not null then
    v_created := true;
  else
    select * into v_existing from system.development_change_sets s
    where s.change_set_key = p_change_set_key;
    if not found then raise exception 'change-set key conflict could not be verified'; end if;
    if v_existing.lineage_id is distinct from v_lineage_id
       or v_existing.category is distinct from p_category
       or v_existing.title is distinct from p_title
       or v_existing.summary is distinct from p_summary
       or v_existing.repository is distinct from p_repository
       or v_existing.operation is distinct from p_operation
       or v_existing.target_kind is distinct from p_target_kind
       or v_existing.target_environment is distinct from p_target_environment
       or v_existing.environment_id is distinct from p_environment_id
       or v_existing.target_ref is distinct from p_target_ref
       or v_existing.target_company_id is distinct from p_target_company_id
       or v_existing.target_organization_id is distinct from p_target_organization_id
       or v_existing.policy_ref is distinct from p_policy_ref
       or v_existing.policy_version is distinct from p_policy_version
       or v_existing.policy_sha256 is distinct from p_policy_sha256
       or v_existing.credential_class is distinct from p_credential_class
       or v_existing.manifest_sha256 is distinct from p_manifest_sha256
       or v_existing.source_started_at is distinct from p_source_started_at then
      raise exception 'change-set key was already used for different evidence';
    end if;
    v_change_set_id := v_existing.change_set_id;
  end if;

  for v_file in select value from jsonb_array_elements(p_files) loop
    insert into system.development_change_files (
      change_set_id, repository_path, previous_path, commit_sha, change_kind, content_sha256
    ) values (
      v_change_set_id, v_file->>'path', v_file->>'previous_path', v_file->>'commit_sha',
      v_file->>'change_kind', v_file->>'content_sha256'
    ) on conflict on constraint development_change_files_pkey do nothing;
  end loop;

  select count(*) into v_file_count from jsonb_array_elements(p_files);
  select count(*) into v_existing_file_count from system.development_change_files f
  where f.change_set_id = v_change_set_id;
  if v_file_count <> v_existing_file_count then
    raise exception 'stored file manifest does not match the supplied evidence';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_files) j
    left join system.development_change_files f
      on f.change_set_id = v_change_set_id
     and f.repository_path = j->>'path'
     and f.commit_sha = j->>'commit_sha'
    where f.change_set_id is null
       or f.change_kind is distinct from j->>'change_kind'
       or f.previous_path is distinct from j->>'previous_path'
       or f.content_sha256 is distinct from j->>'content_sha256'
  ) then raise exception 'stored file manifest conflicts with supplied evidence'; end if;

  return query select v_change_set_id, v_created;
end;
$function$;

revoke all on function public.register_development_change_set(
  text, text, text, text, text, text, text, text, text, text, text,
  uuid, uuid, text, text, text, text, text, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function public.register_development_change_set(
  text, text, text, text, text, text, text, text, text, text, text,
  uuid, uuid, text, text, text, text, text, timestamptz, jsonb
) to service_role;

-- The target organization's authenticated owner reviews the exact company,
-- destination, operation, policy version/hash, and source files before approval.
create or replace function public.read_development_change_set_for_approval(
  p_change_set_key text
)
returns table (
  change_set_key text,
  category text,
  title text,
  summary text,
  operation text,
  target_kind text,
  target_environment text,
  environment_id text,
  target_ref text,
  target_company_id uuid,
  target_organization_id uuid,
  policy_ref text,
  policy_version text,
  policy_sha256 text,
  files jsonb
)
language plpgsql
stable
security definer
set search_path = pg_catalog, system
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_bundle system.development_change_sets%rowtype;
begin
  if v_actor_id is null or coalesce(auth.role(), '') <> 'authenticated' then
    raise exception using errcode = '42501', message = 'DEVELOPMENT_APPROVAL_AUTH_REQUIRED';
  end if;
  select * into v_bundle from system.development_change_sets s
  where s.change_set_key = p_change_set_key;
  if not found or v_bundle.target_environment <> 'production'
     or not exists (
       select 1 from public.org_members m
       where m.organization_id = v_bundle.target_organization_id
         and m.user_id = v_actor_id and m.role = 'owner'
     ) or not exists (
       select 1 from public.companies c
       where c.id = v_bundle.target_company_id
         and c.organization_id = v_bundle.target_organization_id
     ) then
    raise exception using errcode = '42501', message = 'DEVELOPMENT_APPROVAL_SCOPE_DENIED';
  end if;
  return query
  select s.change_set_key, s.category, s.title, s.summary, s.operation,
         s.target_kind, s.target_environment, s.environment_id, s.target_ref,
         s.target_company_id, s.target_organization_id, s.policy_ref,
         s.policy_version, s.policy_sha256,
         coalesce((select jsonb_agg(jsonb_build_object(
           'path', f.repository_path, 'previous_path', f.previous_path,
           'commit_sha', f.commit_sha, 'change_kind', f.change_kind,
           'content_sha256', f.content_sha256
         ) order by f.commit_sha, f.repository_path)
         from system.development_change_files f where f.change_set_id = s.change_set_id), '[]'::jsonb)
  from system.development_change_sets s where s.change_set_id = v_bundle.change_set_id;
end;
$function$;

revoke all on function public.read_development_change_set_for_approval(text) from public, anon, service_role;
grant execute on function public.read_development_change_set_for_approval(text) to authenticated;

create or replace function public.approve_development_change_set(
  p_change_set_key text,
  p_expected_company_id uuid,
  p_expected_policy_sha256 text
)
returns table (approval_id uuid, approver_profile_id uuid, approved_at timestamptz, created boolean)
language plpgsql
security definer
set search_path = pg_catalog, system
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_bundle system.development_change_sets%rowtype;
  v_approval system.development_change_set_approvals%rowtype;
  v_created boolean := false;
begin
  if v_actor_id is null or coalesce(auth.role(), '') <> 'authenticated' then
    raise exception using errcode = '42501', message = 'DEVELOPMENT_APPROVAL_AUTH_REQUIRED';
  end if;
  select * into v_bundle from system.development_change_sets s
  where s.change_set_key = p_change_set_key;
  if not found or v_bundle.target_environment <> 'production'
     or v_bundle.target_company_id is distinct from p_expected_company_id
     or v_bundle.policy_sha256 is distinct from lower(p_expected_policy_sha256) then
    raise exception using errcode = '22023', message = 'DEVELOPMENT_APPROVAL_EVIDENCE_MISMATCH';
  end if;
  if not exists (
    select 1 from public.org_members m
    where m.organization_id = v_bundle.target_organization_id
      and m.user_id = v_actor_id and m.role = 'owner'
  ) then
    raise exception using errcode = '42501', message = 'DEVELOPMENT_APPROVAL_OWNER_REQUIRED';
  end if;
  if not exists (
    select 1 from public.companies c
    where c.id = v_bundle.target_company_id
      and c.organization_id = v_bundle.target_organization_id
  ) then
    raise exception using errcode = '42501', message = 'DEVELOPMENT_APPROVAL_COMPANY_ORGANIZATION_MISMATCH';
  end if;

  insert into system.development_change_set_approvals (
    change_set_id, target_company_id, target_organization_id,
    approver_profile_id, operation, policy_sha256
  ) values (
    v_bundle.change_set_id, v_bundle.target_company_id, v_bundle.target_organization_id,
    v_actor_id, v_bundle.operation, v_bundle.policy_sha256
  ) on conflict (change_set_id) do nothing
  returning * into v_approval;
  if v_approval.approval_id is not null then
    v_created := true;
  else
    select * into v_approval from system.development_change_set_approvals a
    where a.change_set_id = v_bundle.change_set_id;
    if not found or v_approval.approver_profile_id <> v_actor_id
       or v_approval.target_company_id <> v_bundle.target_company_id
       or v_approval.target_organization_id <> v_bundle.target_organization_id
       or v_approval.operation <> v_bundle.operation
       or v_approval.policy_sha256 <> v_bundle.policy_sha256 then
      raise exception using errcode = '23505', message = 'DEVELOPMENT_CHANGE_SET_ALREADY_APPROVED';
    end if;
  end if;
  return query select v_approval.approval_id, v_approval.approver_profile_id,
                      v_approval.approved_at, v_created;
end;
$function$;

revoke all on function public.approve_development_change_set(text, uuid, text)
  from public, anon, service_role;
grant execute on function public.approve_development_change_set(text, uuid, text) to authenticated;

create or replace function public.link_development_event_to_change_set(
  p_event_key text,
  p_change_set_key text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, system
as $function$
declare
  v_event system.development_events%rowtype;
  v_change_set system.development_change_sets%rowtype;
begin
  select * into v_event from system.development_events where event_key = p_event_key;
  if not found then raise exception 'development event is not present'; end if;
  select * into v_change_set from system.development_change_sets where change_set_key = p_change_set_key;
  if not found then raise exception 'development change set is not present'; end if;
  if v_event.lineage_id <> v_change_set.lineage_id then
    raise exception 'event and change set belong to different DNA lineages';
  end if;
  if v_event.commit_sha is not null and not exists (
    select 1 from system.development_change_files f
    where f.change_set_id = v_change_set.change_set_id and f.commit_sha = v_event.commit_sha
  ) then raise exception 'event commit SHA is not present in the change-set file manifest'; end if;

  insert into system.development_event_change_sets (event_id, change_set_id)
  values (v_event.event_id, v_change_set.change_set_id)
  on conflict (event_id, change_set_id) do nothing;
  return true;
end;
$function$;

revoke all on function public.link_development_event_to_change_set(text, text) from public, anon, authenticated;
grant execute on function public.link_development_event_to_change_set(text, text) to service_role;

create or replace function public.read_development_change_sets(
  p_record_key text default 'dnaos-platform',
  p_limit integer default 50
)
returns table (
  change_set_key text,
  category text,
  title text,
  summary text,
  repository text,
  operation text,
  target_kind text,
  target_environment text,
  environment_id text,
  target_ref text,
  target_company_id uuid,
  target_organization_id uuid,
  policy_ref text,
  policy_version text,
  policy_sha256 text,
  approval jsonb,
  credential_class text,
  manifest_sha256 text,
  source_started_at timestamptz,
  recorded_at timestamptz,
  files jsonb,
  events jsonb
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
  return query
  select s.change_set_key, s.category, s.title, s.summary, s.repository, s.operation,
         s.target_kind, s.target_environment, s.environment_id, s.target_ref, s.target_company_id,
         s.target_organization_id, s.policy_ref, s.policy_version, s.policy_sha256,
         (select jsonb_build_object(
            'approval_id', a.approval_id, 'approver_profile_id', a.approver_profile_id,
            'approved_at', a.approved_at, 'operation', a.operation,
            'policy_sha256', a.policy_sha256
          ) from system.development_change_set_approvals a where a.change_set_id = s.change_set_id),
         s.credential_class, s.manifest_sha256,
         s.source_started_at, s.recorded_at,
         coalesce((select jsonb_agg(jsonb_build_object(
           'path', f.repository_path, 'previous_path', f.previous_path, 'commit_sha', f.commit_sha,
           'change_kind', f.change_kind, 'content_sha256', f.content_sha256
         ) order by f.commit_sha, f.repository_path)
         from system.development_change_files f where f.change_set_id = s.change_set_id), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object(
           'event_id', e.event_id, 'sequence_no', e.sequence_no, 'event_type', e.event_type,
           'status', e.status, 'commit_sha', e.commit_sha, 'environment', e.environment,
           'occurred_at', e.occurred_at, 'recorded_at', e.recorded_at
         ) order by e.sequence_no)
         from system.development_event_change_sets l
         join system.development_events e on e.event_id = l.event_id
         where l.change_set_id = s.change_set_id), '[]'::jsonb)
  from system.development_change_sets s
  join system.development_lineages d on d.dna_id = s.lineage_id
  where d.record_key = p_record_key
  order by s.source_started_at desc, s.change_set_id
  limit p_limit;
end;
$function$;

revoke all on function public.read_development_change_sets(text, integer) from public, anon, authenticated;
grant execute on function public.read_development_change_sets(text, integer) to service_role;

-- AI and other read-only clients can inspect technical lineage and file hashes,
-- but not the target company, Production policy, approval, or credential class.
create or replace function public.read_public_development_change_sets(
  p_record_key text default 'dnaos-platform',
  p_limit integer default 50
)
returns table (
  change_set_key text,
  category text,
  title text,
  repository text,
  operation text,
  manifest_sha256 text,
  source_started_at timestamptz,
  recorded_at timestamptz,
  files jsonb,
  events jsonb
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
  return query
  select s.change_set_key, s.category, s.title, s.repository, s.operation,
         s.manifest_sha256, s.source_started_at, s.recorded_at,
         coalesce((select jsonb_agg(jsonb_build_object(
           'path', f.repository_path, 'previous_path', f.previous_path,
           'commit_sha', f.commit_sha, 'change_kind', f.change_kind,
           'content_sha256', f.content_sha256
         ) order by f.commit_sha, f.repository_path)
         from system.development_change_files f where f.change_set_id = s.change_set_id), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object(
           'sequence_no', e.sequence_no, 'event_type', e.event_type,
           'status', e.status, 'commit_sha', e.commit_sha,
           'occurred_at', e.occurred_at, 'recorded_at', e.recorded_at
         ) order by e.sequence_no)
         from system.development_event_change_sets l
         join system.development_events e on e.event_id = l.event_id
         where l.change_set_id = s.change_set_id), '[]'::jsonb)
  from system.development_change_sets s
  join system.development_lineages d on d.dna_id = s.lineage_id
  where d.record_key = p_record_key
  order by s.source_started_at desc, s.change_set_id
  limit p_limit;
end;
$function$;

revoke all on function public.read_public_development_change_sets(text, integer) from public;
grant execute on function public.read_public_development_change_sets(text, integer)
  to anon, authenticated, service_role;

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
    select event_id, event_type, status, environment, migration_id, sql_sha256, branch, occurred_at
    from system.development_events
    where lineage_id = p_lineage_id and commit_sha = lower(p_commit_sha)
  ), required as (
    select unnest(array[
      'github_main_merged', 'manual_checks_completed', 'build_verified',
      'deployment_completed', 'live_route_verified'
    ]) as event_type
  ), missing_required as (
    select r.event_type
    from required r
    where not exists (
      select 1
      from matching m
      join system.development_event_change_sets l on l.event_id = m.event_id
      join system.development_change_sets s on s.change_set_id = l.change_set_id
      where m.event_type = r.event_type and m.status = 'passed'
        and (r.event_type <> 'github_main_merged' or m.branch = 'main')
        and (r.event_type <> 'deployment_completed' or m.environment = 'production')
        and (r.event_type <> 'live_route_verified' or m.environment = 'production')
        and s.target_environment = 'production'
        and exists (
          select 1 from system.development_change_files f
          where f.change_set_id = s.change_set_id and f.commit_sha = lower(p_commit_sha)
        )
    )
  ), missing_bundle as (
    select 'change_set_and_file_manifest' as evidence
    where not exists (
      select 1
      from matching m
      join system.development_event_change_sets l on l.event_id = m.event_id
      join system.development_change_sets s on s.change_set_id = l.change_set_id
      where s.target_environment = 'production'
        and s.target_ref is not null
        and s.target_company_id is not null
        and s.target_organization_id is not null
        and s.policy_ref is not null
        and s.policy_sha256 is not null
        and s.credential_class = 'production_release_scoped'
        and exists (
          select 1
          from system.development_change_set_approvals approval
          where approval.change_set_id = s.change_set_id
            and approval.target_company_id = s.target_company_id
            and approval.target_organization_id = s.target_organization_id
            and approval.operation = s.operation
            and approval.policy_sha256 = s.policy_sha256
        )
        and exists (
          select 1
          from matching release_event
          join system.development_event_change_sets release_link
            on release_link.event_id = release_event.event_id
           and release_link.change_set_id = s.change_set_id
          where release_event.event_type in ('migration_applied', 'deployment_completed')
            and release_event.status = 'passed'
            and release_event.occurred_at >= (
              select approval.approved_at from system.development_change_set_approvals approval
              where approval.change_set_id = s.change_set_id
            )
        )
        and exists (
          select 1 from system.development_change_files f
          where f.change_set_id = s.change_set_id and f.commit_sha = lower(p_commit_sha)
        )
    )
  ), applied_migrations as (
    select distinct m.migration_id, m.sql_sha256, m.environment, l.change_set_id
    from matching m
    join system.development_event_change_sets l on l.event_id = m.event_id
    where m.event_type = 'migration_applied' and m.status = 'passed'
  ), missing_migrations as (
    select a.migration_id
    from applied_migrations a
    where not exists (
      select 1
      from matching m
      join system.development_event_change_sets l on l.event_id = m.event_id
       and l.change_set_id = a.change_set_id
      where m.event_type = 'migration_verified' and m.status = 'passed'
        and m.migration_id = a.migration_id and m.sql_sha256 = a.sql_sha256
        and m.environment is not distinct from a.environment
    )
  ), all_missing as (
    select event_type as evidence from missing_required
    union all select evidence from missing_bundle
    union all select 'migration_verified:' || migration_id from missing_migrations
  )
  select not exists (select 1 from all_missing),
         coalesce(array_agg(evidence order by evidence), array[]::text[])
  from all_missing;
$function$;

commit;
