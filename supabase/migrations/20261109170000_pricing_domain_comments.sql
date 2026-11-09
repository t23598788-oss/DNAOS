-- Pricing doctrine (owner decision, 2026-11-09): pit_materials.price is the
-- PARTNER'S BASE PRICE — what the partner must receive. It is NOT DNA OS's
-- cost. DNA OS does not buy the goods; it adds a 25% Platform Commission on
-- top of that base price per partner contract. See docs/PRICING_DOMAIN.md.
--
-- Metadata only: no data changes, no column changes. COMMENT ON is
-- idempotent (re-running replaces the comment text), so this file is safe to
-- re-apply. Old migrations are deliberately not edited — this is the
-- registry/replay-safe way to attach meaning to an existing column.

comment on column public.pit_materials.price is
  'ราคาฐานของพาร์ตเนอร์ (partner base price) หน่วยบาท/ตัน ยังไม่รวมขนส่ง
   DNA OS บวก Platform Commission 25% ตามสัญญา — ดู docs/PRICING_DOMAIN.md';

comment on table public.pit_materials is
  'ราคาที่พาร์ตเนอร์ตั้งเอง DNA OS ไม่ได้เป็นเจ้าของราคานี้';
