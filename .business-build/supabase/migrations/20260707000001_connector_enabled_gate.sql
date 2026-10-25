-- Connector Enable Gate — เพิ่มขั้นตอนที่ 4 ของ lifecycle
--
-- Connect → Register → Test → Enable
--
-- Test ผ่าน (status = 'connected') ไม่ได้แปลว่า Core ใช้งานได้ทันที
-- ต้องมีคนกด Enable อีกขั้นหนึ่งก่อน — ป้องกัน connector ที่เพิ่งทดสอบผ่าน
-- แต่ยังไม่ผ่านการตรวจสอบจากมนุษย์ ไม่ให้ระบบเรียกใช้เองเงียบๆ

ALTER TABLE public.connectors ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_connectors_enabled ON public.connectors(enabled) WHERE enabled = true;
