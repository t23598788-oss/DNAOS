-- ROLLBACK of 20261018000002_tenant_org_scope_v2.sql (2026-10-18)
--
-- V2 เป็น SELECT-scope policy + helper function ล้วน (ไม่มีคอลัมน์ใหม่) → ถอยได้
-- ครบถ้วนโดย DROP สิ่งที่ V2 สร้าง แล้วคืน policy companies ของ V1 กลับมา
--
-- ใช้เมื่อ: ถอยหลัง V3 แล้ว และต้องคืนสถานะอ่านข้อมูลเดิม (production เดิมเห็นด้วย
-- service-role/admin เท่านั้นเหมือนก่อน apply)
-- ไม่แตะข้อมูลใด ๆ (policy ไม่มีผลกับแถว · DROP policy ไม่ลบข้อมูล)

-- ─── 1. policy ที่ V2 สร้างบนตารางธุรกิจ (ชื่อซ้ำกันหลายตาราง — DROP ต่อตาราง) ───
drop policy if exists tenant_company_scope_select on public.invoices;
drop policy if exists tenant_company_scope_select on public.debt_events;
drop policy if exists tenant_company_scope_select on public.debt_snapshots;
drop policy if exists tenant_company_scope_select on public.customer_orders;
drop policy if exists tenant_company_scope_select on public.customer_sites;
drop policy if exists tenant_company_scope_select on public.document_groups;
drop policy if exists tenant_company_scope_select on public.partner_payable_requests;
drop policy if exists tenant_company_scope_select on public.connect_external_identities;
drop policy if exists tenant_scope_select on public.payment_allocations;
drop policy if exists tenant_scope_select on public.document_versions;
drop policy if exists tenant_line_scope_select on public.receipt_documents;
drop policy if exists tenant_line_scope_select on public.conversation_states;
drop policy if exists tenant_line_scope_select on public.line_customer_memory;

-- ─── 2. คืน policy companies ของ V1 (เดิม: "organization_id is null or member") ───
--  ค่าเดิมตาม 20261018000001_tenant_core_v1.sql ทุกบรรทัด
drop policy if exists companies_select_member_only on public.companies;
create policy companies_select_member_only
  on public.companies for select
  using (
    organization_id is null
    or exists (
      select 1 from public.org_members m
      where m.organization_id = companies.organization_id and m.user_id = auth.uid()
    )
  );

-- ─── 3. indexes ที่ V2 เพิ่ม (additive · ลบได้ไม่มีผลกับข้อมูล) ───
drop index if exists public.invoices_customer_company_idx;
drop index if exists public.debt_events_customer_company_idx;
drop index if exists public.debt_snapshots_customer_company_idx;
drop index if exists public.customer_orders_customer_idx;
drop index if exists public.customer_sites_customer_idx;
drop index if exists public.document_groups_customer_idx;
drop index if exists public.partner_payable_partner_idx;
drop index if exists public.connect_ext_identities_company_idx;
drop index if exists public.payment_allocations_invoice_idx;
drop index if exists public.payment_allocations_debt_event_idx;
drop index if exists public.document_versions_invoice_idx;
drop index if exists public.company_line_links_company_idx;
drop index if exists public.line_events_line_user_idx;

-- ─── 4. helper functions ของ V2 (ไม่มีผู้เรียกเหลือหลัง DROP policies) ───
drop function if exists public.tenant_has_membership(uuid);
drop function if exists public.tenant_org_of_line_user(text);
