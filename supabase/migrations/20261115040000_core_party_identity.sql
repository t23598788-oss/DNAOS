-- Core party identity for provider-neutral inbound messaging.
-- Additive only: reuse the existing canonical connect_external_identities map;
-- do not create a parallel identity_mappings authority.

create table if not exists public.parties (
  id uuid primary key default gen_random_uuid(),
  party_type text not null default 'person' check (party_type in ('person')),
  created_via text not null,
  created_at timestamptz not null default now()
);

comment on table public.parties is
  'Minimal canonical person identity for external messaging subjects. Provider identifiers remain in connect_external_identities; cross-provider linking requires a separate verified identity-link flow.';

alter table public.connect_external_identities
  add column if not exists party_id uuid references public.parties(id) on delete restrict;

create index if not exists connect_external_identities_party_idx
  on public.connect_external_identities (party_id) where party_id is not null;

create or replace view public.connect_identity_current as
select
  i.provider,
  i.external_subject_id,
  i.company_id,
  c.name as company_name,
  c.tax_id as company_tax_id,
  c.phone as company_phone,
  i.display_name,
  i.role,
  i.department,
  i.trust_level,
  i.permissions,
  i.party_id
from public.connect_external_identities i
left join public.companies c on c.id = i.company_id;

comment on view public.connect_identity_current is
  'Canonical external identity read model: provider subject -> optional company and optional person party; cross-provider equality is never inferred.';

create or replace function public.ensure_external_party_identity(
  p_provider text,
  p_external_subject_id text
) returns table (party_id uuid, created boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party_id uuid;
begin
  if p_provider not in ('kodchat', 'line', 'facebook', 'instagram') then
    raise exception 'UNSUPPORTED_IDENTITY_PROVIDER';
  end if;
  if p_external_subject_id is null or length(p_external_subject_id) < 1 or length(p_external_subject_id) > 512 then
    raise exception 'INVALID_EXTERNAL_SUBJECT_ID';
  end if;

  -- Serialize first-contact races for the same external subject.
  perform pg_advisory_xact_lock(hashtext(p_provider), hashtext(p_external_subject_id));

  select i.party_id into v_party_id
    from public.connect_external_identities i
   where i.provider = p_provider
     and i.external_subject_id = p_external_subject_id
   for update;

  if v_party_id is not null then
    return query select v_party_id, false;
    return;
  end if;

  insert into public.parties (created_via)
  values ('silent-onboarding:' || p_provider)
  returning id into v_party_id;

  insert into public.connect_external_identities
    (provider, external_subject_id, party_id, role, trust_level, source, updated_at)
  values
    (p_provider, p_external_subject_id, v_party_id, 'external', 'unverified', 'silent-onboarding', now())
  on conflict (provider, external_subject_id) do update
    set party_id = coalesce(public.connect_external_identities.party_id, excluded.party_id),
        updated_at = now()
  returning connect_external_identities.party_id into v_party_id;

  return query select v_party_id, true;
end;
$$;

comment on function public.ensure_external_party_identity(text, text) is
  'Atomic silent onboarding: one new person party per unmapped provider subject. Never merges subjects across providers.';

alter table public.parties enable row level security;
drop policy if exists parties_service_role_only on public.parties;
create policy parties_service_role_only on public.parties
  for all using (false) with check (false);

revoke all on public.parties from anon, authenticated;
revoke all on function public.ensure_external_party_identity(text, text) from public, anon, authenticated;
grant all on public.parties to service_role;
grant execute on function public.ensure_external_party_identity(text, text) to service_role;
grant select on public.connect_identity_current to service_role;
