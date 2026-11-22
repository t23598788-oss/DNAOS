-- Narrow authorization hardening using existing organization/company relations.
-- No new tables or backfills: records without a provable tenant link remain
-- unreadable to authenticated users until their references are reconciled.

-- Personal provider credentials remain in user_provider_connections and are
-- scoped by owner_user_id in the existing account routes. They do not grant
-- organization membership or business-data access.

-- payment_orders has no enforced FK to customer_orders in the current schema.
-- Do not infer tenant ownership from order_no or transaction_id text. Keep it
-- server-only until a verified reference is introduced through a reviewed delta.
alter table public.payment_orders enable row level security;
revoke all on table public.payment_orders from public, anon, authenticated;
grant all on table public.payment_orders to service_role;

-- document_versions already scopes invoice-backed versions to the invoice's
-- customer company. Add the equivalent organization check for standalone docs.
drop policy if exists document_versions_standalone_tenant_select
  on public.document_versions;
create policy document_versions_standalone_tenant_select
  on public.document_versions for select to authenticated using (
    standalone_document_id is not null and exists (
      select 1
        from public.standalone_documents d
        join public.companies c
          on c.id = d.customer_company_id or c.id = d.partner_company_id
       where d.id = document_versions.standalone_document_id
         and c.organization_id is not null
         and public.tenant_has_membership(c.organization_id)
    )
  );

-- Artifact metadata (including storage path) follows the tenant scope of its
-- parent document. Object access still requires the existing signed-URL path.
drop policy if exists document_artifacts_business_scope_select
  on public.document_artifacts;
create policy document_artifacts_business_scope_select
  on public.document_artifacts for select to authenticated using (
    exists (
      select 1
        from public.document_versions v
        join public.invoices i on i.id = v.invoice_id
        join public.companies c on c.id = i.customer_company_id
       where v.id = document_artifacts.document_version_id
         and c.organization_id is not null
         and public.tenant_has_membership(c.organization_id)
    )
    or exists (
      select 1
        from public.document_versions v
        join public.standalone_documents d on d.id = v.standalone_document_id
        join public.companies c
          on c.id = d.customer_company_id or c.id = d.partner_company_id
       where v.id = document_artifacts.document_version_id
         and c.organization_id is not null
         and public.tenant_has_membership(c.organization_id)
    )
  );
