-- ============================================================================
-- Baseline: enum public."DocumentReferenceRelationType"
--
-- ปัญหา: enum นี้มีอยู่แต่ใน dump (full_schema.sql:239) ไม่เคยถูกสร้างใน
--        migrations เลย แต่ 20260922000001_canonical_foundation_v1_1.sql
--        ใช้มันเป็นชนิดของคอลัมน์:
--          · document_references.relation_type   (บรรทัด 156)
--          · inbound_source_links.relation_type  (บรรทัด 188, default 'SOURCE')
--        ทำให้ทั้งไฟล์ล้มด้วย type "public.DocumentReferenceRelationType"
--        does not exist → ตาราง document_references ไม่ถูกสร้าง
--        แล้ว 20260922000003_canonical_views_v1_1.sql (view document_references_inverse
--        ที่อ้าง enum นี้และอ่านจากตารางนั้น) ก็ล้มตามไปด้วย
--
-- หมายเหตุการแก้รายงานรอบก่อน: ตาราง document_references **ไม่ใช่** dump-only —
--        ตัว 20260922000001 สร้างมันเอง (`create table if not exists` บรรทัด 154)
--        ที่หายจริงมีเพียง enum ตัวนี้ตัวเดียว อีก 2 failure เป็นผลพวงทั้งหมด
--
-- ตำแหน่ง: ก่อน 20260922000001 (ผู้ใช้รายแรก) — enum ไม่มี dependency ใด ๆ
--
-- ค่าและลำดับคัดลอกจาก dump ตรงตัว:
--        SOURCE, PARENT, CHILD, GENERATED_FROM, PAID_BY, SETTLED_BY
--        (enum sort order มีความหมาย: view ใช้ case relation_type when 'PARENT' ...)
--
-- Idempotent: ถ้า enum มีอยู่แล้วจะข้าม (duplicate_object) ไม่สร้างซ้ำ ไม่แก้ค่า
-- ============================================================================

do $$
begin
  execute $ddl$
    create type public."DocumentReferenceRelationType" as enum (
      'SOURCE',
      'PARENT',
      'CHILD',
      'GENERATED_FROM',
      'PAID_BY',
      'SETTLED_BY'
    )
  $ddl$;
exception when duplicate_object then null;
end
$$;
