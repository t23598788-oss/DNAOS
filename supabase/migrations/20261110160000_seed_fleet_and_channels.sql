-- SEED FLEET & CHANNELS — 2026-11-10
-- 1. External transporter partners (ตระการ, พี่หนุ่ม, รถเนียม, 6 ล้อยาว) as pit_profiles
--    + partner_business_profiles.
-- 2. In-house fleet for บ่อทรายท่าพระ (10 รถพ่วง) + heavy equipment (แม็คโคร).
-- 3. External fleet pool (4 x 6 ล้อ).
-- 4. Channel bindings (placeholder LINE IDs pending real values).
--
-- Safe to re-run: uses ON CONFLICT / WHERE NOT EXISTS guards.

-- ── 1. Create pit_profiles for external transporters ────────────────────────
insert into public.pit_profiles
  (id, pit_name, entity_type, owner_type, is_open, registered_name, phone, latitude, longitude)
select gen_random_uuid(), * from (values
  ('ตระการ (รถ 6 ล้อ)', 'INDIVIDUAL', 'LINE_OWNER', true, 'ตระการ', NULL::text, NULL::numeric, NULL::numeric),
  ('พี่หนุ่ม (รถ 6 ล้อ)', 'INDIVIDUAL', 'LINE_OWNER', true, 'พี่หนุ่ม', NULL::text, NULL::numeric, NULL::numeric),
  ('รถเนียม (รถ 6 ล้อ)', 'INDIVIDUAL', 'LINE_OWNER', true, 'รถเนียม', NULL::text, NULL::numeric, NULL::numeric),
  ('6 ล้อยาว (รถ 6 ล้อช่วงยาว)', 'INDIVIDUAL', 'LINE_OWNER', true, '6 ล้อยาว', NULL::text, NULL::numeric, NULL::numeric)
) as v(pit_name, entity_type, owner_type, is_open, registered_name, phone, latitude, longitude)
where not exists (select 1 from public.pit_profiles pp where pp.pit_name = v.pit_name);

-- ── 2. Create partner_business_profiles for external transporters ───────────
insert into public.partner_business_profiles
  (pit_profile_id, business_category, capabilities, readiness_status, contact_channel, contact_value, notes)
select pp.id, 'LOGISTICS', '["transport"]'::jsonb, 'PENDING', 'NONE', NULL, 'external transporter — pending LINE ID'
from public.pit_profiles pp
where pp.pit_name in ('ตระการ (รถ 6 ล้อ)','พี่หนุ่ม (รถ 6 ล้อ)','รถเนียม (รถ 6 ล้อ)','6 ล้อยาว (รถ 6 ล้อช่วงยาว)')
  and not exists (select 1 from public.partner_business_profiles pbp where pbp.pit_profile_id = pp.id);

-- ── 3. In-house fleet: 10 รถพ่วง for บ่อทรายท่าพระ ────────────────────────
do $$
declare
  v_owner uuid;
  v_vt uuid := '224cbe2a-44a8-435c-8be9-6bebbffa79bd'; -- รถพ่วง
  v_pit uuid := '83f06958-ff2e-4b0e-a4a7-ba886a456555'; -- บ่อทรายท่าพระ
  v_ppb uuid;
  i int;
begin
  select id into v_ppb from public.partner_business_profiles where pit_profile_id = v_pit;
  if v_ppb is null then
    insert into public.partner_business_profiles (pit_profile_id, business_category, capabilities, readiness_status, contact_channel, notes)
    values (v_pit, 'SAND_PIT', '["sell_sand","transport"]'::jsonb, 'READY', 'PHONE', 'in-house fleet owner')
    returning id into v_ppb;
  end if;
  for i in 1..10 loop
    insert into public.partner_assets
      (owner_partner_profile_id, asset_type, name, capacity_qty, capacity_unit,
       availability_status, in_house, linked_vehicle_type_id, linked_pit_profile_id, service_zone, notes)
    select v_ppb, 'LOGISTICS_FLEET', 'รถพ่วง #' || i, 30, 'TON', 'AVAILABLE', true, v_vt, v_pit, 'ขอนแก่น', 'in-house fleet บ่อทรายท่าพระ'
    where not exists (select 1 from public.partner_assets pa where pa.owner_partner_profile_id=v_ppb and pa.name='รถพ่วง #'||i);
  end loop;
end $$;

-- ── 4. Heavy equipment (แม็คโคร) attached to บ่อทรายท่าพระ ─────────────────
do $$
declare
  v_ppb uuid;
begin
  select id into v_ppb from public.partner_business_profiles where pit_profile_id = '83f06958-ff2e-4b0e-a4a7-ba886a456555';
  if v_ppb is not null then
    insert into public.partner_assets
      (owner_partner_profile_id, asset_type, name, capacity_qty, capacity_unit, availability_status, in_house, linked_vehicle_type_id, service_zone, notes)
    values
      (v_ppb, 'HEAVY_EQUIPMENT', 'รถแม็คโคร SY 215c', 1, 'HOUR', 'AVAILABLE', true, 'd7feec24-1ab7-46df-a489-01204c75ae96', 'ขอนแก่น', 'heavy equipment สำหรับงานหน้างาน'),
      (v_ppb, 'HEAVY_EQUIPMENT', 'รถแม็คโคร Cash 320', 0.95, 'HOUR', 'AVAILABLE', true, 'a388ee7a-7c3c-4dfc-9dc9-1623ab877277', 'ขอนแก่น', 'heavy equipment สำหรับงานหน้างาน')
    on conflict do nothing;
  end if;
end $$;

-- ── 5. External fleet pool: 6 ล้อ 4 ราย ─────────────────────────────────────
do $$
declare
  rec record;
  v_ppb uuid;
  v_vt uuid;
  v_name text;
begin
  for rec in
    select pp.id as pit_id, pp.pit_name from public.pit_profiles pp
    where pp.pit_name in ('ตระการ (รถ 6 ล้อ)','พี่หนุ่ม (รถ 6 ล้อ)','รถเนียม (รถ 6 ล้อ)')
  loop
    select id into v_ppb from public.partner_business_profiles where pit_profile_id = rec.pit_id;
    v_vt := 'cc111747-9741-4346-9d0e-63a4a3101988'; -- รถ 6 ล้อ
    v_name := replace(rec.pit_name, ' (รถ 6 ล้อ)', '');
    insert into public.partner_assets
      (owner_partner_profile_id, asset_type, name, capacity_qty, capacity_unit, availability_status, in_house, linked_vehicle_type_id, service_zone, notes)
    values (v_ppb, 'LOGISTICS_FLEET', v_name || ' - รถ 6 ล้อ #1', 5, 'TON', 'AVAILABLE', false, v_vt, 'ขอนแก่น', 'external fleet pool')
    on conflict do nothing;
  end loop;

  -- 6 ล้อยาว → รถ 6 ล้อช่วงยาว
  select pbp.id into v_ppb from public.partner_business_profiles pbp join public.pit_profiles pp on pp.id=pbp.pit_profile_id where pp.pit_name='6 ล้อยาว (รถ 6 ล้อช่วงยาว)';
  if v_ppb is not null then
    insert into public.partner_assets
      (owner_partner_profile_id, asset_type, name, capacity_qty, capacity_unit, availability_status, in_house, linked_vehicle_type_id, service_zone, notes)
    values (v_ppb, 'LOGISTICS_FLEET', '6 ล้อยาว - รถ 6 ล้อช่วงยาว #1', 5.5, 'TON', 'AVAILABLE', false, 'ec2ae4a4-b7f0-446f-ae76-077392ee645e', 'ขอนแก่น', 'external fleet pool')
    on conflict do nothing;
  end if;
end $$;

-- ── 6. Channel bindings (placeholder LINE IDs pending real values) ──────────
insert into public.partner_channel_bindings
  (partner_business_profile_id, channel_type, channel_user_id, display_name, source, verified, confidence)
select pbp.id, 'LINE', 'PENDING_LINE_ID_' || replace(pp.pit_name, ' ', '_'), pp.pit_name, 'MANUAL', false, 0.3
from public.partner_business_profiles pbp
join public.pit_profiles pp on pp.id = pbp.pit_profile_id
where pp.pit_name in ('บ่อทรายท่าพระ','ตระการ (รถ 6 ล้อ)','พี่หนุ่ม (รถ 6 ล้อ)','รถเนียม (รถ 6 ล้อ)','6 ล้อยาว (รถ 6 ล้อช่วงยาว)')
on conflict (channel_type, channel_user_id) do nothing;

comment on table public.partner_channel_bindings is
  'Auto-learned identity bindings from chat channels (LINE/FB/phone) to partner_business_profiles. channel_user_id may be placeholder PENDING_LINE_ID_* until real LINE ID is provided.';
