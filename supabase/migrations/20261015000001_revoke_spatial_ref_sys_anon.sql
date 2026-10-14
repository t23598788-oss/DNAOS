-- BOM-070 TASK-2 SECURITY HARDENING (owner directive 2026-10-15) — NOT APPLIED to production yet
-- ห้ามรันบน Production ก่อนได้รับอนุมัติ (สถานะ: ทดสอบแล้วบนฐานทดสอบ local — ดูรายงาน)
--
-- หลักฐานจริงบน Production (PostgREST probe, 2026-10-15):
--  - anon GET /rest/v1/spatial_ref_sys → 200 (อ่านได้จริง)
--  - anon POST probe → SQLSTATE 23514 (check constraint) = สิทธิ์ INSERT ของ anon มีจริง,
--    RLS ปิดจริง (ตารางเป็นของ Extension PostGIS ที่ถูก CREATE EXTENSION โดย
--    migration 20260620000000_clearinghouse_upgrade.sql)
--
-- ผลการทดสอบบนฐานทดสอบ (PostGIS 3.6.4, PostgreSQL 18.4 — dnaos_priv_test_20261015):
--  1) REVOKE ALL (รวม SELECT) จาก authenticated ทำให้ ST_Distance บน geography ตายทันที:
--     ERROR 42501 permission denied for table spatial_ref_sys ที่ CONTEXT
--     "SELECT 1 FROM public.spatial_ref_sys LIMIT 1" — PostGIS อ่านตารางนี้ตอน
--     คำนวณ SRS ภายใต้สิทธิ์ผู้เรียก ⇒ SELECT ต้องคงไว้ของ role ที่รัน PostGIS
--  2) PUBLIC=SELECT มาจากตัวติดตั้ง PostGIS — anon อ่านผ่าน PUBLIC ในทุกกรณี
--  3) ช่องโหว่จริงที่ยืนยัน = เขียน (INSERT ถึง check constraint) ⇒ ปิดเฉพาะเขียน
--
-- ข้อจำกัดตามคำสั่ง owner 2026-10-15: ห้ามเปิด RLS · ห้าม DROP ตาราง · ห้ามเปลี่ยนเจ้าของ Extension
-- คงค่าที่ระบบ GPS อ่าน SRID ได้ตามข้อ 2.3 ของคำสั่ง

-- ⚠ บันทึกตามคำสั่ง owner (ข้อ 2.6): การจำกัดสิทธิ์เขียนนี้ "ไม่ได้" ทำให้คำเตือน
-- "RLS Disabled in Public" ของ Supabase linter หายไปโดยอัตโนมัติ — เจตนาตามคำสั่ง:
-- ยังไม่เปิด RLS เพราะระบบ GPS พึ่ง SELECT ของตาราง extension นี้ (ดูหลักฐานข้างบน)
-- การตรวจความปลอดภัยจริงให้ดูที่ has_table_privilege/การยิง REST write probe หลัง apply

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.spatial_ref_sys FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.spatial_ref_sys FROM authenticated;

-- คง SELECT ให้ role ที่รัน SQL ผ่าน PostGIS (geography เช็ค SRID ของ caller)
-- และคง PUBLIC=SELECT ตามที่ตัวติดตั้ง PostGIS กำหนด (อ่าน EPSG สาธารณะ — ไม่ใช่ข้อมูลลับ)
-- anon/authenticated จึงเหลือเฉพาะการอ่าน ไม่มีทางเขียนอีกต่อไป
GRANT SELECT ON TABLE public.spatial_ref_sys TO authenticated;

-- service_role / เจ้าของตาราง: ไม่ถูกแตะ (สิทธิ์เต็มเท่าเดิม)
