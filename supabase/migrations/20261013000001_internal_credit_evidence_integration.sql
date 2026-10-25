-- Internal credit evidence integration (2026-10-13). ADDITIVE ONLY.
-- This is evidence/review authority, not a finance ledger. `receipt_documents`
-- remains inbound-file classification and `payment_allocations` remains payment authority.

create table if not exists public.credit_agreements (
  id uuid primary key default gen_random_uuid(),
  agreement_no text not null,
  agreement_version integer not null default 1 check (agreement_version >= 1),
  status text not null default 'pending_review' check (status in ('pending_review','accepted','rejected')),
  lender_company_id uuid null references public.companies(id) on delete restrict,
  lender_name text not null,
  borrower_company_id uuid null references public.companies(id) on delete restrict,
  borrower_name text not null,
  agreed_at date not null,
  principal_amount numeric(14,2) not null check (principal_amount > 0),
  service_fee_amount numeric(14,2) not null default 0 check (service_fee_amount >= 0),
  repayment_terms jsonb not null default '{}'::jsonb,
  evidence_ref text not null,
  created_at timestamptz not null default now(),
  created_by text not null,
  constraint credit_agreements_text_chk check (length(btrim(agreement_no)) > 0 and length(btrim(lender_name)) > 0 and length(btrim(borrower_name)) > 0 and length(btrim(evidence_ref)) > 0),
  constraint credit_agreements_terms_object_chk check (jsonb_typeof(repayment_terms) = 'object')
);
create unique index if not exists credit_agreements_agreement_version_uidx on public.credit_agreements (agreement_no, agreement_version);
create index if not exists credit_agreements_borrower_company_idx on public.credit_agreements (borrower_company_id);

-- Explicit reviewed meaning of a receipt in this agreement. A transfer slip is
-- never automatically a principal disbursement merely from document_type.
create table if not exists public.credit_agreement_receipt_bindings (
  id uuid primary key default gen_random_uuid(),
  credit_agreement_id uuid not null references public.credit_agreements(id) on delete restrict,
  receipt_document_id uuid not null references public.receipt_documents(id) on delete restrict,
  evidence_role text not null check (evidence_role in ('disbursement','supporting','excluded')),
  classification text not null check (classification in ('loan_disbursement','credit_disbursement','loan_repayment','interest_payment','penalty_payment','unknown_transfer')),
  review_status text not null default 'pending_review' check (review_status in ('pending_review','accepted','rejected')),
  amount_basis text not null check (amount_basis in ('gross_transfer','net_disbursed','unknown')),
  credited_amount numeric(14,2) null check (credited_amount is null or credited_amount > 0),
  provenance jsonb not null default '{}'::jsonb,
  review_reason text null,
  reviewed_at timestamptz null,
  reviewed_by text null,
  created_at timestamptz not null default now(),
  created_by text not null,
  constraint credit_receipt_provenance_object_chk check (jsonb_typeof(provenance) = 'object'),
  constraint credit_receipt_review_actor_chk check ((review_status = 'pending_review' and reviewed_at is null and reviewed_by is null) or (review_status in ('accepted','rejected') and reviewed_at is not null and length(btrim(coalesce(reviewed_by, ''))) > 0))
);
create unique index if not exists credit_agreement_receipt_bindings_agreement_receipt_uidx on public.credit_agreement_receipt_bindings (credit_agreement_id, receipt_document_id);
create index if not exists credit_agreement_receipt_bindings_receipt_idx on public.credit_agreement_receipt_bindings (receipt_document_id);

create table if not exists public.credit_agreement_acceptances (
  id uuid primary key default gen_random_uuid(),
  credit_agreement_id uuid not null references public.credit_agreements(id) on delete restrict,
  agreement_version integer not null check (agreement_version >= 1),
  proposal_line_event_id uuid not null references public.line_events(id) on delete restrict,
  response_line_event_id uuid not null references public.line_events(id) on delete restrict,
  status text not null default 'pending_review' check (status in ('pending_review','accepted','rejected')),
  acceptor_line_user_id text null,
  acceptor_message_id text null,
  agreement_reference text not null,
  proposal_excerpt text not null,
  response_excerpt text not null,
  accepted_at timestamptz null,
  provenance jsonb not null default '{}'::jsonb,
  review_reason text null,
  created_at timestamptz not null default now(),
  created_by text not null,
  constraint credit_acceptance_events_differ_chk check (proposal_line_event_id <> response_line_event_id),
  constraint credit_acceptance_text_chk check (length(btrim(agreement_reference)) > 0 and length(btrim(proposal_excerpt)) > 0 and length(btrim(response_excerpt)) > 0),
  constraint credit_acceptance_provenance_object_chk check (jsonb_typeof(provenance) = 'object'),
  constraint credit_acceptance_identity_chk check (status <> 'accepted' or (accepted_at is not null and length(btrim(coalesce(acceptor_line_user_id, ''))) > 0 and length(btrim(coalesce(acceptor_message_id, ''))) > 0))
);
create unique index if not exists credit_agreement_acceptances_agreement_version_uidx on public.credit_agreement_acceptances (credit_agreement_id, agreement_version);
create unique index if not exists credit_agreement_acceptances_response_event_uidx on public.credit_agreement_acceptances (response_line_event_id);

-- Append-only by document version. Same agreement/document can bind new versions
-- without changing historical bindings or artifacts.
create table if not exists public.credit_document_bindings (
  id uuid primary key default gen_random_uuid(),
  credit_agreement_id uuid not null references public.credit_agreements(id) on delete restrict,
  credit_acceptance_id uuid not null references public.credit_agreement_acceptances(id) on delete restrict,
  standalone_document_id uuid not null references public.standalone_documents(id) on delete restrict,
  document_version_id uuid not null references public.document_versions(id) on delete restrict,
  source_reference text not null,
  financial_snapshot jsonb not null default '{}'::jsonb,
  artifact_pdf_id uuid not null references public.document_artifacts(id) on delete restrict,
  artifact_image_id uuid not null references public.document_artifacts(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by text not null,
  constraint credit_document_binding_ref_chk check (length(btrim(source_reference)) > 0),
  constraint credit_document_binding_snapshot_chk check (jsonb_typeof(financial_snapshot) = 'object')
);
create unique index if not exists credit_document_bindings_version_uidx on public.credit_document_bindings (document_version_id);
create index if not exists credit_document_bindings_agreement_idx on public.credit_document_bindings (credit_agreement_id, created_at);
create index if not exists credit_document_bindings_document_idx on public.credit_document_bindings (standalone_document_id, created_at);

alter table public.credit_agreements enable row level security;
alter table public.credit_agreement_receipt_bindings enable row level security;
alter table public.credit_agreement_acceptances enable row level security;
alter table public.credit_document_bindings enable row level security;
drop policy if exists credit_agreements_service_role_only on public.credit_agreements;
create policy credit_agreements_service_role_only on public.credit_agreements for all using (false);
drop policy if exists credit_agreement_receipt_bindings_service_role_only on public.credit_agreement_receipt_bindings;
create policy credit_agreement_receipt_bindings_service_role_only on public.credit_agreement_receipt_bindings for all using (false);
drop policy if exists credit_agreement_acceptances_service_role_only on public.credit_agreement_acceptances;
create policy credit_agreement_acceptances_service_role_only on public.credit_agreement_acceptances for all using (false);
drop policy if exists credit_document_bindings_service_role_only on public.credit_document_bindings;
create policy credit_document_bindings_service_role_only on public.credit_document_bindings for all using (false);