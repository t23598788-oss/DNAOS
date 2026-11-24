begin;

-- Harden the already-installed provenance ledger functions without rewriting
-- migration 20261123000002, whose source is preserved as the applied baseline.


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

  select count(*) into v_file_count from jsonb_array_elements(p_files);
  if v_created then
    -- Only a newly-created bundle may receive file rows. Retries against an
    -- existing immutable bundle must verify its exact manifest before return.
    for v_file in select value from jsonb_array_elements(p_files) loop
      insert into system.development_change_files (
        change_set_id, repository_path, previous_path, commit_sha, change_kind, content_sha256
      ) values (
        v_change_set_id, v_file->>'path', v_file->>'previous_path', v_file->>'commit_sha',
        v_file->>'change_kind', v_file->>'content_sha256'
      ) on conflict on constraint development_change_files_pkey do nothing;
    end loop;

    select count(*) into v_existing_file_count from system.development_change_files f
    where f.change_set_id = v_change_set_id;
    if v_file_count <> v_existing_file_count then
      raise exception 'stored file manifest does not match the supplied evidence';
    end if;
  else
    -- Check cardinality before comparing rows; never append to an immutable
    -- bundle merely because a retry supplied additional file entries.
    select count(*) into v_existing_file_count from system.development_change_files f
    where f.change_set_id = v_change_set_id;
    if v_file_count <> v_existing_file_count then
      raise exception 'stored file manifest does not match the supplied evidence';
    end if;
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
    -- Keep successful migration events even when they lack a bundle link;
    -- an unlinked application is incomplete release evidence, not an absence.
    select distinct m.migration_id, m.sql_sha256, m.environment, l.change_set_id
    from matching m
    left join system.development_event_change_sets l on l.event_id = m.event_id
    where m.event_type = 'migration_applied' and m.status = 'passed'
  ), missing_migrations as (
    select a.migration_id
    from applied_migrations a
    where a.change_set_id is null or not exists (
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
