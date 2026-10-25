-- ROLLBACK of 20261018000003_tenant_org_binding_v3.sql (2026-10-18)
--
-- V3 = organization_id (nullable additive) + index + SELECT policy บน 6 ตาราง:
--   bank_statement_transactions · bank_notifications · storage_evidence
--   file_snapshots · transactions · resource_transactions
--
-- หลักการ: ถอย policy/index ได้ทันที · คอลัมน์ organization_id เก็บไว้เป็นค่าเริ่มต้น
-- (ถ้า ingestion เริ่ม stamp ค่าไปแล้ว การ DROP คอลัมน์ = ทำลาย mapping จริง) —
-- เปิดใช้บรรทัดที่ comment ไว้เฉพาะเมื่อสำรองข้อมูลและยืนยันแล้วเท่านั้น
--
-- ใช้เมื่อ: ต้องถอย GAP_ORG_MAPPING binding ก่อน V2/V1 (ลำดับ V3 → V2 → V1)
-- ไม่แตะข้อมูลแถวใด (policy/index ไม่ลบข้อมูล)

-- ─── 1. policies ───
drop policy if exists tenant_org_binding_select on public.bank_statement_transactions;
drop policy if exists tenant_org_binding_select on public.bank_notifications;
drop policy if exists tenant_org_binding_select on public.storage_evidence;
drop policy if exists tenant_org_binding_select on public.file_snapshots;
drop policy if exists tenant_org_binding_select on public.transactions;
drop policy if exists tenant_org_binding_select on public.resource_transactions;

-- ─── 2. indexes ───
drop index if exists public.bank_statement_transactions_org_idx;
drop index if exists public.bank_notifications_org_idx;
drop index if exists public.storage_evidence_org_idx;
drop index if exists public.file_snapshots_org_idx;
drop index if exists public.transactions_org_idx;
drop index if exists public.resource_transactions_org_idx;

-- ─── 3. columns (เก็บไว้ก่อน — เปิดใช้เมื่อยืนยันว่าไม่ต้องเก็บ mapping) ───
-- alter table public.bank_statement_transactions drop column if exists organization_id;
-- alter table public.bank_notifications        drop column if exists organization_id;
-- alter table public.storage_evidence          drop column if exists organization_id;
-- alter table public.file_snapshots            drop column if exists organization_id;
-- alter table public.transactions              drop column if exists organization_id;
-- alter table public.resource_transactions     drop column if exists organization_id;

-- ─── 4. ระบุใน registry หลังถอย ───
-- registry/TENANT_DATA_COVERAGE.json ต้องถูกปรับสถานะ 3 กลุ่มนี้กลับเป็น GAP_ORG_MAPPING
