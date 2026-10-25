-- Explicit delegated authority — MINIMAL SCHEMA PROPOSAL (WAVE 3, 2026-10-25)
--
-- WHY THIS EXISTS: core/authority/resolve.ts already requires one of two proofs
-- before an actor may change someone else's business data:
--   owner   pit_profiles.user_id / customer_sites owner (resource ownership)
--   grant   an explicit, in-window, unrevoked delegation row
--
-- The repository currently has NO organization/authority membership storage at
-- all (verified: `organizations`, `org_members`, `identity_memberships` and
-- `scoped_grants` do not exist in supabase/local-migration/full_schema.sql or in
-- any migration). The only existing binding is `pit_profiles.user_id`, which is
-- nullable. So today an actor who is not the recorded owner can only be DENIED —
-- that is fail-closed, but it also means a legitimate operator cannot be granted
-- price authority without a schema change. This is that minimal change: ONE table
-- for explicit delegation, matching the ScopeGrant shape the resolver already
-- consumes. No second permission system, no role matrix, no provider matching.
--
-- ORGANIZATION SCOPE IS DELIBERATELY NOT INVENTED HERE. There is no
-- `organizations` table to reference, so `organization_id` is a plain uuid column
-- with no FK; the resolver only accepts a grant whose organization_id matches the
-- resource's organization_id AND the actor's loaded memberships. Until those
-- tables exist, every grant must leave organization_id null and is therefore
-- resource-scoped only (a wildcard `*` still only covers that one resource kind).
--
-- NOT APPLIED TO ANY DATABASE YET. The loader (engines/authority/load.ts) treats
-- a missing table/query error as "no grants" — never as "allow" — so shipping the
-- code before this migration only reduces delegation, it cannot widen access.
--
-- PREFLIGHT (run manually; must return 0 rows):
--   select id from public.profiles where id is null;             -- (never matches; sanity)
--   select subject_profile_id, resource_kind, coalesce(resource_id::text,'*'), action,
--          count(*) from (
--            select subject_profile_id, resource_kind, resource_id, unnest(actions) as action
--              from public.authority_grants
--             where revoked_at is null
--          ) g group by 1,2,3,4 having count(*) > 1;            -- duplicate live grants
--
-- ROLLBACK: see 20261025000002_authority_grants_rollback.sql (drop table only).
-- The table is new; no existing row/column is altered.

create table if not exists public.authority_grants (
  id                  uuid primary key default gen_random_uuid(),
  -- who receives the delegation (a real profile, never a LINE id / display name)
  subject_profile_id  uuid not null references public.profiles(id) on delete cascade,
  -- optional organization scope; null = resource-scoped only (see header)
  organization_id     uuid,
  resource_kind       text not null check (resource_kind in ('pit', 'site', 'company', 'transaction')),
  -- exact resource id, or null = every resource of that kind the subject can see
  resource_id         uuid,
  -- closed vocabulary, mirrors core/authority/resolve.ts AUTHORITY_ACTIONS
  actions             text[] not null check (cardinality(actions) > 0),
  -- who granted it (evidence, not authority)
  granted_by_profile_id uuid references public.profiles(id) on delete set null,
  reason              text,
  valid_from          timestamptz not null default now(),
  valid_to            timestamptz,
  revoked_at          timestamptz,
  created_at          timestamptz not null default now(),
  constraint authority_grants_window_check
    check (valid_to is null or valid_to > valid_from),
  constraint authority_grants_actions_vocabulary_check
    check (actions <@ array['price.write', 'price.offer.record', 'site.create',
                             'authority.claim', 'authority.decide']::text[])
);

comment on table public.authority_grants is
  'Explicit delegation consumed by core/authority/resolve.ts. A missing row = DENY.';

create index if not exists authority_grants_subject_live_idx
  on public.authority_grants (subject_profile_id)
  where revoked_at is null;

create index if not exists authority_grants_resource_idx
  on public.authority_grants (resource_kind, resource_id)
  where revoked_at is null;

-- No RLS policy is proposed here: every read/write in this repository's server
-- code uses the service role, and adding a policy without an ownership column
-- would be a false sense of protection. Reads still fail closed at the resolver.
