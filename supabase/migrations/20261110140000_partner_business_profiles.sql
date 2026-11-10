-- PARTNER BUSINESS PROFILES (bridge) — 2026-11-10
-- Bridge table connecting pit_profiles (80 supply-side partners in Heia's
-- network) to: business type (facility_types), product categories they sell
-- (material_types via pit_materials), cost prices (pit_materials.price),
-- readiness status and contact channel. Lets the central brain filter partners
-- by business group instantly when an order for sand/stone/concrete comes in.
--
-- Safe to re-run: all objects are `if not exists` and seeds use
-- `on conflict do nothing`.

-- ── 1. Bridge table ─────────────────────────────────────────────────────────
create table if not exists public.partner_business_profiles (
  id                      uuid primary key default gen_random_uuid(),
  -- one profile per pit/partner (the supply-side entity)
  pit_profile_id          uuid not null unique
                            references public.pit_profiles (id)
                            on update cascade on delete cascade,
  -- quick business-type label (mirrors facility_types; denormalized code for
  -- fast filtering without a join)
  facility_type_id        uuid
                            references public.facility_types (id)
                            on update cascade on delete set null,
  business_category       text,
  -- capabilities: what this partner can do / sells, e.g.
  --   ["sell_sand","sell_gravel","transport","concrete","wholesale"]
  capabilities            jsonb not null default '[]'::jsonb,
  -- material types this partner supplies (uuid[] into material_types)
  sells_material_type_ids uuid[] not null default '{}',
  -- optional network role (ROLE_SUPPLIER_SAND, ROLE_TRANSPORTER, ...)
  role_code               text
                            references public.role_definitions (code)
                            on update cascade on delete set null,
  -- optional bridge to the finance side (companies) if this pit belongs to one
  company_id              uuid
                            references public.companies (id)
                            on update cascade on delete set null,
  -- readiness for dispatch
  readiness_status        text not null default 'PENDING'
                            check (readiness_status in ('READY','PENDING','INACTIVE','SUSPENDED')),
  -- contact channel used by the dispatcher
  contact_channel         text not null default 'NONE'
                            check (contact_channel in ('LINE','PHONE','EMAIL','MANUAL','NONE')),
  contact_value           text,
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists idx_pbp_facility_type
  on public.partner_business_profiles (facility_type_id);
create index if not exists idx_pbp_business_category
  on public.partner_business_profiles (business_category);
create index if not exists idx_pbp_role_code
  on public.partner_business_profiles (role_code);
create index if not exists idx_pbp_readiness
  on public.partner_business_profiles (readiness_status);
create index if not exists idx_pbp_capabilities
  on public.partner_business_profiles using gin (capabilities);

-- ── 2. Seed one row per pit_profile (idempotent) ────────────────────────────
insert into public.partner_business_profiles
  (pit_profile_id, facility_type_id, business_category,
   sells_material_type_ids, contact_channel, contact_value, readiness_status, notes)
select
  pp.id,
  pp.facility_type_id,
  ft.code,
  coalesce(pm.material_ids, '{}')::uuid[],
  case
    when pp.line_user_id is not null then 'LINE'
    when pp.phone is not null then 'PHONE'
    else 'NONE'
  end,
  coalesce(pp.line_user_id, pp.phone),
  case
    when pp.deleted_at is not null then 'INACTIVE'
    when pp.is_open is true
         and pp.facility_type_id is not null
         and (pp.taxpayer_id is not null or pp.line_user_id is not null) then 'READY'
    else 'PENDING'
  end,
  'auto-seeded from pit_profiles'
from public.pit_profiles pp
left join public.facility_types ft on ft.id = pp.facility_type_id
left join (
  select pit_profile_id, array_agg(distinct material_type_id) as material_ids
  from public.pit_materials
  where deleted_at is null
  group by pit_profile_id
) pm on pm.pit_profile_id = pp.id
on conflict (pit_profile_id) do nothing;

-- ── 3. Convenience view: partner + business profile + cost prices ───────────
create or replace view public.v_partner_material_prices as
select
  pbp.id            as business_profile_id,
  pbp.pit_profile_id,
  pp.pit_name,
  pp.latitude,
  pp.longitude,
  pp.is_open,
  ft.code            as facility_type_code,
  ft.name_th         as facility_type_name_th,
  pbp.business_category,
  pbp.capabilities,
  pbp.readiness_status,
  pbp.contact_channel,
  pbp.contact_value,
  pm.id              as pit_material_id,
  mt.id              as material_type_id,
  mt.name            as material_name,
  pm.price           as cost_price_per_unit,
  pm.deleted_at      as price_deleted_at
from public.partner_business_profiles pbp
join public.pit_profiles pp on pp.id = pbp.pit_profile_id
left join public.facility_types ft on ft.id = pbp.facility_type_id
left join public.pit_materials pm on pm.pit_profile_id = pp.id and pm.deleted_at is null
left join public.material_types mt on mt.id = pm.material_type_id;

-- ── 4. Access control ───────────────────────────────────────────────────────
alter table public.partner_business_profiles enable row level security;

comment on table public.partner_business_profiles is
  'Bridge: pit_profile (supply partner) -> business type, capabilities, sold materials, cost prices, readiness and contact channel. Feeds the central brain partner routing.';
comment on view public.v_partner_material_prices is
  'Partner + business profile + pit_materials cost prices joined for pricing/margin calc.';
