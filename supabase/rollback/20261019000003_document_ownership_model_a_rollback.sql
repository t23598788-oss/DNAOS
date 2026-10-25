-- ROLLBACK of 20261019000003_document_ownership_model_a.sql (2026-10-19)
--
-- Returns document access to the pre-model state: V2's counterparty-side policy
-- on invoices (which is itself the leak this model closes) and no recipient
-- grants. Policies carry no rows, so no document data is changed.
--
-- The grants table is DROPPED: it is created empty by the forward migration and
-- holds no business data at rollback time. If grants were created after apply,
-- that is real business data — dump the table first (see runbook).

-- ─── invoices: restore V2 counterparty-side rule ───
drop policy if exists invoices_issuer_or_recipient_select on public.invoices;
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

-- ─── standalone_documents: remove the pair ───
drop policy if exists standalone_documents_issuer_or_recipient_select on public.standalone_documents;

-- ─── receipt_documents / company_expenses: restore the V2 shape ───
drop policy if exists company_expenses_owner_select on public.company_expenses;
drop policy if exists receipt_documents_owner_select on public.receipt_documents;
create policy tenant_line_scope_select
  on public.receipt_documents for select to authenticated
  using (
    exists (
      select 1 from public.line_events le
      where le.id = receipt_documents.line_event_id
        and public.tenant_has_membership(public.tenant_org_of_line_user(le.line_user_id))
    )
  );

drop function if exists public.tenant_owns_receipt(uuid);

-- ─── grants table + policies + helpers ───
drop policy if exists document_grants_select on public.document_recipient_grants;
drop policy if exists document_grants_insert_issuer_only on public.document_recipient_grants;
drop policy if exists document_grants_delete_issuer_only on public.document_recipient_grants;
drop table if exists public.document_recipient_grants;

drop function if exists public.tenant_is_invoice_issuer(uuid);
drop function if exists public.tenant_is_invoice_recipient(uuid);
drop function if exists public.tenant_is_standalone_issuer(uuid);
drop function if exists public.tenant_is_standalone_recipient(uuid);

-- NOTE: the additive columns from 20261019000002 stay (they are that file's
-- rollback scope, not this one).
