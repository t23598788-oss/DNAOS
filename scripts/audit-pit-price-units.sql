-- ═══════════════════════════════════════════════════════════════════════════
-- AUDIT: pit_materials.price — per-row unit verification (SELECT-ONLY)
-- Owner directive (2026-10-13, FIX MATERIAL PRICE MIGRATION):
--   ตรวจหน่วยเดิมของ pit_materials.price ทีละรายการ + ห้ามแปลงราคาจริงบน
--   Production — report only. รันบนฐานทดสอบ (ไม่ใช่ Production).
--
-- HOW TO DETERMINE UNIT WITHOUT AN "unit" COLUMN:
-- pit_materials has no unit column (see full_schema.sql:1347-1355).
-- pit_price_requests has reply_text only (no unit column either — migration
-- 20260724000001). REAL evidence we have:
--   (a) pit_price_requests.reply_text — if the vendor wrote "คิว"/"ตัน" in
--       the reply, that's the exact unit of that price
--   (b) pit_price_requests.reply_price — the number the vendor actually gave
--       (matches pit_materials.price stored when replied)
--   (c) cutover timeline — before 2026-07-26 the RFQ asked "ราคาต่อคิว",
--       after 2026-10-12 it asks "ราคาต่อตัน"; the grey zone between needs
--       per-row evidence (reply_text wording)
--   (d) PHYSICS sanity — real bulk material prices: เหล็ก > 8,000 ฿/ตัน,
--       ทราย/หิน/ดิน 250–3,500 ฿/ตัน. If a price looks like a per-คิว
--       figure, it's a mismatch to flag, not to convert blindly.
-- ═══════════════════════════════════════════════════════════════════════════

-- A) Every priced pit_material row + its most-recent answered RFQ evidence
select
  pm.id                              as pit_material_id,
  mt.id                              as material_type_id,
  mt.name                            as material_name,
  p.pit_name                         as pit_name,
  pm.price                           as current_price,
  pm.created_at                      as price_set_at,
  ppr.reply_text                     as vendor_reply_evidence,
  ppr.reply_price                    as vendor_reply_numeric,
  ppr.replied_at                     as vendor_replied_at,
  case
    when ppr.reply_text ilike '%ตัน%' then     'ตัน (vendor reply confirms)'
    when ppr.reply_text ilike '%คิว%' then     'คิว (vendor reply confirms)'
    when ppr.reply_text is not null and
         ppr.reply_text !~ '[ก-ฮ]' then       'NONE (reply has no unit wording — cannot classify)'
    when pm.created_at >= '2026-10-12' then   'ตัน (created after ton-cutover RFQ)'
    when pm.created_at <  '2026-07-26' then   'คิว (created before ton-standardization)'
    else                                       'UNKNOWN — needs human check (grey zone 2026-07-26…2026-10-12)'
  end                                as unit_class
from public.pit_materials pm
join public.material_types mt on mt.id  = pm.material_type_id
join public.pit_profiles  p   on p.id   = pm.pit_profile_id
left join lateral (
  select * from public.pit_price_requests r
  where r.pit_profile_id  = pm.pit_profile_id
    and r.material_type_id = pm.material_type_id
    and r.status = 'answered'
  order by r.replied_at desc nulls last
  limit 1
) ppr on true
where pm.deleted_at is null
  and pm.price is not null
order by unit_class, p.pit_name, mt.name;

-- B) PHYSICS sanity — likely mislabeled rows
--    (ราคาที่เกินช่วงจริงของวัสดุชนิดนั้น, จะถือเป็นหลักฐานไม่ถูกหน่วย)
select
  pm.id as pit_material_id, mt.name as material_name, p.pit_name,
  pm.price,
  case
    when mt.density_ton_per_cbm is null then
      '❌ NO DENSITY — cannot convert (directive §5)'
    when pm.price < 100 then
      '⚠️ suspiciously LOW for ตัน — check คิว label'
    when mt.density_ton_per_cbm >= 2.4 and pm.price < 2000 then
      '⚠️ heavy material priced low — possible คิว mixup'
    when mt.density_ton_per_cbm <= 1.4 and pm.price > 4500 then
      '⚠️ light material priced high — possible ตัน mixup'
    else 'plausible range'
  end as sanity_class
from public.pit_materials pm
join public.material_types mt on mt.id = pm.material_type_id
join public.pit_profiles  p   on p.id  = pm.pit_profile_id
where pm.deleted_at is null
order by pm.price;

-- C) vehicle_types.load_capacity per row — ตันจริงทุกประเภท (directive §6)
--    Owner spec sheet baseline: รถ 6 ล้อ≈5 ตัน, 10 ล้อ≈9 ตัน, รถพ่วง=30 ตัน
select
  vt.id, vt.name, vt.load_capacity, vt.fuel_consumption_rate, vt.deleted_at,
  case
    when vt.load_capacity is null          then '⚠️ NULL capacity — cannot compute trips'
    when vt.load_capacity between 2 and 35 then 'plausible ตัน range (bulk road truck)'
    when vt.load_capacity > 35             then '⚠️ >35 ตัน — verify (unlikely for road truck)'
    when vt.load_capacity < 2              then '⚠️ <2 ตัน — pickup / รถเล็ก หรือคิว mislabeled'
  end as capacity_class
from public.vehicle_types vt
where vt.deleted_at is null
order by vt.load_capacity desc nulls last;

-- D) material_types.density evidence — rows missing density are hard-blocked
select
  mt.id, mt.name, mt.density_ton_per_cbm,
  case
    when mt.density_ton_per_cbm is null            then '❌ NO DENSITY'
    when mt.density_ton_per_cbm between 0.3 and 8  then 'plausible (validateDensity bounds)'
    else '⚠️ out-of-range density'
  end as density_class
from public.material_types mt
where mt.deleted_at is null
order by mt.name;
