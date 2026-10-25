-- DOCUMENT OWNERSHIP — MODEL A (ISSUER-BOUND) — PROPOSAL ONLY
-- Owner mission 2026-10-19 · DO NOT APPLY TO PRODUCTION WITHOUT OWNER APPROVAL.
--
-- DECISION CONTEXT (synthetic simulation, scripts/document-ownership-simulation-test.ts):
--   A ISSUER-BOUND      satisfies all four access criteria  ← chosen
--   B ORG-BOUND         cannot express a buyer recipient (criterion 2 unmet)
--   C RECIPIENT-GRANTS  cannot express the issuer (criteria 1/4 unmet)
-- This file implements A. It requires 20261019000002 (additive columns) to be
-- applied first; it does not touch it.
--
-- MODEL (each concept stays separate — no conflation):
--   ISSUER / SELLER       invoices.issuer_company_id, standalone_documents.issuer_company_id
--                         (a company INSIDE the issuing organization)
--   DOCUMENT OWNER        the organization that owns the issuer company
--                         (companies.organization_id — the tenant operating the document)
--   BUYER / COUNTERPARTY  customer_company_id / partner_company_id — unchanged, never the owner
--   AUTHORIZED RECIPIENT   document_recipient_grants (explicit, per document, per company)
--
-- WHAT THIS FILE DOES
--   * creates document_recipient_grants (additive, empty, RLS enabled, no anon access);
--   * adds issuer-side and recipient-side SELECT policies on invoices / standalone_documents;
--   * replaces V2's buyer-side tenant_company_scope_select on invoices with the
--     issuer/recipient pair (V2 let ANY mapped buyer read by customer_company_id, which is
--     the counterparty, not the owner — that is the leak this model closes);
--   * membership/issuer/recipient decisions live in SECURITY DEFINER helpers, so no policy
--     selects the table it protects (same shape as 20261019000001);
--   * no DML, no backfill, no writer change, no service-role grant.
--
-- WHAT IT DELIBERATELY LEAVES OPEN (reported, not silently decided)
--   * SEMANTIC CHANGE REQUIRING OWNER SIGN-OFF: receipt_documents is currently scoped
--     by LINE identity (V2 tenant_line_scope_select → tenant_org_of_line_user). This file
--     replaces that with "owned by the organization of the receiving company"
--     (receipt_documents.customer_company_id) and scopes company_expenses through the same
--     real FK. That is what makes an operator's own expense ledger readable to its own
--     members, and it is strictly narrower for buyers (a receipt only ever maps to the
--     company that received it). It is still a behaviour change on a live policy and must
--     be approved explicitly, not shipped silently.
--   * company_expenses rows with no receipt_document_id stay invisible to sessions;
--     attributing those still needs an owner decision (no guessed backfill).
--   * legacy rows with a NULL issuer_company_id are readable by NOBODY. That is the
--     intended OWNERSHIP_UNKNOWN state (591 invoices at census time) — not a gap to paper
--     over with a guessed backfill.
--   * stamping issuer_company_id at write time belongs to engines/canonical/document-write.ts
--     and needs the caller's verified scope — a separate change, not made here.

-- ─── grants table (additive, empty) ───
create table if not exists public.document_recipient_grants (
  document_id          uuid not null,
  recipient_company_id uuid not null references public.companies(id) on delete cascade,
  granted_by           uuid references auth.users(id),
  granted_at           timestamptz not null default now(),
  primary key (document_id, recipient_company_id)
);

create index if not exists document_recipient_grants_recipient_idx
  on public.document_recipient_grants (recipient_company_id);

alter table public.document_recipient_grants enable row level security;
-- table privileges: sessions may see/manage grants (RLS then decides which rows),
-- anon gets nothing. A new table does not inherit earlier table grants.
revoke all on public.document_recipient_grants from anon;
grant select, insert, delete on public.document_recipient_grants to authenticated;

-- ─── decision helpers (one place per question; security definer avoids recursion) ───
create or replace function public.tenant_is_invoice_issuer(doc uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.invoices i
    join public.companies c on c.id = i.issuer_company_id
    where i.id = doc
      and c.organization_id is not null
      and public.tenant_has_membership(c.organization_id)
  );
$$;

create or replace function public.tenant_is_invoice_recipient(doc uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.document_recipient_grants g
    join public.companies c on c.id = g.recipient_company_id
    where g.document_id = doc
      and c.organization_id is not null
      and public.tenant_has_membership(c.organization_id)
  );
$$;

create or replace function public.tenant_is_standalone_issuer(doc uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.standalone_documents d
    join public.companies c on c.id = d.issuer_company_id
    where d.id = doc
      and c.organization_id is not null
      and public.tenant_has_membership(c.organization_id)
  );
$$;

create or replace function public.tenant_is_standalone_recipient(doc uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.document_recipient_grants g
    join public.companies c on c.id = g.recipient_company_id
    where g.document_id = doc
      and c.organization_id is not null
      and public.tenant_has_membership(c.organization_id)
  );
$$;

revoke all on function public.tenant_is_invoice_issuer(uuid)      from anon, public;
revoke all on function public.tenant_is_invoice_recipient(uuid)   from anon, public;
revoke all on function public.tenant_is_standalone_issuer(uuid)   from anon, public;
revoke all on function public.tenant_is_standalone_recipient(uuid) from anon, public;
grant execute on function public.tenant_is_invoice_issuer(uuid)      to authenticated;
grant execute on function public.tenant_is_invoice_recipient(uuid)   to authenticated;
grant execute on function public.tenant_is_standalone_issuer(uuid)   to authenticated;
grant execute on function public.tenant_is_standalone_recipient(uuid) to authenticated;

-- ─── invoices: issuer-side + recipient-side (replaces the counterparty-side rule) ───
drop policy if exists tenant_company_scope_select on public.invoices;

drop policy if exists invoices_issuer_or_recipient_select on public.invoices;
create policy invoices_issuer_or_recipient_select
  on public.invoices for select
  to authenticated
  using (
    public.tenant_is_invoice_issuer(id)
    or public.tenant_is_invoice_recipient(id)
  );

-- ─── standalone_documents: same pair (V2 never opened this table) ───
drop policy if exists standalone_documents_issuer_or_recipient_select on public.standalone_documents;
create policy standalone_documents_issuer_or_recipient_select
  on public.standalone_documents for select
  to authenticated
  using (
    public.tenant_is_standalone_issuer(id)
    or public.tenant_is_standalone_recipient(id)
  );

-- ─── inbound evidence (receipt_documents / company_expenses) ───
-- These two tables have no issuer: a receipt/slip is evidence held by the
-- company that RECEIVED it (customer_company_id), which is the document's
-- operating organization. Semantics are unchanged from V2 — only the decision
-- is moved into a helper so company_expenses, which has no company column of
-- its own, can reach it through its real FK.
create or replace function public.tenant_owns_receipt(doc uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.receipt_documents r
    join public.companies c on c.id = r.customer_company_id
    where r.id = doc
      and c.organization_id is not null
      and public.tenant_has_membership(c.organization_id)
  );
$$;

revoke all on function public.tenant_owns_receipt(uuid) from anon, public;
grant execute on function public.tenant_owns_receipt(uuid) to authenticated;

drop policy if exists tenant_line_scope_select on public.receipt_documents;
drop policy if exists receipt_documents_owner_select on public.receipt_documents;
create policy receipt_documents_owner_select
  on public.receipt_documents for select
  to authenticated
  using (public.tenant_owns_receipt(id));

drop policy if exists company_expenses_owner_select on public.company_expenses;
create policy company_expenses_owner_select
  on public.company_expenses for select
  to authenticated
  using (
    receipt_document_id is not null
    and public.tenant_owns_receipt(receipt_document_id)
  );

-- ─── grants: the issuer manages them; the recipient may see its own ───
drop policy if exists document_grants_select on public.document_recipient_grants;
create policy document_grants_select
  on public.document_recipient_grants for select
  to authenticated
  using (
    public.tenant_is_invoice_issuer(document_id)
    or public.tenant_is_standalone_issuer(document_id)
    or exists (
      select 1 from public.companies c
      where c.id = document_recipient_grants.recipient_company_id
        and c.organization_id is not null
        and public.tenant_has_membership(c.organization_id)
    )
  );

drop policy if exists document_grants_insert_issuer_only on public.document_recipient_grants;
create policy document_grants_insert_issuer_only
  on public.document_recipient_grants for insert
  to authenticated
  with check (
    public.tenant_is_invoice_issuer(document_id)
    or public.tenant_is_standalone_issuer(document_id)
  );

drop policy if exists document_grants_delete_issuer_only on public.document_recipient_grants;
create policy document_grants_delete_issuer_only
  on public.document_recipient_grants for delete
  to authenticated
  using (
    public.tenant_is_invoice_issuer(document_id)
    or public.tenant_is_standalone_issuer(document_id)
  );

-- ROLLBACK: supabase/rollback/20261019000003_document_ownership_model_a_rollback.sql
-- Verification after an approved apply (do not run now):
--   select count(*) from public.invoices where issuer_company_id is not null;  -- unchanged (no backfill)
--   select count(*) from public.document_recipient_grants;                     -- 0 (no grants minted)
