-- TENANT ORG SCOPE V2 (additive · 2026-10-18 · owner mission SOFTWARE PLATFORM — MULTI-TENANT COMPLETION)
--
-- ต่อจาก 20261018000001_tenant_core_v1.sql (organizations + org_members + companies.organization_id)
-- กฎอ่านข้อมูลเดิมก่อนพัฒนา — ความหมายของข้อมูลที่ "ตรวจแล้ว" ไม่ใช่เดา:
--   1. organizations = tenant root ของซอฟต์แวร์ · companies = business entity "ภายใน"
--      องค์กรหนึ่ง (หนึ่งองค์กรมีได้หลาย companies) → company_id ไม่ใช่ organization_id
--      แต่ ownership ของแถวธุรกิจที่แขวนกับ company = ผ่าน companies.organization_id (join)
--   2. แถวที่ organization_id ยังไม่ถูก map (production ของเดิมทั้งหมด) = ยังอยู่ในโมเดล
--      service-role/admin เดิมเท่านั้น — policy ใหม่ไม่เปิดแถวที่ไม่ map (fail-closed,
--      ไม่เปลี่ยนพฤติกรรมข้อมูล production ณ วัน apply)
--   3. write boundary ยังคุมด้วย service-key + canonical writer hooks (orgScope) —
--      migration นี้เปิดเฉพาะ SELECT แบบ member-scoped ให้ session จริง
--   4. ห้าม seed องค์กร/ข้อมูลจริงใด ๆ (ตามภารกิจ Layer 2)
--
-- MATRIX ทดสอบ: scripts/tenant-matrix-test.ts (ฐานข้อมูลทดสอบจริง รวม RLS + API)

-- ─── 1. helpers (decision จุดเดียวที่ SQL ใช้ — nested-membership ทำใน function เดียว) ───
create or replace function public.tenant_has_membership(org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.org_members
    where user_id = auth.uid()
      and organization_id = org
  );
$$;

revoke all on function public.tenant_has_membership(uuid) from anon, public;
grant execute on function public.tenant_has_membership(uuid) to authenticated;

-- line identity → องค์กรเจ้าของ: อ่าน company_line_links/companies ผ่าน SECURITY DEFINER
-- เพราะ company_line_links เปิด RLS fail-closed ของตัวเอง (subquery ใน policy ของผู้ใช้
-- ปกติจะเห็น 0 แถว) — definer นี้คืน "เฉพาะ organization id" ไม่เปิดแถวข้อมูลใดให้ session
create or replace function public.tenant_org_of_line_user(line_user text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select cmp.organization_id
  from public.company_line_links cll
  join public.companies cmp on cmp.id = cll.company_id
  where cll.line_user_id = line_user
    and cmp.organization_id is not null
  limit 1;
$$;

revoke all on function public.tenant_org_of_line_user(text) from anon, public;
grant execute on function public.tenant_org_of_line_user(text) to authenticated;

-- ─── 2. แก้ policy companies ของ V1: เดิม "organization_id is null or member" =
--         ผู้ใช้ที่ login แล้วเห็น companies ของ"ทุกคนที่ยังไม่ map" — เป็น cross-tenant
--         read leak เมื่อหลายองค์กรเริ่มใช้ → ทำให้เข้มเป็น member-only-when-mapped ───
drop policy if exists companies_select_member_only on public.companies;
create policy companies_select_member_only
  on public.companies for select
  to authenticated
  using (
    organization_id is not null
    and public.tenant_has_membership(organization_id)
  );

-- ─── 3. company-scoped business tables (ownership = customer/partner company → org) ───
-- invoices (จาก full_schema: customer_company_id not null)
create policy tenant_company_scope_select
  on public.invoices for select to authenticated
  using (
    exists (
      select 1 from public.companies cmp
      where cmp.id = invoices.customer_company_id
        and cmp.organization_id is not null
        and public.tenant_has_membership(cmp.organization_id)
    )
  );

-- debt_events / debt_snapshots (customer_company_id)
create policy tenant_company_scope_select
  on public.debt_events for select to authenticated
  using (
    exists (
      select 1 from public.companies cmp
      where cmp.id = debt_events.customer_company_id
        and cmp.organization_id is not null
        and public.tenant_has_membership(cmp.organization_id)
    )
  );
create policy tenant_company_scope_select
  on public.debt_snapshots for select to authenticated
  using (
    exists (
      select 1 from public.companies cmp
      where cmp.id = debt_snapshots.customer_company_id
        and cmp.organization_id is not null
        and public.tenant_has_membership(cmp.organization_id)
    )
  );

-- orders / deliveries layer (customer_orders, customer_sites, document_groups)
create policy tenant_company_scope_select
  on public.customer_orders for select to authenticated
  using (
    exists (
      select 1 from public.companies cmp
      where cmp.id = customer_orders.customer_company_id
        and cmp.organization_id is not null
        and public.tenant_has_membership(cmp.organization_id)
    )
  );
create policy tenant_company_scope_select
  on public.customer_sites for select to authenticated
  using (
    exists (
      select 1 from public.companies cmp
      where cmp.id = customer_sites.customer_company_id
        and cmp.organization_id is not null
        and public.tenant_has_membership(cmp.organization_id)
    )
  );
create policy tenant_company_scope_select
  on public.document_groups for select to authenticated
  using (
    exists (
      select 1 from public.companies cmp
      where cmp.id = document_groups.customer_company_id
        and cmp.organization_id is not null
        and public.tenant_has_membership(cmp.organization_id)
    )
  );

-- partner layer (partner_payable_requests.partner_company_id)
create policy tenant_company_scope_select
  on public.partner_payable_requests for select to authenticated
  using (
    exists (
      select 1 from public.companies cmp
      where cmp.id = partner_payable_requests.partner_company_id
        and cmp.organization_id is not null
        and public.tenant_has_membership(cmp.organization_id)
    )
  );

-- provider identity per org (connect_external_identities.company_id — คอลัมน์เดิม ไม่เพิ่ม)
create policy tenant_company_scope_select
  on public.connect_external_identities for select to authenticated
  using (
    exists (
      select 1 from public.companies cmp
      where cmp.id = connect_external_identities.company_id
        and cmp.organization_id is not null
        and public.tenant_has_membership(cmp.organization_id)
    )
  );

-- ─── 4. canonical documents — polymorphic targets ทางเดียวที่มีในคอลัมน์จริง ───
-- payment_allocations: invoice_id / debt_event_id (standalone path = ยังไม่ map org → gap)
create policy tenant_scope_select
  on public.payment_allocations for select to authenticated
  using (
    exists (
      select 1 from public.invoices inv
      join public.companies cmp on cmp.id = inv.customer_company_id
      where inv.id = payment_allocations.invoice_id
        and cmp.organization_id is not null
        and public.tenant_has_membership(cmp.organization_id)
    )
    or exists (
      select 1 from public.debt_events de
      join public.companies cmp on cmp.id = de.customer_company_id
      where de.id = payment_allocations.debt_event_id
        and cmp.organization_id is not null
        and public.tenant_has_membership(cmp.organization_id)
    )
  );

-- document_versions: invoice_id path (standalone_document_id = gap ตาม registry)
create policy tenant_scope_select
  on public.document_versions for select to authenticated
  using (
    exists (
      select 1 from public.invoices inv
      join public.companies cmp on cmp.id = inv.customer_company_id
      where inv.id = document_versions.invoice_id
        and cmp.organization_id is not null
        and public.tenant_has_membership(cmp.organization_id)
    )
  );

-- ─── 5. line-scoped business data (line_user_id → company_line_links → companies → org) ───
-- receipt_documents = สลิป/เอกสารจาก LINE (line_event_id → line_events.line_user_id)
create policy tenant_line_scope_select
  on public.receipt_documents for select to authenticated
  using (
    exists (
      select 1 from public.line_events le
      where le.id = receipt_documents.line_event_id
        and public.tenant_has_membership(public.tenant_org_of_line_user(le.line_user_id))
    )
  );

create policy tenant_line_scope_select
  on public.conversation_states for select to authenticated
  using (
    public.tenant_has_membership(public.tenant_org_of_line_user(conversation_states.line_user_id))
  );

create policy tenant_line_scope_select
  on public.line_customer_memory for select to authenticated
  using (
    public.tenant_has_membership(public.tenant_org_of_line_user(line_customer_memory.line_user_id))
  );

-- ─── 6. indexes ที่ policies join ใช้ (if not exists — additive) ───
create index if not exists invoices_customer_company_idx       on public.invoices (customer_company_id);
create index if not exists debt_events_customer_company_idx    on public.debt_events (customer_company_id);
create index if not exists debt_snapshots_customer_company_idx on public.debt_snapshots (customer_company_id);
create index if not exists customer_orders_customer_idx        on public.customer_orders (customer_company_id);
create index if not exists customer_sites_customer_idx         on public.customer_sites (customer_company_id);
create index if not exists document_groups_customer_idx        on public.document_groups (customer_company_id);
create index if not exists partner_payable_partner_idx         on public.partner_payable_requests (partner_company_id);
create index if not exists connect_ext_identities_company_idx  on public.connect_external_identities (company_id);
create index if not exists payment_allocations_invoice_idx     on public.payment_allocations (invoice_id);
create index if not exists payment_allocations_debt_event_idx  on public.payment_allocations (debt_event_id);
create index if not exists document_versions_invoice_idx       on public.document_versions (invoice_id);
create index if not exists company_line_links_company_idx      on public.company_line_links (company_id);
create index if not exists line_events_line_user_idx           on public.line_events (line_user_id);
