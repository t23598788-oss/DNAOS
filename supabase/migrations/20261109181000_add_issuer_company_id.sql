-- ============================================================================
-- Give the document spine an issuer
-- ============================================================================
-- Every document table named the parties it was ABOUT and never the party that
-- ISSUED it. `standalone_documents` had customer_company_id AND
-- partner_company_id — two named parties, no issuer — so the only remaining
-- candidate for "who issued this" was the system, which is exactly why the whole
-- codebase reads as "DNA OS is the seller".
--
-- A third party now has a name: issuer_company_id → public.companies(id).
--
-- Why NOT NULL DEFAULT the CORE company: today every row in fact IS issued by the
-- platform. Defaulting to the CORE company keeps the current behaviour exactly
-- while making the third party explicit; new writers set it by intent (see
-- engines/canonical/document-write.ts). Existing rows need no backfill — the
-- default fills them — and there is no production deployment to migrate.
--
-- Why the FK: the column can never point at a company that does not exist, so
-- "who issued this" is always resolvable, never a dangling string.
--
-- NOT touched: customer_company_id / partner_company_id. This migration adds a
-- party; it does not rename or reassign the existing ones.
--
-- Depends on 20261109180000_seed_platform_company.sql running first: the FK is
-- validated against existing rows, and every existing row receives the default.
-- ============================================================================

alter table public.standalone_documents
  add column if not exists issuer_company_id uuid not null
  default '00000000-0000-0000-0000-00000000d0a0'::uuid
  references public.companies(id);

alter table public.invoices
  add column if not exists issuer_company_id uuid not null
  default '00000000-0000-0000-0000-00000000d0a0'::uuid
  references public.companies(id);

alter table public.customer_orders
  add column if not exists issuer_company_id uuid not null
  default '00000000-0000-0000-0000-00000000d0a0'::uuid
  references public.companies(id);

alter table public.document_groups
  add column if not exists issuer_company_id uuid not null
  default '00000000-0000-0000-0000-00000000d0a0'::uuid
  references public.companies(id);

-- `add column if not exists` silently skips the FK on a database where the column
-- already exists, so each constraint is asserted separately. Duplicates are
-- swallowed; nothing is dropped.
do $$ begin
  alter table public.standalone_documents add constraint "standalone_documents_issuer_company_id_fkey"
    foreign key ("issuer_company_id") references public.companies("id");
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.invoices add constraint "invoices_issuer_company_id_fkey"
    foreign key ("issuer_company_id") references public.companies("id");
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.customer_orders add constraint "customer_orders_issuer_company_id_fkey"
    foreign key ("issuer_company_id") references public.companies("id");
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.document_groups add constraint "document_groups_issuer_company_id_fkey"
    foreign key ("issuer_company_id") references public.companies("id");
exception when duplicate_object then null; end $$;

-- Partial + non-unique on purpose: the overwhelming majority of rows are issued
-- by the platform (the default), so indexing those would be dead weight. These
-- indexes serve the query that currently has no answer — "find the documents
-- issued by someone OTHER than the platform".
create index if not exists "standalone_documents_issuer_company_id_idx"
  on public."standalone_documents" ("issuer_company_id")
  where "issuer_company_id" <> '00000000-0000-0000-0000-00000000d0a0'::uuid;

create index if not exists "invoices_issuer_company_id_idx"
  on public."invoices" ("issuer_company_id")
  where "issuer_company_id" <> '00000000-0000-0000-0000-00000000d0a0'::uuid;

create index if not exists "customer_orders_issuer_company_id_idx"
  on public."customer_orders" ("issuer_company_id")
  where "issuer_company_id" <> '00000000-0000-0000-0000-00000000d0a0'::uuid;

create index if not exists "document_groups_issuer_company_id_idx"
  on public."document_groups" ("issuer_company_id")
  where "issuer_company_id" <> '00000000-0000-0000-0000-00000000d0a0'::uuid;
