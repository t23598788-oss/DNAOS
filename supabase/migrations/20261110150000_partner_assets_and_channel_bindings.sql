-- PARTNER ASSETS & CHANNEL BINDINGS — 2026-11-10
-- Extends the partner network model with:
--   1. partner_assets            : physical assets owned/operated by a partner
--                                  (material pit, logistics fleet, heavy equipment)
--   2. partner_collaborations    : who can work with whom (in-house fleet vs external)
--   3. partner_channel_bindings  : auto-learned identity from chat channels
--                                  (LINE userId, FB sender id, phone, ...)
--   4. views + helper function for asset dispatch routing
--
-- Safe to re-run: all objects are `if not exists` and seeds use
-- `on conflict do nothing`.

-- ── 1. Asset type catalog (reference values) ────────────────────────────────
-- asset_type allowed values:
--   MATERIAL_PIT      = บ่อ/โรงโม่/แหล่งวัสดุ (sand, stone, soil, concrete plant)
--   LOGISTICS_FLEET   = รถขนส่ง (6/10 ล้อ, พ่วง, 6 ล้อช่วงยาว)
--   HEAVY_EQUIPMENT   = เครื่องจักร (แม็คโคร, แบ็คโคร, รถเครน, รถขุด)
create table if not exists public.partner_assets (
  id                          uuid primary key default gen_random_uuid(),
  -- owner of the asset (the partner business profile)
  owner_partner_profile_id    uuid not null
                                references public.partner_business_profiles (id)
                                on update cascade on delete cascade,
  -- where the asset is normally stationed (may differ from owner for shared assets)
  stationed_at_partner_profile_id uuid
                                references public.partner_business_profiles (id)
                                on update cascade on delete set null,
  asset_type                  text not null
                                check (asset_type in ('MATERIAL_PIT','LOGISTICS_FLEET','HEAVY_EQUIPMENT')),
  name                        text not null,
  -- capacity
  capacity_qty                numeric,
  capacity_unit               text
                                check (capacity_unit in ('TON','CBM','TRIP','HOUR',null)),
  -- availability
  availability_status         text not null default 'AVAILABLE'
                                check (availability_status in ('AVAILABLE','BUSY','MAINTENANCE','RETIRED','UNKNOWN')),
  in_house                    boolean not null default true,
  -- service zone for dispatch routing
  service_zone                text,
  base_lat                    numeric,
  base_lng                    numeric,
  -- links to existing operational tables (optional, for traceability)
  linked_vehicle_type_id      uuid
                                references public.vehicle_types (id)
                                on update cascade on delete set null,
  linked_truck_id             uuid,            -- reserved: trucks.id (no FK to avoid type mismatch)
  linked_equipment_id         uuid,            -- reserved: equipment_assets.id
  linked_pit_profile_id       uuid
                                references public.pit_profiles (id)
                                on update cascade on delete set null,
  -- dispatch hints
  auto_dispatch_enabled       boolean not null default true,
  dispatch_priority           integer not null default 100,
  notes                       text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index if not exists idx_pa_owner
  on public.partner_assets (owner_partner_profile_id);
create index if not exists idx_pa_type
  on public.partner_assets (asset_type);
create index if not exists idx_pa_availability
  on public.partner_assets (availability_status);
create index if not exists idx_pa_zone
  on public.partner_assets (service_zone);
create index if not exists idx_pa_stationed
  on public.partner_assets (stationed_at_partner_profile_id);

-- ── 2. Collaborations: who can work with whom ───────────────────────────────
-- relation_type:
--   OWNS          : asset belongs to this partner (in-house)
--   SHARES        : partner lends/shares an asset to another partner
--   RELIES_ON     : partner depends on another partner for this capability
--   SERVES_ZONE   : partner serves a geographic zone (logistics)
create table if not exists public.partner_collaborations (
  id                        uuid primary key default gen_random_uuid(),
  source_partner_profile_id uuid not null
                              references public.partner_business_profiles (id)
                              on update cascade on delete cascade,
  target_partner_profile_id uuid not null
                              references public.partner_business_profiles (id)
                              on update cascade on delete cascade,
  relation_type             text not null
                              check (relation_type in ('OWNS','SHARES','RELIES_ON','SERVES_ZONE','SUBCONTRACTS')),
  capability                text,            -- e.g. 'LOGISTICS_FLEET', 'HEAVY_EQUIPMENT'
  zone                      text,
  active                    boolean not null default true,
  notes                     text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  check (source_partner_profile_id <> target_partner_profile_id)
);

create index if not exists idx_pc_source
  on public.partner_collaborations (source_partner_profile_id);
create index if not exists idx_pc_target
  on public.partner_collaborations (target_partner_profile_id);
create index if not exists idx_pc_type
  on public.partner_collaborations (relation_type);

-- ── 3. Channel bindings: auto-learned identity from chat ───────────────────
create table if not exists public.partner_channel_bindings (
  id                          uuid primary key default gen_random_uuid(),
  partner_business_profile_id uuid
                              references public.partner_business_profiles (id)
                              on update cascade on delete set null,
  channel_type                text not null
                              check (channel_type in ('LINE','FACEBOOK','WHATSAPP','TELEGRAM','PHONE','EMAIL','MANUAL')),
  channel_user_id             text not null,
  display_name                text,
  is_primary                  boolean not null default false,
  verified                    boolean not null default false,
  confidence                  numeric not null default 0.5
                              check (confidence >= 0 and confidence <= 1),
  source                      text not null default 'AUTO_LEARNED'
                              check (source in ('AUTO_LEARNED','MANUAL','IMPORTED','VERIFIED')),
  first_seen_at               timestamptz not null default now(),
  last_seen_at                timestamptz not null default now(),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (channel_type, channel_user_id)
);

create index if not exists idx_pcb_partner
  on public.partner_channel_bindings (partner_business_profile_id);
create index if not exists idx_pcb_channel
  on public.partner_channel_bindings (channel_type, channel_user_id);

-- ── 4. Helper: resolve or create a channel binding (auto-learn) ─────────────
-- Returns the binding id. If a binding for (channel_type, channel_user_id)
-- already exists, touches last_seen_at and returns it. Otherwise creates a new
-- (unverified) binding with partner null — caller may attach a partner later.
create or replace function public.resolve_or_create_channel_binding(
  p_channel_type   text,
  p_channel_user_id text,
  p_display_name   text default null
) returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  if p_channel_type is null or p_channel_user_id is null then
    return null;
  end if;

  select id into v_id
  from public.partner_channel_bindings
  where channel_type = p_channel_type
    and channel_user_id = p_channel_user_id;

  if v_id is not null then
    update public.partner_channel_bindings
       set last_seen_at = now(),
           display_name = coalesce(display_name, p_display_name)
     where id = v_id;
    return v_id;
  end if;

  insert into public.partner_channel_bindings
    (channel_type, channel_user_id, display_name, source, verified, confidence)
  values
    (p_channel_type, p_channel_user_id, p_display_name, 'AUTO_LEARNED', false, 0.5)
  on conflict (channel_type, channel_user_id) do update
    set last_seen_at = now(),
        display_name = coalesce(partner_channel_bindings.display_name, excluded.display_name)
  returning id into v_id;

  return v_id;
end;
$$;

-- ── 5. Dispatcher routing views ─────────────────────────────────────────────
-- Available assets by type/zone for the dispatcher to pick from.
create or replace view public.v_available_assets as
select
  pa.id                as asset_id,
  pa.asset_type,
  pa.name,
  pa.capacity_qty,
  pa.capacity_unit,
  pa.availability_status,
  pa.in_house,
  pa.service_zone,
  pa.base_lat,
  pa.base_lng,
  pa.auto_dispatch_enabled,
  pa.dispatch_priority,
  pbp.id               as owner_partner_profile_id,
  pp.pit_name          as owner_name,
  pp.latitude          as owner_lat,
  pp.longitude         as owner_lng,
  vt.name              as vehicle_type_name,
  vt.load_capacity     as vehicle_load_capacity_tons
from public.partner_assets pa
join public.partner_business_profiles pbp on pbp.id = pa.owner_partner_profile_id
join public.pit_profiles pp on pp.id = pbp.pit_profile_id
left join public.vehicle_types vt on vt.id = pa.linked_vehicle_type_id
where pa.availability_status = 'AVAILABLE'
  and pa.auto_dispatch_enabled = true;

-- In-house vs external fleet summary per pit partner (for "มีรถประจำคอก หรือต้องพึ่งรถนอก")
create or replace view public.v_partner_fleet_summary as
select
  pbp.id                                    as partner_profile_id,
  pp.pit_name,
  count(*) filter (where pa.asset_type='LOGISTICS_FLEET' and pa.in_house) as in_house_trucks,
  count(*) filter (where pa.asset_type='LOGISTICS_FLEET' and not pa.in_house) as external_trucks,
  count(*) filter (where pa.asset_type='HEAVY_EQUIPMENT') as heavy_equipment,
  count(*) filter (where pa.asset_type='MATERIAL_PIT') as material_pits,
  coalesce(sum(pa.capacity_qty) filter (where pa.asset_type='LOGISTICS_FLEET' and pa.in_house),0) as in_house_capacity,
  case
    when count(*) filter (where pa.asset_type='LOGISTICS_FLEET' and pa.in_house) > 0
      then 'HAS_IN_HOUSE_FLEET'
    else 'NEEDS_EXTERNAL_FLEET'
  end as fleet_mode
from public.partner_business_profiles pbp
join public.pit_profiles pp on pp.id = pbp.pit_profile_id
left join public.partner_assets pa on pa.owner_partner_profile_id = pbp.id
group by pbp.id, pp.pit_name;

-- ── 6. Access control ───────────────────────────────────────────────────────
alter table public.partner_assets            enable row level security;
alter table public.partner_collaborations    enable row level security;
alter table public.partner_channel_bindings  enable row level security;

-- ── 7. Seed: material-pit assets for profiles that already have a facility_type
insert into public.partner_assets
  (owner_partner_profile_id, asset_type, name, capacity_unit,
   availability_status, in_house, linked_pit_profile_id, notes)
select
  pbp.id,
  'MATERIAL_PIT',
  coalesce(pp.pit_name, 'บ่อ/แหล่งวัสดุ'),
  'CBM',
  case when pp.is_open is true then 'AVAILABLE' else 'UNKNOWN' end,
  true,
  pp.id,
  'auto-seeded from pit_profiles.facility_type'
from public.partner_business_profiles pbp
join public.pit_profiles pp on pp.id = pbp.pit_profile_id
where pbp.facility_type_id is not null
on conflict do nothing;

-- Seed channel bindings from existing master data (LINE / phone)
insert into public.partner_channel_bindings
  (partner_business_profile_id, channel_type, channel_user_id, display_name, source, verified, confidence)
select pbp.id, 'LINE', pp.line_user_id, pp.pit_name, 'IMPORTED', false, 0.7
from public.partner_business_profiles pbp
join public.pit_profiles pp on pp.id = pbp.pit_profile_id
where pp.line_user_id is not null
on conflict (channel_type, channel_user_id) do nothing;

insert into public.partner_channel_bindings
  (partner_business_profile_id, channel_type, channel_user_id, display_name, source, verified, confidence)
select pbp.id, 'PHONE', pp.phone, pp.pit_name, 'IMPORTED', false, 0.6
from public.partner_business_profiles pbp
join public.pit_profiles pp on pp.id = pbp.pit_profile_id
where pp.phone is not null
on conflict (channel_type, channel_user_id) do nothing;

comment on table public.partner_assets is
  'Physical assets owned/operated by a partner: material pits, logistics fleet, heavy equipment. Feeds asset dispatch routing.';
comment on table public.partner_collaborations is
  'Partner-to-partner capability links (in-house fleet, shared fleet, reliance, subcontract).';
comment on table public.partner_channel_bindings is
  'Auto-learned identity bindings from chat channels (LINE/FB/phone) to partner_business_profiles.';
comment on function public.resolve_or_create_channel_binding(text,text,text) is
  'Auto-learn a channel identity on first contact; returns binding id.';
