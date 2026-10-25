-- ROLLBACK of 20261018000001_tenant_core_v1.sql (2026-10-18)
--
-- หลักการ: additive → ถอยกลับได้โดยไม่ทำลายข้อมูล
--   · DROP policy/table ที่ migration นี้สร้างเท่านั้น
--   · companies.organization_id เป็นข้อมูลที่ admin อาจ map ไว้จริง — rollback นี้
--     "ไม่" DROP คอลัมน์โดยอัตโนมัติ (ให้ผู้ดำเนินการตัดสินใจหลังสำรองข้อมูลแล้ว)
--     มีคำสั่งที่ comment ไว้ให้ใช้เฉพาะเมื่อยืนยันว่าไม่ต้องเก็บ mapping
--
-- ใช้เมื่อ: ต้องถอย tenant core ออกก่อนที่ V2/V3 จะถูกถอย (ลำดับย้อนกลับ V3 → V2 → V1)
-- ไม่แตะ: canonical writers/gateways/document engine เดิม · ไม่ลบข้อมูล production

-- ─── policies (V1) ───
drop policy if exists organizations_select_member_only on public.organizations;
drop policy if exists organizations_insert_any_authed_creates_own on public.organizations;
drop policy if exists organizations_update_owner_or_admin on public.organizations;
drop policy if exists org_members_select_own_or_staff on public.org_members;
drop policy if exists org_members_insert_owner_or_admin on public.org_members;
drop policy if exists org_members_update_owner_only on public.org_members;
drop policy if exists org_members_delete_owner_or_admin on public.org_members;
drop policy if exists companies_select_member_only on public.companies;

-- ─── index ───
drop index if exists public.org_members_user_idx;
drop index if exists public.companies_organization_idx;

-- ─── tenant root tables ───
--  ข้อควรระวัง: ถ้ามีข้อมูลองค์กร/สมาชิกจริงในตารางนี้ ให้ใช้ DROP TABLE เฉพาะเมื่อ
--          สำรองข้อมูลแล้วเท่านั้น (ข้อมูลจะหายถาวร)
-- drop table if exists public.org_members;
-- drop table if exists public.organizations;

-- ─── companies.organization_id (เก็บไว้เป็นค่าเริ่มต้น — เปิดใช้เมื่อยืนยันแล้ว) ───
-- alter table public.companies drop column if exists organization_id;
