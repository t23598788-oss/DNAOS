-- DOCUMENT ISSUER / OWNER AUTHORITY — PROPOSAL ONLY (owner mission 2026-10-19, STEP 3)
-- DO NOT APPLY TO PRODUCTION WITHOUT OWNER APPROVAL.
--
-- PROVEN GAP (live schema, read-only 2026-10-19; PostgREST OpenAPI + row census):
--   invoices              : customer_company_id only. NO seller/issuer column, NO organization_id.
--   standalone_documents  : customer_company_id + partner_company_id. NO issuer, NO organization_id.
--   receipt_documents     : customer_company_id only (the P.O.V. of the receiver). NO issuer, NO organization_id.
--   company_expenses      : receipt_document_id only. NO organization_id (attribution is derived
--                           through receipt_documents.customer_company_id).
--   → the only org relationship the application can derive is "the org that owns the BUYER
--     company". That is why resolveVerifiedScope() ends in ORG_UNMAPPED for the operator's own
--     documents: the operator's org owns the seller side, which is not modelled at all.
--
-- WHAT THIS MIGRATION DOES (additive, nullable, zero backfill):
--   * adds `issuer_company_id` (the legal entity that issued the document) where a document is
--     issued by someone: invoices, standalone_documents;
--   * adds `organization_id` (the tenant that owns the document record) to invoices,
--     standalone_documents, receipt_documents, company_expenses;
--   * indexes for the scope lookup.
-- It deliberately does NOT:
--   * backfill any row (no guessing which company issued historic documents);
--   * change any canonical writer (engines/canonical/document-write.ts stays the only path);
--   * change any RLS policy or reader (that is a business-model decision — see STOPPED below);
--   * touch canonical totals, statuses, or existing columns.
--
-- MAPPING PROPOSAL (for owner decision, NOT applied):
--   DOCUMENT OWNER      = organization_id (the tenant operating the document)
--   ISSUER / SELLER     = issuer_company_id (must be a company inside that organization)
--   BUYER / COUNTERPARTY= customer_company_id (unchanged — a counterparty, never the owner)
--   AUTHORIZED RECIPIENT= buyer company's org members may READ the document when the owner
--                         explicitly shares it; today no such sharing model exists.
--   Alternative A (recommended): add organization_id + issuer_company_id as above, stamp them in
--     the canonical writer at creation time from the caller's verified scope; keep
--     customer_company_id as counterparty only.
--   Alternative B (no new columns): keep a separate document_ownership table. Rejected as a
--     first step because it duplicates the ownership already implied by issuer_company_id and
--     would create a second lookup path.
--   Alternative C (do nothing): current ORG_UNMAPPED cannot be fixed without mis-binding buyers
--     into the operator's organization, which violates the "do not move companies into one org" rule.
--
-- STOPPED FOR OWNER DECISION: choosing A/B/C changes the business ownership model. Until that
-- decision, no reader/writer/policy is changed and no production row is written.

alter table public.invoices
  add column if not exists issuer_company_id uuid references public.companies(id),
  add column if not exists organization_id uuid references public.organizations(id);

alter table public.standalone_documents
  add column if not exists issuer_company_id uuid references public.companies(id),
  add column if not exists organization_id uuid references public.organizations(id);

alter table public.receipt_documents
  add column if not exists organization_id uuid references public.organizations(id);

alter table public.company_expenses
  add column if not exists organization_id uuid references public.organizations(id);

create index if not exists invoices_issuer_company_idx      on public.invoices (issuer_company_id);
create index if not exists invoices_organization_idx        on public.invoices (organization_id);
create index if not exists standalone_docs_issuer_company_idx on public.standalone_documents (issuer_company_id);
create index if not exists standalone_docs_organization_idx on public.standalone_documents (organization_id);
create index if not exists receipt_documents_organization_idx on public.receipt_documents (organization_id);
create index if not exists company_expenses_organization_idx  on public.company_expenses (organization_id);

-- Verification after an approved apply (do not run now):
--   select count(*) from public.invoices where organization_id is not null;  -- expected 0 (no backfill)
--   select count(*) from public.companies where organization_id is not null; -- unchanged by this file
