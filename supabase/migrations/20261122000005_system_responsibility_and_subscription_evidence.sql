-- Keep one Supabase project. Separate system/provider responsibility and cost
-- evidence from tenant business expenses. Existing observations are backfilled
-- as unassigned; a shared mailbox or masked card is not proof of ownership.

begin;

grant usage on schema system to service_role;

do $preflight$
begin
  if to_regnamespace('system') is null
     or to_regclass('public.subscription_services') is null
     or to_regclass('public.connectors') is null
     or to_regclass('public.organizations') is null
     or to_regclass('public.companies') is null
     or to_regclass('public.profiles') is null
     or to_regclass('auth.users') is null then
    raise exception 'responsibility registry preflight failed: required existing relations are missing';
  end if;
end
$preflight$;

create table if not exists system.responsibility_accounts (
  id uuid primary key default gen_random_uuid(),
  provider_code text not null,
  account_kind text not null check (account_kind in ('mailbox', 'provider_account', 'platform_account', 'service_account')),
  provider_account_ref text not null,
  display_name text,
  email_address text,
  source_connector_id uuid references public.connectors(id) on delete set null,
  owner_kind text not null default 'unassigned'
    check (owner_kind in ('unassigned', 'platform', 'user', 'organization', 'company')),
  owner_user_id uuid references auth.users(id) on delete restrict,
  owner_organization_id uuid references public.organizations(id) on delete restrict,
  owner_company_id uuid references public.companies(id) on delete restrict,
  attribution_status text not null default 'unverified'
    check (attribution_status in ('unverified', 'under_review', 'verified')),
  verification_reference text,
  verified_at timestamptz,
  verified_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_code, account_kind, provider_account_ref),
  check (
    (owner_kind = 'unassigned' and owner_user_id is null and owner_organization_id is null and owner_company_id is null)
    or (owner_kind = 'platform' and owner_user_id is null and owner_organization_id is null and owner_company_id is null)
    or (owner_kind = 'user' and owner_user_id is not null and owner_organization_id is null and owner_company_id is null)
    or (owner_kind = 'organization' and owner_user_id is null and owner_organization_id is not null and owner_company_id is null)
    or (owner_kind = 'company' and owner_user_id is null and owner_company_id is not null)
  ),
  check (attribution_status <> 'verified' or (verified_at is not null and verification_reference is not null))
);

create index if not exists responsibility_accounts_owner_idx
  on system.responsibility_accounts (owner_kind, owner_user_id, owner_organization_id, owner_company_id);
create index if not exists responsibility_accounts_connector_idx
  on system.responsibility_accounts (source_connector_id) where source_connector_id is not null;

create table if not exists system.subscription_costs (
  id uuid primary key default gen_random_uuid(),
  legacy_subscription_service_id uuid unique
    references public.subscription_services(id) on delete set null,
  provider_invoice_key text unique,
  provider_code text not null,
  service_name text not null,
  cost_kind text not null default 'email_observation'
    check (cost_kind in ('email_observation', 'provider_invoice', 'manual_contract', 'usage_billing')),
  amount numeric,
  currency text not null default 'THB',
  billing_cycle text,
  service_status text not null default 'unknown',
  source_account_id uuid references system.responsibility_accounts(id) on delete set null,
  payer_account_id uuid references system.responsibility_accounts(id) on delete set null,
  payer_attribution_status text not null default 'unassigned'
    check (payer_attribution_status in ('unassigned', 'under_review', 'verified')),
  last_source_event_ref text,
  last_evidence_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (payer_attribution_status <> 'verified' or payer_account_id is not null)
);

create index if not exists subscription_costs_provider_idx
  on system.subscription_costs (provider_code, service_name);
create index if not exists subscription_costs_attribution_idx
  on system.subscription_costs (payer_attribution_status, updated_at desc);

create table if not exists system.subscription_evidence (
  id uuid primary key default gen_random_uuid(),
  subscription_cost_id uuid not null references system.subscription_costs(id) on delete restrict,
  source_account_id uuid references system.responsibility_accounts(id) on delete set null,
  source_kind text not null check (source_kind in ('gmail_message', 'provider_invoice', 'manual_record', 'provider_api')),
  source_reference text not null,
  source_connector_id uuid references public.connectors(id) on delete set null,
  recorded_by_user_id uuid references auth.users(id) on delete set null,
  evidence_sha256 text check (evidence_sha256 is null or evidence_sha256 ~ '^[0-9a-f]{64}$'),
  parser_confidence text check (parser_confidence is null or parser_confidence in ('high', 'medium', 'low', 'not_applicable')),
  observed_at timestamptz,
  recorded_at timestamptz not null default now(),
  sanitized_attributes jsonb not null default '{}'::jsonb,
  unique (subscription_cost_id, source_kind, source_reference)
);

create index if not exists subscription_evidence_cost_idx
  on system.subscription_evidence (subscription_cost_id, recorded_at desc);

create table if not exists system.subscription_attribution_events (
  id uuid primary key default gen_random_uuid(),
  subscription_cost_id uuid not null references system.subscription_costs(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_kind text not null check (event_kind in ('owner_assigned', 'owner_cleared', 'attribution_reviewed')),
  previous_payer_account_id uuid references system.responsibility_accounts(id) on delete set null,
  payer_account_id uuid references system.responsibility_accounts(id) on delete set null,
  previous_source_account_id uuid references system.responsibility_accounts(id) on delete set null,
  source_account_id uuid references system.responsibility_accounts(id) on delete set null,
  verification_reference text not null,
  recorded_at timestamptz not null default now()
);

create table if not exists system.responsibility_account_events (
  id uuid primary key default gen_random_uuid(),
  responsibility_account_id uuid not null references system.responsibility_accounts(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  previous_owner_kind text not null,
  previous_owner_user_id uuid,
  previous_owner_organization_id uuid,
  previous_owner_company_id uuid,
  owner_kind text not null,
  owner_user_id uuid,
  owner_organization_id uuid,
  owner_company_id uuid,
  verification_reference text not null,
  recorded_at timestamptz not null default now()
);

alter table system.responsibility_accounts enable row level security;
alter table system.subscription_costs enable row level security;
alter table system.subscription_evidence enable row level security;
alter table system.subscription_attribution_events enable row level security;
alter table system.responsibility_account_events enable row level security;

revoke all on system.responsibility_accounts, system.subscription_costs,
  system.subscription_evidence, system.subscription_attribution_events,
  system.responsibility_account_events
  from public, anon, authenticated;
grant select, insert, update on system.responsibility_accounts to service_role;
grant select, insert, update on system.subscription_costs to service_role;
grant select, insert on system.subscription_evidence to service_role;
grant select, insert on system.subscription_attribution_events to service_role;
grant select, insert on system.responsibility_account_events to service_role;

create or replace function system.reject_append_only_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception '% is append-only', tg_table_name using errcode = '55000';
end
$function$;

drop trigger if exists subscription_evidence_append_only on system.subscription_evidence;
create trigger subscription_evidence_append_only
  before update or delete on system.subscription_evidence
  for each row execute function system.reject_append_only_mutation();
drop trigger if exists subscription_attribution_events_append_only on system.subscription_attribution_events;
create trigger subscription_attribution_events_append_only
  before update or delete on system.subscription_attribution_events
  for each row execute function system.reject_append_only_mutation();
drop trigger if exists responsibility_account_events_append_only on system.responsibility_account_events;
create trigger responsibility_account_events_append_only
  before update or delete on system.responsibility_account_events
  for each row execute function system.reject_append_only_mutation();

create or replace function system.assign_responsibility_account_owner(
  p_responsibility_account_id uuid,
  p_owner_kind text,
  p_owner_user_id uuid,
  p_owner_organization_id uuid,
  p_owner_company_id uuid,
  p_actor_user_id uuid,
  p_verification_reference text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, system
as $function$
declare
  v_before system.responsibility_accounts%rowtype;
  v_cost system.subscription_costs%rowtype;
begin
  if p_actor_user_id is null or not exists (
    select 1 from public.profiles p
    where p.id = p_actor_user_id and p.role::text in ('super_admin', 'admin')
  ) then
    raise exception 'RESPONSIBILITY_ACCOUNT_ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if nullif(btrim(p_verification_reference), '') is null then
    raise exception 'RESPONSIBILITY_ACCOUNT_EVIDENCE_REQUIRED' using errcode = '22023';
  end if;
  if p_owner_kind not in ('platform', 'user', 'organization', 'company')
     or (p_owner_kind = 'platform' and (p_owner_user_id is not null or p_owner_organization_id is not null or p_owner_company_id is not null))
     or (p_owner_kind = 'user' and (p_owner_user_id is null or p_owner_organization_id is not null or p_owner_company_id is not null))
     or (p_owner_kind = 'organization' and (p_owner_user_id is not null or p_owner_organization_id is null or p_owner_company_id is not null))
     or (p_owner_kind = 'company' and (p_owner_user_id is not null or p_owner_company_id is null)) then
    raise exception 'RESPONSIBILITY_ACCOUNT_OWNER_INVALID' using errcode = '22023';
  end if;
  if p_owner_kind = 'platform' and not exists (
    select 1 from public.profiles p where p.id = p_actor_user_id and p.role::text = 'super_admin'
  ) then
    raise exception 'PLATFORM_ACCOUNT_SUPER_ADMIN_REQUIRED' using errcode = '42501';
  end if;

  select * into v_before from system.responsibility_accounts
    where id = p_responsibility_account_id for update;
  if not found then
    raise exception 'RESPONSIBILITY_ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;

  update system.responsibility_accounts
  set owner_kind = p_owner_kind,
      owner_user_id = p_owner_user_id,
      owner_organization_id = p_owner_organization_id,
      owner_company_id = p_owner_company_id,
      attribution_status = 'verified',
      verification_reference = btrim(p_verification_reference),
      verified_at = now(),
      verified_by_user_id = p_actor_user_id,
      updated_at = now()
  where id = p_responsibility_account_id;

  insert into system.responsibility_account_events (
    responsibility_account_id, actor_user_id,
    previous_owner_kind, previous_owner_user_id, previous_owner_organization_id, previous_owner_company_id,
    owner_kind, owner_user_id, owner_organization_id, owner_company_id, verification_reference
  ) values (
    p_responsibility_account_id, p_actor_user_id,
    v_before.owner_kind, v_before.owner_user_id, v_before.owner_organization_id, v_before.owner_company_id,
    p_owner_kind, p_owner_user_id, p_owner_organization_id, p_owner_company_id, btrim(p_verification_reference)
  );

  -- Provider invoices already identify the exact billing account. Once the
  -- account owner is verified, carry that verified responsibility to invoices
  -- charged to the same account, preserving one audit event per cost record.
  for v_cost in
    select * from system.subscription_costs c
    where c.payer_account_id = p_responsibility_account_id
      and c.payer_attribution_status <> 'verified'
    for update
  loop
    insert into system.subscription_attribution_events (
      subscription_cost_id, actor_user_id, event_kind,
      previous_payer_account_id, payer_account_id,
      previous_source_account_id, source_account_id, verification_reference
    ) values (
      v_cost.id, p_actor_user_id, 'owner_assigned',
      v_cost.payer_account_id, v_cost.payer_account_id,
      v_cost.source_account_id, v_cost.source_account_id, btrim(p_verification_reference)
    );
    update system.subscription_costs
      set payer_attribution_status = 'verified', updated_at = now()
      where id = v_cost.id;
  end loop;
end
$function$;

alter function system.assign_responsibility_account_owner(uuid, text, uuid, uuid, uuid, uuid, text) owner to postgres;
revoke all on function system.assign_responsibility_account_owner(uuid, text, uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function system.assign_responsibility_account_owner(uuid, text, uuid, uuid, uuid, uuid, text) to service_role;

create or replace function system.assign_subscription_cost_accounts(
  p_subscription_cost_id uuid,
  p_payer_account_id uuid,
  p_source_account_id uuid,
  p_actor_user_id uuid,
  p_verification_reference text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, system
as $function$
declare
  v_before system.subscription_costs%rowtype;
  v_kind text;
begin
  if p_actor_user_id is null
     or not exists (
       select 1 from public.profiles p
       where p.id = p_actor_user_id and p.role::text in ('super_admin', 'admin')
     ) then
    raise exception 'SUBSCRIPTION_ATTRIBUTION_ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if nullif(btrim(p_verification_reference), '') is null then
    raise exception 'SUBSCRIPTION_ATTRIBUTION_EVIDENCE_REQUIRED' using errcode = '22023';
  end if;
  if p_payer_account_id is not null and not exists (
    select 1 from system.responsibility_accounts a
    where a.id = p_payer_account_id and a.attribution_status = 'verified'
  ) then
    raise exception 'PAYER_ACCOUNT_NOT_VERIFIED' using errcode = '22023';
  end if;
  if p_source_account_id is not null and not exists (
    select 1 from system.responsibility_accounts a
    where a.id = p_source_account_id and a.account_kind = 'mailbox'
      and a.attribution_status = 'verified'
  ) then
    raise exception 'SOURCE_MAILBOX_NOT_VERIFIED' using errcode = '22023';
  end if;

  select * into v_before from system.subscription_costs
    where id = p_subscription_cost_id for update;
  if not found then
    raise exception 'SUBSCRIPTION_COST_NOT_FOUND' using errcode = 'P0002';
  end if;

  update system.subscription_costs
  set payer_account_id = p_payer_account_id,
      source_account_id = p_source_account_id,
      payer_attribution_status = case when p_payer_account_id is null then 'unassigned' else 'verified' end,
      updated_at = now()
  where id = p_subscription_cost_id;

  v_kind := case when p_payer_account_id is null then 'owner_cleared' else 'owner_assigned' end;
  insert into system.subscription_attribution_events (
    subscription_cost_id, actor_user_id, event_kind,
    previous_payer_account_id, payer_account_id,
    previous_source_account_id, source_account_id, verification_reference
  ) values (
    p_subscription_cost_id, p_actor_user_id, v_kind,
    v_before.payer_account_id, p_payer_account_id,
    v_before.source_account_id, p_source_account_id, btrim(p_verification_reference)
  );
end
$function$;

alter function system.assign_subscription_cost_accounts(uuid, uuid, uuid, uuid, text) owner to postgres;
revoke all on function system.assign_subscription_cost_accounts(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function system.assign_subscription_cost_accounts(uuid, uuid, uuid, uuid, text) to service_role;

create or replace function system.upsert_provider_invoice_cost(
  p_provider_invoice_key text,
  p_service_name text,
  p_amount numeric,
  p_currency text,
  p_billing_cycle text,
  p_payer_account_id uuid,
  p_source_reference text,
  p_observed_at timestamptz,
  p_sanitized_attributes jsonb
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, system
as $function$
declare
  v_cost_id uuid;
begin
  if nullif(btrim(p_provider_invoice_key), '') is null
     or nullif(btrim(p_service_name), '') is null
     or nullif(btrim(p_source_reference), '') is null
     or p_amount is null or p_amount < 0 then
    raise exception 'PROVIDER_INVOICE_INPUT_INVALID' using errcode = '22023';
  end if;
  if not exists (
    select 1 from system.responsibility_accounts a
    where a.id = p_payer_account_id and a.provider_code = 'digitalocean'
      and a.account_kind = 'provider_account'
  ) then
    raise exception 'PROVIDER_BILLING_ACCOUNT_NOT_REGISTERED' using errcode = '22023';
  end if;

  insert into system.subscription_costs as current_cost (
    provider_invoice_key, provider_code, service_name, cost_kind,
    amount, currency, billing_cycle, service_status,
    payer_account_id, payer_attribution_status, last_source_event_ref, last_evidence_at
  ) values (
    btrim(p_provider_invoice_key), 'digitalocean', btrim(p_service_name), 'provider_invoice',
    p_amount, coalesce(nullif(upper(btrim(p_currency)), ''), 'USD'), p_billing_cycle, 'active',
    p_payer_account_id, 'unassigned', btrim(p_source_reference), coalesce(p_observed_at, now())
  )
  on conflict (provider_invoice_key) do update
    set service_name = excluded.service_name,
        amount = excluded.amount,
        currency = excluded.currency,
        billing_cycle = excluded.billing_cycle,
        payer_account_id = coalesce(current_cost.payer_account_id, excluded.payer_account_id),
        payer_attribution_status = case
          when exists (
            select 1 from system.responsibility_accounts a
            where a.id = coalesce(current_cost.payer_account_id, excluded.payer_account_id)
              and a.attribution_status = 'verified'
          ) then 'verified'
          else current_cost.payer_attribution_status
        end,
        last_source_event_ref = excluded.last_source_event_ref,
        last_evidence_at = excluded.last_evidence_at,
        updated_at = now()
  returning id into v_cost_id;

  insert into system.subscription_evidence (
    subscription_cost_id, source_account_id, source_kind, source_reference,
    parser_confidence, observed_at, sanitized_attributes
  ) values (
    v_cost_id, p_payer_account_id, 'provider_invoice', btrim(p_source_reference),
    'not_applicable', coalesce(p_observed_at, now()), coalesce(p_sanitized_attributes, '{}'::jsonb)
  ) on conflict (subscription_cost_id, source_kind, source_reference) do nothing;

  return v_cost_id;
end
$function$;

alter function system.upsert_provider_invoice_cost(text, text, numeric, text, text, uuid, text, timestamptz, jsonb) owner to postgres;
revoke all on function system.upsert_provider_invoice_cost(text, text, numeric, text, text, uuid, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function system.upsert_provider_invoice_cost(text, text, numeric, text, text, uuid, text, timestamptz, jsonb) to service_role;

create or replace function system.register_subscription_cost(
  p_provider_code text,
  p_service_name text,
  p_cost_kind text,
  p_amount numeric,
  p_currency text,
  p_billing_cycle text,
  p_source_kind text,
  p_source_reference text,
  p_actor_user_id uuid
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, system
as $function$
declare
  v_cost_id uuid;
begin
  if p_actor_user_id is null or not exists (
    select 1 from public.profiles p
    where p.id = p_actor_user_id and p.role::text in ('super_admin', 'admin')
  ) then
    raise exception 'SUBSCRIPTION_REGISTRATION_ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if nullif(btrim(p_provider_code), '') is null
     or nullif(btrim(p_service_name), '') is null
     or p_cost_kind not in ('provider_invoice', 'manual_contract', 'usage_billing')
     or p_source_kind not in ('provider_invoice', 'manual_record', 'provider_api')
     or nullif(btrim(p_source_reference), '') is null
     or (p_amount is not null and p_amount < 0) then
    raise exception 'SUBSCRIPTION_REGISTRATION_INPUT_INVALID' using errcode = '22023';
  end if;

  insert into system.subscription_costs (
    provider_code, service_name, cost_kind, amount, currency, billing_cycle,
    service_status, payer_attribution_status, last_source_event_ref, last_evidence_at
  ) values (
    lower(btrim(p_provider_code)), btrim(p_service_name), p_cost_kind, p_amount,
    coalesce(nullif(upper(btrim(p_currency)), ''), 'THB'), p_billing_cycle,
    'unknown', 'unassigned', btrim(p_source_reference), now()
  ) returning id into v_cost_id;

  insert into system.subscription_evidence (
    subscription_cost_id, source_kind, source_reference, recorded_by_user_id,
    parser_confidence, observed_at, sanitized_attributes
  ) values (
    v_cost_id, p_source_kind, btrim(p_source_reference), p_actor_user_id,
    'not_applicable', now(), jsonb_build_object(
      'provider', lower(btrim(p_provider_code)),
      'service_name', btrim(p_service_name),
      'amount', p_amount,
      'currency', coalesce(nullif(upper(btrim(p_currency)), ''), 'THB'),
      'billing_cycle', p_billing_cycle
    )
  );
  return v_cost_id;
end
$function$;

alter function system.register_subscription_cost(text, text, text, numeric, text, text, text, text, uuid) owner to postgres;
revoke all on function system.register_subscription_cost(text, text, text, numeric, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function system.register_subscription_cost(text, text, text, numeric, text, text, text, text, uuid) to service_role;

-- Preserve legacy observations and their source references while deliberately
-- leaving mailbox and payer ownership unassigned pending human verification.
insert into system.subscription_costs (
  legacy_subscription_service_id, provider_code, service_name, cost_kind,
  amount, currency, billing_cycle, service_status, last_source_event_ref, last_evidence_at
)
select s.id, coalesce(nullif(s.provider, ''), 'unknown'), s.service_name,
       'email_observation', s.amount, coalesce(s.currency, 'THB'), s.billing_cycle,
       coalesce(s.status, 'unknown'), s.email_source, s.updated_at
from public.subscription_services s
on conflict (legacy_subscription_service_id) do nothing;

insert into system.subscription_evidence (
  subscription_cost_id, source_kind, source_reference, parser_confidence,
  observed_at, sanitized_attributes
)
select c.id,
       case when s.email_source is null then 'manual_record' else 'gmail_message' end,
       coalesce(nullif(s.email_source, ''), 'subscription_services:' || s.id::text),
       case when s.confidence in ('high', 'medium', 'low') then s.confidence else 'not_applicable' end,
       s.updated_at,
       jsonb_strip_nulls(jsonb_build_object(
         'legacy_subscription_service_id', s.id,
         'provider', s.provider,
         'service_name', s.service_name,
         'amount', s.amount,
         'currency', s.currency,
         'billing_cycle', s.billing_cycle,
         'source_confidence', s.confidence,
         'invoice_reference', s.last_invoice
       ))
from public.subscription_services s
join system.subscription_costs c on c.legacy_subscription_service_id = s.id
on conflict (source_kind, source_reference) do nothing;

comment on table system.responsibility_accounts is
  'Provider/mailbox/service accounts and their verified responsible owner. Owner remains unassigned until evidence is reviewed; no credentials are stored here.';
comment on table system.subscription_costs is
  'System/provider subscription costs, distinct from tenant company expenses. Legacy Gmail observations are backfilled with payer_attribution_status=unassigned.';
comment on table system.subscription_evidence is
  'Append-only sanitized provenance for subscription cost observations; excludes email body and credentials.';
comment on table system.subscription_attribution_events is
  'Append-only history of human attribution decisions for payer and source mailbox.';
comment on table system.responsibility_account_events is
  'Append-only history of verified provider, mailbox, platform, user, organization, or company account ownership.';

commit;
