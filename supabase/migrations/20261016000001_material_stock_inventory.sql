-- RESOURCE INVENTORY (owner directive 2026-10-15, WORKSTREAM 1) — เติมเฉพาะที่
-- schema เดิมขาดจริง: ยอดสรุปสต็อกบนรายการวัสดุรายบ่อ
--
-- หลักฐาน schema จริง (Audit 2026-10-15):
--   · pit_materials เดิมมีแค่ price (ราคา) — ไม่มียอดสต็อก/จำนวนรับ-จ่าย/จองเลย
--   · resource_transactions เดิมเป็นตาราง generic (resource_type/unit/quantity/
--     meta JSONB + source_event_id unique idempotency + RLS service-only) —
--     ใช้เป็นแหล่ง "ประวัติการเคลื่อนไหว" ได้จริง => ห้ามสร้างตารางซ้ำ — ไม่สร้าง
--   · Canonical writer ห้ามเขียนยอดสองเส้น: engines/canonical/stock-write.ts
--     เป็นเส้นเดียวที่เขียนยอด (ตารางนี้) + ประวัติ (resource_transactions)
--
-- ปริมาณยอดเป็นผลของการเคลื่อนไหวเสมอ (ไม่รับป้อนตรงจากผู้ใช้นอก writer)
ALTER TABLE public.pit_materials
    ADD COLUMN IF NOT EXISTS stock_quantity NUMERIC NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS reserved_quantity NUMERIC NOT NULL DEFAULT 0,
    -- หน่วยนับของยอด ณ ปัจจุบัน (หลักฐานจาก movement แรกที่ลงทะเบียน — ไม่มีการเดา)
    ADD COLUMN IF NOT EXISTS stock_unit VARCHAR,
    ADD COLUMN IF NOT EXISTS stock_updated_at TIMESTAMPTZ;

-- การประเมินความพร้อมจำหน่าย = คอลัมน์ขยาย (generated) — อ่านจากเส้นเดียวเท่านั้น
-- (stock_quantity - reserved_quantity) · คีย์เดิมคงเดิมทุกอย่าง
