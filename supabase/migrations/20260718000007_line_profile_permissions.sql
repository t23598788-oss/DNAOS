-- Contact Settings — Permissions (owner, 2026-07-18)
--
-- Extends the already-existing line_profiles table (no new table, per owner
-- instruction "ไม่ต้องแก้โครงสร้างฐานข้อมูลในรอบนี้...เหลือเพียง UI") with a
-- single jsonb column rather than one boolean column per permission — the
-- owner's own spec lists this as an open-ended, growing menu ("รองรับจำนวน
-- ตัวเลือกจำนวนมากโดยไม่รก", "รองรับการเพิ่มหมวดในอนาคต"), so a fixed set of
-- boolean columns would need a new migration for every future permission;
-- jsonb lets the Contact Settings popup add new keys without schema churn.

alter table public.line_profiles
  add column if not exists permissions jsonb not null default '{}'::jsonb;

comment on column public.line_profiles.permissions is
  'Per-contact permission flags, e.g. {"approve_document": true, "approve_finance": false, "receive_po": true, "receive_invoice": true, "receive_payment": true} — keys are open-ended (Contact Settings popup categories), not a fixed enum, since the owner''s own design expects this to grow over time.';
