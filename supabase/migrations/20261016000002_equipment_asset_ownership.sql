-- ASSET OWNERSHIP (owner directive 2026-10-15, WORKSTREAM 2)
-- หลักฐานจาก schema จริง (Audit 2026-10-15): equipment_assets เดิมมีแค่
--   asset_code/name/sim/imei/box_password/current_status/total_engine_hours
--   — ไม่มีความสัมพันธ์เจ้าของใด ๆ · driver_equipment_permissions ผูกที่ "คนขับ"
--   ไม่ใช่เจ้าของ — เทียบโจทย์: ผู้ลงทะเบียนต้องจัดการเฉพาะทรัพย์ที่ตนมีสิทธิ์
-- ไม่สร้างระบบรถ/เครื่องจักรซ้ำ — เติมความสัมพันธ์บนตารางเดิมเท่านั้น
ALTER TABLE public.equipment_assets
    ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES public.profiles(id),
    ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id),
    -- สมรรถนะที่เจ้าของยืนยัน (ข้อหาอตมงานขนส่ง — มีหลักฐานจากผู้จดทะเบียน)
    ADD COLUMN IF NOT EXISTS capacity_value NUMERIC,
    ADD COLUMN IF NOT EXISTS capacity_unit VARCHAR,
    -- อยู่สู่ระบบ.kown: สถานะ "พร้อมรับงาน" บานงานทันที (เดิมมีแค่ current_status)
    ADD COLUMN IF NOT EXISTS available_for_dispatch BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS owner_verified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_equipment_assets_owner
    ON public.equipment_assets (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_equipment_assets_company
    ON public.equipment_assets (company_id);
