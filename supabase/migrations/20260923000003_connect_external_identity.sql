-- Connect external identity — canonical provider-neutral identity model
-- (capability C of the provider-retreat line, owner decision D4 = YES, 2026-09-23).
--
-- WHY: business identity is currently stored in provider-shaped tables —
-- public.line_profiles (PK line_user_id) and public.company_line_links
-- (company_id ↔ line_user_id). 74 references across ~42 files read them for
-- business decisions (who is this customer, which company, what role/trust),
-- which makes "LINE" the de-facto business identity authority. The target is:
-- LINE (or any provider) is only ONE KIND of external identity, and the
-- canonical model is provider-neutral:
--
--   provider  ->  external account/channel  ->  external subject  ->  canonical company
--
-- Additive only. Nothing is dropped, renamed or rewritten here:
--   * public.line_profiles      stays, marked historical after cutover
--   * public.company_line_links stays, marked historical after cutover
--   * public.line_channels      stays as the CURRENT home of channel credentials
--     (referenced by name from connect_external_accounts.credential_ref — a
--     reference, never a value; moving the values into connector/Vault is an
--     internal change of that one accessor, not a caller change)
-- Credentials are never stored in this model, never returned to a browser, and
-- never read by the UI.
--
-- Status: NOT APPLIED. Draft for the Owner to review and run. RELEASE ORDER
-- (migration-before-code, same discipline as B-04R3): (1) apply this file,
-- (2) verify the tables/backfill/view exist, (3) deploy the code that reads the
-- canonical model. Code deployed before this migration has no canonical rows to
-- read — the identity resolver answers null (fail-closed, never a guess) rather
-- than falling back to a second authority.

-- ── 1. External accounts / channels ─────────────────────────────────────────
create table if not exists public.connect_external_accounts (
  provider            text not null,
  external_account_id text not null,
  label               text,
  config              jsonb not null default '{}'::jsonb,
  -- NAME of the location holding this account's credential (e.g.
  -- 'line_channels:channel_secret', later 'connector:line#channel_access_token').
  -- A reference, never a secret value.
  credential_ref      text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  primary key (provider, external_account_id)
);

comment on table public.connect_external_accounts is
  'Canonical provider account/channel registry (Connect). One row per external account — e.g. one row per LINE Official Account. Holds identity/config metadata only; credential_ref NAMES where the credential lives, never the value.';

-- ── 2. External subjects → canonical company/person identity ────────────────
create table if not exists public.connect_external_identities (
  id                  uuid primary key default gen_random_uuid(),
  provider            text not null,
  external_subject_id text not null,
  company_id          uuid,
  display_name        text,
  role                text
    check (role is null or role in ('employee', 'customer', 'supplier', 'driver', 'owner', 'contractor', 'accountant', 'manager', 'admin', 'external')),
  department          text,
  trust_level         text
    check (trust_level is null or trust_level in ('verified', 'unverified', 'flagged')),
  notes               text,
  permissions         jsonb,
  -- Where this row came from: 'backfill:line_profiles', 'backfill:company_line_links',
  -- or 'connect:<actor>' for rows written through the canonical linker.
  source              text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (provider, external_subject_id)
);

create index if not exists connect_external_identities_company_idx
  on public.connect_external_identities (company_id);
create index if not exists connect_external_identities_role_idx
  on public.connect_external_identities (provider, role);

comment on table public.connect_external_identities is
  'Canonical external-subject identity (Connect). Maps one provider subject (e.g. a LINE user id) to the canonical company/person identity plus role/trust. Provider-neutral: the provider column carries the provider id, no provider name appears in any column or constraint.';

-- ── 3. Backfill from the two legacy provider tables (idempotent, lossless) ──
-- Accounts/channels: line_channels stays the credential home (see credential_ref).
insert into public.connect_external_accounts (provider, external_account_id, label, credential_ref)
select 'line', c.channel_id, c.label, 'line_channels:channel_secret,channel_access_token'
from public.line_channels c
where c.channel_id is not null
on conflict (provider, external_account_id) do update
  set label = coalesce(excluded.label, public.connect_external_accounts.label),
      credential_ref = coalesce(public.connect_external_accounts.credential_ref, excluded.credential_ref),
      updated_at = now();

-- Identities: union of company_line_links (which company) and line_profiles
-- (name/role/trust/permissions). COALESCE keeps any value already present, so
-- re-running this file never erases canonical data that was set afterwards.
with legacy_subjects as (
  select line_user_id as subject from public.company_line_links
  union
  select line_user_id as subject from public.line_profiles
)
insert into public.connect_external_identities
  (provider, external_subject_id, company_id, display_name, role, department, trust_level, notes, permissions, source)
select
  'line',
  s.subject,
  p.company_id,
  p.display_name,
  p.role,
  p.department,
  p.trust_level,
  p.notes,
  p.permissions,
  case
    when p.line_user_id is not null and l.line_user_id is not null then 'backfill:line_profiles+company_line_links'
    when p.line_user_id is not null then 'backfill:line_profiles'
    else 'backfill:company_line_links'
  end
from legacy_subjects s
left join public.line_profiles p on p.line_user_id = s.subject
left join public.company_line_links l on l.line_user_id = s.subject
on conflict (provider, external_subject_id) do update
  set company_id   = coalesce(public.connect_external_identities.company_id, excluded.company_id),
      display_name = coalesce(public.connect_external_identities.display_name, excluded.display_name),
      role         = coalesce(public.connect_external_identities.role, excluded.role),
      department   = coalesce(public.connect_external_identities.department, excluded.department),
      trust_level  = coalesce(public.connect_external_identities.trust_level, excluded.trust_level),
      notes        = coalesce(public.connect_external_identities.notes, excluded.notes),
      permissions  = coalesce(public.connect_external_identities.permissions, excluded.permissions),
      updated_at   = now();

-- ── 4. Canonical read surface (one contract for both runtimes) ──────────────
-- Both the Next-side resolver and the Deno-side edge read THIS view, so the
-- resolution contract is defined once (SQL) instead of duplicated per runtime.
-- The view is dropped and recreated so this file stays re-runnable when the
-- projection changes (safe: it is created by this same file and the release
-- order is migration-before-code).
drop view if exists public.connect_identity_current;

create view public.connect_identity_current as
select
  i.provider,
  i.external_subject_id,
  i.company_id,
  c.name     as company_name,
  c.tax_id   as company_tax_id,
  c.phone    as company_phone,
  i.display_name,
  i.role,
  i.department,
  i.trust_level,
  i.permissions
from public.connect_external_identities i
left join public.companies c on c.id = i.company_id;

comment on view public.connect_identity_current is
  'Canonical external-identity read model (Connect): provider + external subject -> canonical company/role/trust. The single resolution contract for every runtime; provider-neutral by construction.';

-- ── 4b. Provider-neutral credential accessor (ONE implementation, both runtimes) ──
-- Resolves an external account's credential by following connect_external_accounts
-- .credential_ref — a REFERENCE string, never a value:
--     '<table>:<id_column>:<col>[,<col>...]'      e.g. line_channels:channel_id:channel_secret,channel_access_token
-- The function contains NO provider name and no provider branch: it validates the
-- referenced table/columns against information_schema and fails closed if the ref
-- is malformed or points at something that does not exist. Moving a credential
-- into connector/Vault later is a credential_ref change (data), not a code change
-- — and this stays the only place any runtime reads a provider credential.
-- SECURITY DEFINER with an explicit search_path, revoked from anon/authenticated,
-- granted to service_role only — the same discipline as the other canonical
-- functions (public.confirm_invoice / reconcile_receipt_payment).
create or replace function public.connect_external_account_credentials(
  p_provider text,
  p_external_account_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credential_ref text;
  v_config jsonb;
  v_label text;
  v_table text;
  v_id_column text;
  v_columns text[];
  v_result jsonb;
begin
  select credential_ref, config, label
    into v_credential_ref, v_config, v_label
    from public.connect_external_accounts
   where provider = p_provider
     and external_account_id = p_external_account_id;

  if not found then
    return null;
  end if;

  -- metadata is always safe to return; the credential travels only when the ref resolves
  v_result := jsonb_build_object('provider', p_provider, 'external_account_id', p_external_account_id,
                                 'label', v_label, 'config', coalesce(v_config, '{}'::jsonb));

  if v_credential_ref is null or position(':' in v_credential_ref) = 0 then
    return v_result || jsonb_build_object('credential', null, 'credential_resolved', false);
  end if;

  v_table := split_part(v_credential_ref, ':', 1);
  v_id_column := split_part(v_credential_ref, ':', 2);
  v_columns := string_to_array(split_part(v_credential_ref, ':', 3), ',');

  if v_table = '' or v_id_column = '' or array_length(v_columns, 1) is null then
    return v_result || jsonb_build_object('credential', null, 'credential_resolved', false);
  end if;

  -- validate identifiers against the catalogue — never trust the ref blindly
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = v_table and column_name = v_id_column) then
    return v_result || jsonb_build_object('credential', null, 'credential_resolved', false);
  end if;
  if exists (
    select 1 from unnest(v_columns) as col
     where not exists (select 1 from information_schema.columns
                        where table_schema = 'public' and table_name = v_table and column_name = col)
  ) then
    return v_result || jsonb_build_object('credential', null, 'credential_resolved', false);
  end if;

  execute format(
    'select to_jsonb(t) from (select %s from public.%I where %I = $1 limit 1) t',
    (select string_agg(quote_ident(c), ', ' order by c) from unnest(v_columns) as c),
    v_table, v_id_column
  )
  into v_result
  using p_external_account_id;

  if v_result is null then
    return jsonb_build_object('provider', p_provider, 'external_account_id', p_external_account_id,
                              'label', v_label, 'config', coalesce(v_config, '{}'::jsonb),
                              'credential', null, 'credential_resolved', false);
  end if;

  return jsonb_build_object('provider', p_provider, 'external_account_id', p_external_account_id,
                            'label', v_label, 'config', coalesce(v_config, '{}'::jsonb),
                            'credential', v_result, 'credential_resolved', true);
end;
$$;

comment on function public.connect_external_account_credentials(text, text) is
  'Connect credential accessor (capability C): resolves an external account credential by following connect_external_accounts.credential_ref. Provider-neutral (no provider name/branch). Service-role only; never exposed to anon/authenticated or a browser.';

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.connect_external_account_credentials(text, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.connect_external_account_credentials(text, text) from authenticated';
  end if;
  execute 'revoke all on function public.connect_external_account_credentials(text, text) from public';
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.connect_external_account_credentials(text, text) to service_role';
  end if;
end
$$;

-- ── 5. Access control (same discipline as the legacy tables) ────────────────
alter table public.connect_external_accounts enable row level security;
alter table public.connect_external_identities enable row level security;

do $$
begin
  -- policies are recreated idempotently; service_role bypasses RLS, anon/authenticated see nothing
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'connect_external_accounts' and policyname = 'service_role_only') then
    create policy service_role_only on public.connect_external_accounts for all using (false);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'connect_external_identities' and policyname = 'service_role_only') then
    create policy service_role_only on public.connect_external_identities for all using (false);
  end if;

  -- the canonical view must not become an anon/authenticated RLS bypass
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.connect_external_accounts from anon';
    execute 'revoke all on public.connect_external_identities from anon';
    execute 'revoke all on public.connect_identity_current from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on public.connect_external_accounts from authenticated';
    execute 'revoke all on public.connect_external_identities from authenticated';
    execute 'revoke all on public.connect_identity_current from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.connect_external_accounts to service_role';
    execute 'grant all on public.connect_external_identities to service_role';
    execute 'grant select on public.connect_identity_current to service_role';
  end if;
end
$$;

-- ── 6b. Legacy tables become READ-ONLY projections of the canonical model ───
-- The canonical model is now the ONLY authority: every write goes to
-- connect_external_identities, and the two provider-shaped tables are kept as
-- a compatibility projection so existing readers keep seeing the truth without
-- a dual-write (there is exactly one stored copy of the identity).
--   * projection trigger: canonical INSERT/UPDATE/DELETE mirrors into
--     line_profiles / company_line_links for provider = 'line'
--   * guard trigger: any direct INSERT/UPDATE/DELETE on the legacy tables is
--     REJECTED, so a forgotten writer can never diverge again (fail-closed)
-- Renaming/removing the projection is explicit later cleanup (P7), not part of
-- this capability — nothing here drops, renames or deletes a table or a row.

create or replace function public.connect_project_identity_to_legacy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider text := coalesce(new.provider, old.provider);
  v_subject text := coalesce(new.external_subject_id, old.external_subject_id);
begin
  if v_provider <> 'line' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    delete from public.line_profiles where line_user_id = v_subject;
    delete from public.company_line_links where line_user_id = v_subject;
    return old;
  end if;

  insert into public.line_profiles (line_user_id, display_name, role, company_id, department, trust_level, notes, permissions, updated_at)
  values (v_subject, new.display_name, coalesce(new.role, 'external'), new.company_id, new.department,
          coalesce(new.trust_level, 'unverified'), new.notes, coalesce(new.permissions, '{}'::jsonb), now())
  on conflict (line_user_id) do update
    set display_name = excluded.display_name,
        role = excluded.role,
        company_id = excluded.company_id,
        department = excluded.department,
        trust_level = excluded.trust_level,
        notes = excluded.notes,
        permissions = excluded.permissions,
        updated_at = now();

  if new.company_id is not null then
    insert into public.company_line_links (company_id, line_user_id)
    values (new.company_id, v_subject)
    on conflict (line_user_id) do update set company_id = excluded.company_id;
  else
    delete from public.company_line_links where line_user_id = v_subject;
  end if;

  return new;
end;
$$;

drop trigger if exists connect_project_identity_ins on public.connect_external_identities;
create trigger connect_project_identity_ins
  after insert or update on public.connect_external_identities
  for each row execute function public.connect_project_identity_to_legacy();

drop trigger if exists connect_project_identity_del on public.connect_external_identities;
create trigger connect_project_identity_del
  after delete on public.connect_external_identities
  for each row execute function public.connect_project_identity_to_legacy();

-- Guard: the legacy tables are projections, never a write target.
-- The projection function above writes through this same trigger, so depth is
-- used instead of a session flag: a direct write arrives at depth 1, a write
-- performed inside the projection trigger arrives deeper. No session state is
-- ever set, so nothing can leak or be forgotten.
create or replace function public.connect_identity_legacy_is_read_only()
returns trigger
language plpgsql
as $$
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;
  raise exception 'public.% is a read-only projection of the canonical Connect identity model — write through public.connect_external_identities (engines/connect/identity.ts#linkExternalIdentity) instead', tg_table_name
    using errcode = '42501';
end;
$$;

drop trigger if exists connect_identity_legacy_guard on public.line_profiles;
create trigger connect_identity_legacy_guard
  before insert or update or delete on public.line_profiles
  for each row execute function public.connect_identity_legacy_is_read_only();

drop trigger if exists connect_identity_legacy_guard on public.company_line_links;
create trigger connect_identity_legacy_guard
  before insert or update or delete on public.company_line_links
  for each row execute function public.connect_identity_legacy_is_read_only();

comment on function public.connect_identity_legacy_is_read_only() is
  'Fail-closed guard (capability C): the provider-shaped identity tables are now read-only projections of the canonical Connect model. A single writer (public.connect_external_identities) prevents the two copies from ever diverging.';

comment on table public.line_profiles is
  'HISTORICAL (capability C, 2026-09-23): provider-shaped identity table kept for history and rollback. Runtime identity resolution reads public.connect_identity_current / public.connect_external_identities. Do not add new providers here.';

comment on table public.company_line_links is
  'HISTORICAL (capability C, 2026-09-23): provider-shaped company↔LINE-user mapping kept for history and rollback. Runtime identity resolution reads public.connect_external_identities. Do not add new providers here.';

