-- ============================================================================
-- Canonical Foundation v1.1 — ADDITIVE ONLY (no drop / no rename / no data loss)
-- Contract: CANONICAL_MODEL_DOCUMENT_TRANSACTION_FINANCE_V1_1.md
-- Owner-approved architecture contract (2026-09-22). Phase C2.
--
-- Pre-flight proof (Phase C1, /tmp/phaseC-before.json):
--   orphans = 0 on every planned FK edge · duplicate relationships = 0
--   invoices total_amount = subtotal + vat_amount for 6/6 rows (GROSS proven)
--   standalone_documents same for 7/7 rows
--   storage.objects: 85 objects, size+mimetype on 85/85, eTag only (MD5) -> sha256 stays NULL
--
-- Everything below is idempotent (create if not exists / guarded constraint add)
-- so a re-run cannot destroy or duplicate anything.
-- ============================================================================

-- ── 1. Financial ladder columns on the two generated-document tables ────────
alter table public.invoices
  add column if not exists discount_amount   numeric(14,2) null,
  add column if not exists vat_mode          text null,
  add column if not exists gross_amount      numeric(14,2) null,
  add column if not exists wht_rate          numeric(6,4) null,
  add column if not exists wht_amount        numeric(14,2) null,
  add column if not exists net_payable       numeric(14,2) null,
  add column if not exists data_completeness text not null default 'LEGACY_PARTIAL';

alter table public.standalone_documents
  add column if not exists discount_amount   numeric(14,2) null,
  add column if not exists vat_mode          text null,
  add column if not exists gross_amount      numeric(14,2) null,
  add column if not exists wht_rate          numeric(6,4) null,
  add column if not exists wht_amount        numeric(14,2) null,
  add column if not exists net_payable       numeric(14,2) null,
  add column if not exists data_completeness text not null default 'LEGACY_PARTIAL';

do $$
begin
  alter table public.invoices
    add constraint invoices_vat_mode_chk check (vat_mode is null or vat_mode in ('exclusive','inclusive')),
    add constraint invoices_data_completeness_chk check (data_completeness in ('FULL','LEGACY_PARTIAL')),
    add constraint invoices_wht_rate_chk check (wht_rate is null or (wht_rate >= 0 and wht_rate <= 1));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.standalone_documents
    add constraint standalone_documents_vat_mode_chk check (vat_mode is null or vat_mode in ('exclusive','inclusive')),
    add constraint standalone_documents_data_completeness_chk check (data_completeness in ('FULL','LEGACY_PARTIAL')),
    add constraint standalone_documents_wht_rate_chk check (wht_rate is null or (wht_rate >= 0 and wht_rate <= 1));
exception when duplicate_object then null;
end $$;

-- ── 2. Transaction type (vocabulary reused from engines/transactions/workflows.ts TxType)
alter table public.customer_orders
  add column if not exists tx_type text null;
do $$
begin
  alter table public.customer_orders
    add constraint customer_orders_tx_type_chk
    check (tx_type is null or tx_type in ('sale','purchase','contract','service','rental','transport'));
exception when duplicate_object then null;
end $$;

-- ── 3. Canonical business-event type code (Thai free text stays in event_type)
alter table public.business_events
  add column if not exists event_type_code text null;

-- ── 4. Inbound source file facts (owner stays receipt_documents.media_path)
alter table public.receipt_documents
  add column if not exists media_sha256      text null,
  add column if not exists media_size_bytes  bigint null,
  add column if not exists media_mime_type   text null,
  add column if not exists media_captured_at timestamptz null,
  add column if not exists allocation_state  text not null default 'unallocated';
do $$
begin
  alter table public.receipt_documents
    add constraint receipt_documents_allocation_state_chk
    check (allocation_state in ('unallocated','partial','allocated'));
exception when duplicate_object then null;
end $$;

-- ── 5. debt_events can point at invoices too (today only standalone docs)
alter table public.debt_events
  add column if not exists linked_invoice_id uuid null;

-- ── 6. document_versions — append-only version chain (new → previous)
create table if not exists public.document_versions (
  id                     uuid primary key default gen_random_uuid(),
  invoice_id             uuid null references public.invoices(id) on delete cascade,
  standalone_document_id uuid null references public.standalone_documents(id) on delete cascade,
  version_no             integer not null check (version_no >= 1),
  previous_version_id    uuid null references public.document_versions(id),
  status                 text not null default 'active',
  data_completeness      text not null default 'LEGACY_PARTIAL',
  snapshot               jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  created_by             text,
  constraint document_versions_one_document_chk check (num_nonnulls(invoice_id, standalone_document_id) = 1),
  constraint document_versions_status_chk check (status in ('active','superseded','void')),
  constraint document_versions_completeness_chk check (data_completeness in ('FULL','LEGACY_PARTIAL')),
  constraint document_versions_no_self_reference_chk check (previous_version_id is null or previous_version_id <> id)
);
create unique index if not exists document_versions_invoice_version_uidx
  on public.document_versions (invoice_id, version_no) where invoice_id is not null;
create unique index if not exists document_versions_standalone_version_uidx
  on public.document_versions (standalone_document_id, version_no) where standalone_document_id is not null;
create index if not exists document_versions_previous_idx on public.document_versions (previous_version_id);
create index if not exists document_versions_status_idx on public.document_versions (status);

-- ── 7. document_artifacts — GENERATED files only, always owned by a version
create table if not exists public.document_artifacts (
  id                  uuid primary key default gen_random_uuid(),
  document_version_id uuid not null references public.document_versions(id) on delete cascade,
  kind                text not null,
  storage_bucket      text not null default 'attachments',
  storage_path        text not null,
  sha256              text not null,
  size_bytes          bigint not null check (size_bytes >= 0),
  mime_type           text not null,
  produced_by         text not null,
  created_at          timestamptz not null default now(),
  created_by          text,
  constraint document_artifacts_kind_chk check (kind in ('pdf','image')),
  constraint document_artifacts_path_not_empty_chk check (length(btrim(storage_path)) > 0),
  constraint document_artifacts_sha256_not_empty_chk check (length(btrim(sha256)) > 0),
  unique (document_version_id, kind, sha256)
);
create index if not exists document_artifacts_version_idx on public.document_artifacts (document_version_id);

-- ── 8. payment_allocations — the ONE truth for "how much of a payment went where"
create table if not exists public.payment_allocations (
  id                     uuid primary key default gen_random_uuid(),
  receipt_document_id    uuid not null references public.receipt_documents(id) on delete restrict,
  invoice_id             uuid null references public.invoices(id) on delete restrict,
  standalone_document_id uuid null references public.standalone_documents(id) on delete restrict,
  debt_event_id          uuid null references public.debt_events(id) on delete restrict,
  allocation_kind        text not null,
  amount                 numeric(14,2) not null check (amount > 0),
  allocated_at           timestamptz not null default now(),
  allocated_by           text,
  note                   text,
  constraint payment_allocations_one_target_chk
    check (num_nonnulls(invoice_id, standalone_document_id, debt_event_id) = 1),
  constraint payment_allocations_kind_chk
    check (allocation_kind in ('principal','interest','penalty','other'))
);
create index if not exists payment_allocations_receipt_idx on public.payment_allocations (receipt_document_id);
create index if not exists payment_allocations_invoice_idx on public.payment_allocations (invoice_id);
create index if not exists payment_allocations_standalone_idx on public.payment_allocations (standalone_document_id);
create index if not exists payment_allocations_debt_event_idx on public.payment_allocations (debt_event_id);

-- ── 9. document_references — document↔document ONLY (CHILD is never persisted)
create table if not exists public.document_references (
  id                           uuid primary key default gen_random_uuid(),
  relation_type                public."DocumentReferenceRelationType" not null,
  from_invoice_id              uuid null references public.invoices(id) on delete cascade,
  from_standalone_document_id  uuid null references public.standalone_documents(id) on delete cascade,
  to_invoice_id                uuid null references public.invoices(id) on delete cascade,
  to_standalone_document_id    uuid null references public.standalone_documents(id) on delete cascade,
  amount                       numeric(14,2) null,
  evidence_ref                 text,
  created_at                   timestamptz not null default now(),
  created_by                   text,
  constraint document_references_doc_to_doc_chk
    check (relation_type in ('PARENT','GENERATED_FROM')),
  constraint document_references_one_from_chk
    check (num_nonnulls(from_invoice_id, from_standalone_document_id) = 1),
  constraint document_references_one_to_chk
    check (num_nonnulls(to_invoice_id, to_standalone_document_id) = 1),
  constraint document_references_not_self_chk
    check (from_invoice_id is distinct from to_invoice_id
       and from_standalone_document_id is distinct from to_standalone_document_id)
);
create unique index if not exists document_references_edge_uidx on public.document_references (
  relation_type,
  coalesce(from_invoice_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(from_standalone_document_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(to_invoice_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(to_standalone_document_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
create index if not exists document_references_from_invoice_idx on public.document_references (from_invoice_id);
create index if not exists document_references_to_invoice_idx on public.document_references (to_invoice_id);

-- ── 10. inbound_source_links — SOURCE direction only: inbound record → document
create table if not exists public.inbound_source_links (
  id                     uuid primary key default gen_random_uuid(),
  relation_type          public."DocumentReferenceRelationType" not null default 'SOURCE',
  receipt_document_id    uuid null references public.receipt_documents(id) on delete cascade,
  business_event_id      uuid null references public.business_events(id) on delete cascade,
  invoice_id             uuid null references public.invoices(id) on delete cascade,
  standalone_document_id uuid null references public.standalone_documents(id) on delete cascade,
  evidence_ref           text,
  created_at             timestamptz not null default now(),
  created_by             text,
  constraint inbound_source_links_source_only_chk check (relation_type = 'SOURCE'),
  constraint inbound_source_links_one_left_chk
    check (num_nonnulls(receipt_document_id, business_event_id) = 1),
  constraint inbound_source_links_one_right_chk
    check (num_nonnulls(invoice_id, standalone_document_id) = 1)
);
create unique index if not exists inbound_source_links_edge_uidx on public.inbound_source_links (
  coalesce(receipt_document_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(business_event_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(invoice_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(standalone_document_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
create index if not exists inbound_source_links_receipt_idx on public.inbound_source_links (receipt_document_id);
create index if not exists inbound_source_links_invoice_idx on public.inbound_source_links (invoice_id);

-- ── 11. The three missing FKs (orphan pre-check in C1 returned 0 for all)
do $$
begin
  alter table public.document_groups
    add constraint document_groups_root_order_id_fkey
    foreign key (root_order_id) references public.customer_orders(id) on delete set null;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.business_events
    add constraint business_events_transaction_id_fkey
    foreign key (transaction_id) references public.customer_orders(id) on delete set null;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.debt_events
    add constraint debt_events_linked_invoice_id_fkey
    foreign key (linked_invoice_id) references public.invoices(id) on delete set null;
exception when duplicate_object then null;
end $$;

create index if not exists document_groups_root_order_idx on public.document_groups (root_order_id);
create index if not exists business_events_transaction_idx on public.business_events (transaction_id);
create index if not exists debt_events_linked_invoice_idx on public.debt_events (linked_invoice_id);

-- ── 12. Row level security: new tables deny-by-default for anon; service role bypasses
--       (same posture as the existing registry/evidence tables — no policies added)
alter table public.document_versions      enable row level security;
alter table public.document_artifacts     enable row level security;
alter table public.payment_allocations    enable row level security;
alter table public.document_references    enable row level security;
alter table public.inbound_source_links   enable row level security;


