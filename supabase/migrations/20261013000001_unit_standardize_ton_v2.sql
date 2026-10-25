-- ═══════════════════════════════════════════════════════════════════════════
-- MATERIAL UNIT STANDARDIZATION (v2 — CORRECTED)
-- Owner directive (2026-10-13, FIX MATERIAL PRICE MIGRATION) — supersedes the
-- original 20261012000001_unit_standardize_ton.sql which is NEVER APPLIED:
--   ❌ OLD bug: converted with `price × density` — WRONG DIRECTION. The old
--      formula treated pit_materials.price as a per-TON price and multiplied
--      UP — backwards from what owner directive ข้อ 4 says:
--         price_per_ton = price_per_cbm / density_ton_per_cbm
--      Example: ทรายหยาบ 300 ฿/คิว ÷ 1.45 ตัน/คิว = 206.9 ฿/ตัน. The old
--      migration would have produced 435 ฿ — a 2× overstatement.
--   ✅ v2 rules (directive ข้อ 3/4/5):
--        3. confirmed ตัน rows  → keep as-is (no touch)
--        4. confirmed คิว rows  → price = price / density (evidence-bearing)
--        5. unknown-unit rows   → NO conversion (no guessing, ever)
--   ✅ STALE migration removed (directive ข้อ 1 — old one never applied):
--        unapplied transactions are never carried forward; this replaces it
--        and explicitly deletes its file-name from the registry-free queue
--        (see companion step at end of this file).
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── STEP 1: evidence table (same contract as v1, plus unit_evidence source) ─
create table if not exists public.pit_material_price_conversions (
  id                    uuid default gen_random_uuid() primary key,
  pit_material_id       uuid not null references public.pit_materials(id),
  material_type_id      uuid not null references public.material_types(id),
  density_ton_per_cbm   numeric not null,
  original_price        numeric not null,
  original_unit         text not null default 'คิว',
  converted_price       numeric not null,
  converted_unit        text not null default 'ตัน',
  unit_evidence         text not null,        -- NEW: why we classified คิว
  converted_at          timestamptz default now() not null,
  conversion_formula    text not null default 'price_per_ton = price_per_cbm / density_ton_per_cbm (directive 2026-10-13 §4)',
  source_of_evidence    text not null default 'pit_price_requests.reply_text + created_at cutover (audit-pit-price-units.sql §A) + material_types.density (migration 20260726000002)'
);

alter table public.pit_material_price_conversions enable row level security;
create policy admin_read on public.pit_material_price_conversions
  for select to authenticated using (true);
create policy service_role_full on public.pit_material_price_conversions
  for all to service_role using (true) with check (true);

-- ── STEP 2: convert ONLY confirmed-คิว rows (÷ density, not ×) ──────────────
-- Unit classification (per audit-pit-price-units.sql §A):
--   คิว = reply_text contains "คิว" (vendor-replied per-คิว)
--         OR row created before the 2026-07-26 RFQ-cutover and no reply_text.
--   ตัน = reply_text contains "ตัน" OR created after cutover.
--   UNKNOWN (no evidence at all) → never converted (directive ข้อ 5).
--
-- Idempotency: skipping any row with an existing pit_material_price_conversions
-- entry guarantees a re-run converts nothing twice.

insert into public.pit_material_price_conversions
  (pit_material_id, material_type_id, density_ton_per_cbm,
   original_price, converted_price, unit_evidence, converted_at)
select
  pm.id,
  pm.material_type_id,
  mt.density_ton_per_cbm,
  pm.price,
  round((pm.price / mt.density_ton_per_cbm)::numeric, 2),  -- ✅ ÷ per directive
  case
    when ppr.reply_text ilike '%คิว%' then
      'vendor_reply_confirmed_cbm: "' || left(ppr.reply_text, 120) || '"'
    else
      'created_before_cutover: ' || pm.created_at::date::text || ' (RFQ asked คิว then)'
  end,
  now()
from public.pit_materials pm
join public.material_types mt on mt.id = pm.material_type_id
left join lateral (
  select * from public.pit_price_requests r
  where r.pit_profile_id = pm.pit_profile_id
    and r.material_type_id = pm.material_type_id
    and r.status = 'answered'
  order by r.replied_at desc nulls last
  limit 1
) ppr on true
where pm.deleted_at is null
  and pm.price is not null
  and mt.density_ton_per_cbm is not null          -- no density ⇒ no conversion
  and (
        ppr.reply_text ilike '%คิว%'              -- strongest vendor evidence
        or (
             ppr.reply_text is null
             and pm.created_at < '2026-07-26'::timestamptz
           )
      )
  and not exists (                                 -- idempotent
        select 1 from public.pit_material_price_conversions pc
        where pc.pit_material_id = pm.id
      );

-- ── STEP 3: apply the converted price back to pit_materials.price ──────────
update public.pit_materials pm
set price      = pc.converted_price,
    updated_at = now()
from public.pit_material_price_conversions pc
where pc.pit_material_id = pm.id
  and pm.deleted_at is null;

-- ── STEP 4: drop the STALE v1 migration file (never applied) ────────────────
-- Directive ข้อ 1: "ห้าม APPLY Migration ปัจจุบัน" — v1 (×-direction) was
-- wrong; we don't apply it. supabase migration tracking shows it as pending
-- only — no DB row to delete, so the file itself must be removed from the
-- repo to keep `supabase db push` from applying it later by accident.
-- This is a FILE-LEVEL cleanup, executed outside SQL (see report step 5).

commit;
