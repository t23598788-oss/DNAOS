-- ============================================================================
-- Baseline: the nine "spine" tables that existed only in the live schema dump
-- ============================================================================
-- Source of truth: supabase/local-migration/full_schema.sql (the introspected
-- dump of the pre-migration, Prisma-era schema). These nine tables had NO
-- `create table` anywhere in supabase/migrations/, which meant a fresh
-- `supabase db push` could never succeed:
--
--   20260709000001_enable_rls_public_tables.sql  loops over these tables
--   20260922000001_canonical_foundation_v1_1.sql  ALTERs invoices / standalone_documents / customer_orders
--   20261013000001_internal_credit_evidence_integration.sql  FKs to companies
--   (and 9 more files reference them by name)
--
-- This migration is deliberately stamped 20260619000000 — BEFORE every other
-- migration (earliest existing is 20260620000000) — because the tables must
-- exist before anything references them.
--
-- This is a FAITHFUL SNAPSHOT, not a redesign: column names, types, defaults,
-- nullability, primary keys, foreign keys, check constraints, indexes and RLS
-- are copied verbatim from the dump. Every statement is guarded so re-running
-- is harmless (`if not exists` / `if exists` / exception-on-duplicate).
--
-- NOT included, because the dump has none for these tables: triggers, grants,
-- column comments. (debt_snapshots' column comments are documentation, not
-- schema — see full_schema.sql lines 1040-1055.)
-- ============================================================================

-- ── 1. Enum types these tables depend on ────────────────────────────────────
-- All ten are absent from supabase/migrations/. app_role already exists
-- (20260708000001_profiles_roles.sql) and is intentionally not repeated here.
do $$ begin
  execute 'create type public."CompanyStatus" as enum (''ACTIVE'', ''INACTIVE'', ''SUSPENDED'')';
exception when duplicate_object then null; end $$;

do $$ begin
  execute 'create type public."CompanyType" as enum (''CORE'', ''CUSTOMER'', ''SUPPLIER'', ''FLEET'')';
exception when duplicate_object then null; end $$;

do $$ begin
  execute 'create type public."CollectionState" as enum (''CURRENT'', ''OVERDUE'', ''WARNING'', ''COLLECTION'', ''PROMISED'', ''PARTIAL'', ''LEGAL'', ''CLOSED'')';
exception when duplicate_object then null; end $$;

do $$ begin
  execute 'create type public."CustomerOrderStatus" as enum (''DRAFT'', ''SUBMITTED'', ''PRICING'', ''QUOTED'', ''CONFIRMED'', ''CANCELLED'', ''PROCUREMENT'', ''DISPATCHING'', ''PARTIALLY_DELIVERED'', ''DELIVERED'', ''INVOICED'', ''PAID'')';
exception when duplicate_object then null; end $$;

do $$ begin
  execute 'create type public."DocumentGroupStatus" as enum (''OPEN'', ''CLOSED'', ''ARCHIVED'')';
exception when duplicate_object then null; end $$;

do $$ begin
  execute 'create type public."DocumentType" as enum (''ORD'', ''BOQ'', ''QT'', ''PO'', ''INV'', ''RCP'', ''PV'', ''PMT'')';
exception when duplicate_object then null; end $$;

do $$ begin
  execute 'create type public."InvoiceStatus" as enum (''DRAFT'', ''SENT'', ''PARTIALLY_PAID'', ''PAID'', ''VOID'')';
exception when duplicate_object then null; end $$;

do $$ begin
  execute 'create type public."ProjectStatus" as enum (''ACTIVE'', ''ON_HOLD'', ''COMPLETED'', ''CANCELLED'')';
exception when duplicate_object then null; end $$;

-- Not used by these nine tables, but also dump-only: created here so the
-- remaining three party enums all resolve from migrations after this baseline.
do $$ begin
  execute 'create type public."Role" as enum (''OWNER'', ''ADMIN'', ''ACCOUNTANT'', ''PROCUREMENT'', ''OPERATION'', ''CUSTOMER'', ''SUPPLIER'', ''FLEET_OWNER'', ''DRIVER'', ''VIEWER'')';
exception when duplicate_object then null; end $$;

do $$ begin
  execute 'create type public."SettlementPartnerType" as enum (''SUPPLIER'', ''FLEET'')';
exception when duplicate_object then null; end $$;

-- ── 2. companies ────────────────────────────────────────────────────────────
create table if not exists public."companies" (
  "id" "uuid" default "gen_random_uuid"() not null,
  "name" "text" not null,
  "tax_id" "text",
  "address" "text",
  "phone" "text",
  "email" "text",
  "bank_name" "text",
  "bank_account_no" "text",
  "type" public."CompanyType" not null,
  "status" public."CompanyStatus" default 'ACTIVE'::public."CompanyStatus" not null,
  "created_at" timestamp(3) without time zone default CURRENT_TIMESTAMP not null,
  "updated_at" timestamp(3) without time zone not null,
  "is_individual" boolean default false not null,
  "line_user_id" "text",
  constraint "companies_pkey" primary key ("id")
);

-- ── 3. customer_sites ───────────────────────────────────────────────────────
create table if not exists public."customer_sites" (
  "id" "uuid" default "gen_random_uuid"() not null,
  "customer_company_id" "uuid" not null,
  "site_name" "text" not null,
  "address" "text" not null,
  "province" "text" not null,
  "district" "text" not null,
  "subdistrict" "text" not null,
  "postal_code" "text" not null,
  "gps_lat" numeric(10,7),
  "gps_lng" numeric(10,7),
  "contact_name" "text",
  "contact_phone" "text",
  "delivery_note" "text",
  "access_restriction" "text",
  "preferred_delivery_time" "text",
  "is_active" boolean default true not null,
  "created_at" timestamp(3) without time zone default CURRENT_TIMESTAMP not null,
  "updated_at" timestamp(3) without time zone not null,
  constraint "customer_sites_pkey" primary key ("id"),
  constraint "customer_sites_customer_company_id_fkey" foreign key ("customer_company_id")
    references public."companies"("id") on update cascade on delete cascade
);

-- ── 4. projects ─────────────────────────────────────────────────────────────
create table if not exists public."projects" (
  "id" "uuid" default "gen_random_uuid"() not null,
  "project_no" "text" not null,
  "customer_company_id" "uuid" not null,
  "customer_site_id" "uuid" not null,
  "title" "text" not null,
  "status" public."ProjectStatus" default 'ACTIVE'::public."ProjectStatus" not null,
  "created_at" timestamp(3) without time zone default CURRENT_TIMESTAMP not null,
  "updated_at" timestamp(3) without time zone not null,
  constraint "projects_pkey" primary key ("id"),
  constraint "projects_customer_company_id_fkey" foreign key ("customer_company_id")
    references public."companies"("id") on update cascade on delete restrict,
  constraint "projects_customer_site_id_fkey" foreign key ("customer_site_id")
    references public."customer_sites"("id") on update cascade on delete restrict
);

-- ── 5. document_groups ──────────────────────────────────────────────────────
create table if not exists public."document_groups" (
  "id" "uuid" default "gen_random_uuid"() not null,
  "group_no" "text" not null,
  "project_id" "uuid" not null,
  "project_no" "text" not null,
  "root_order_id" "uuid",
  "root_order_no" "text",
  "customer_company_id" "uuid" not null,
  "title" "text" not null,
  "status" public."DocumentGroupStatus" default 'OPEN'::public."DocumentGroupStatus" not null,
  "created_at" timestamp(3) without time zone default CURRENT_TIMESTAMP not null,
  "updated_at" timestamp(3) without time zone not null,
  constraint "document_groups_pkey" primary key ("id"),
  constraint "document_groups_customer_company_id_fkey" foreign key ("customer_company_id")
    references public."companies"("id") on update cascade on delete restrict,
  constraint "document_groups_project_id_fkey" foreign key ("project_id")
    references public."projects"("id") on update cascade on delete restrict
);

-- ── 6. customer_orders ──────────────────────────────────────────────────────
create table if not exists public."customer_orders" (
  "id" "uuid" default "gen_random_uuid"() not null,
  "order_no" "text" not null,
  "project_id" "uuid" not null,
  "document_group_id" "uuid" not null,
  "customer_company_id" "uuid" not null,
  "customer_site_id" "uuid" not null,
  "status" public."CustomerOrderStatus" default 'DRAFT'::public."CustomerOrderStatus" not null,
  "requested_delivery_at" timestamp(3) without time zone,
  "delivery_note" "text",
  "created_at" timestamp(3) without time zone default CURRENT_TIMESTAMP not null,
  "updated_at" timestamp(3) without time zone not null,
  constraint "customer_orders_pkey" primary key ("id"),
  constraint "customer_orders_customer_company_id_fkey" foreign key ("customer_company_id")
    references public."companies"("id") on update cascade on delete restrict,
  constraint "customer_orders_customer_site_id_fkey" foreign key ("customer_site_id")
    references public."customer_sites"("id") on update cascade on delete restrict,
  constraint "customer_orders_document_group_id_fkey" foreign key ("document_group_id")
    references public."document_groups"("id") on update cascade on delete restrict,
  constraint "customer_orders_project_id_fkey" foreign key ("project_id")
    references public."projects"("id") on update cascade on delete restrict
);

-- ── 7. invoices ─────────────────────────────────────────────────────────────
create table if not exists public."invoices" (
  "id" "uuid" default "gen_random_uuid"() not null,
  "invoice_no" "text" not null,
  "invoice_status" public."InvoiceStatus" default 'DRAFT'::public."InvoiceStatus" not null,
  "customer_company_id" "uuid" not null,
  "customer_order_id" "uuid",
  "project_id" "uuid",
  "invoice_date" timestamp(3) without time zone default CURRENT_TIMESTAMP not null,
  "due_date" timestamp(3) without time zone,
  "reference_no" "text",
  "recipient_address" "text",
  "notes" "text",
  "vat_rate" numeric(6,4) default 0.07 not null,
  "subtotal" numeric(14,2) not null,
  "vat_amount" numeric(14,2) not null,
  "total_amount" numeric(14,2) not null,
  "paid_amount" numeric(14,2) default 0 not null,
  "receipt_no" "text",
  "receipt_issued_at" timestamp(3) without time zone,
  "created_at" timestamp(3) without time zone default CURRENT_TIMESTAMP not null,
  "updated_at" timestamp(3) without time zone not null,
  constraint "invoices_pkey" primary key ("id"),
  constraint "invoices_customer_company_id_fkey" foreign key ("customer_company_id")
    references public."companies"("id") on update cascade on delete restrict,
  constraint "invoices_customer_order_id_fkey" foreign key ("customer_order_id")
    references public."customer_orders"("id") on update cascade on delete set null,
  constraint "invoices_project_id_fkey" foreign key ("project_id")
    references public."projects"("id") on update cascade on delete set null
);

-- ── 8. standalone_documents ─────────────────────────────────────────────────
create table if not exists public."standalone_documents" (
  "id" "uuid" default "gen_random_uuid"() not null,
  "document_no" "text" not null,
  "document_type" public."DocumentType" not null,
  "document_date" timestamp(3) without time zone not null,
  "customer_company_id" "uuid",
  "partner_company_id" "uuid",
  "project_id" "uuid",
  "customer_order_id" "uuid",
  "reference_no" "text",
  "recipient_address" "text",
  "notes" "text",
  "vat_rate" numeric(6,4) default 0.07 not null,
  "subtotal" numeric(14,2) not null,
  "vat_amount" numeric(14,2) not null,
  "total_amount" numeric(14,2) not null,
  "created_at" timestamp(3) without time zone default CURRENT_TIMESTAMP not null,
  "updated_at" timestamp(3) without time zone not null,
  constraint "standalone_documents_pkey" primary key ("id"),
  constraint "standalone_documents_customer_company_id_fkey" foreign key ("customer_company_id")
    references public."companies"("id") on update cascade on delete set null,
  constraint "standalone_documents_customer_order_id_fkey" foreign key ("customer_order_id")
    references public."customer_orders"("id") on update cascade on delete set null,
  constraint "standalone_documents_partner_company_id_fkey" foreign key ("partner_company_id")
    references public."companies"("id") on update cascade on delete set null,
  constraint "standalone_documents_project_id_fkey" foreign key ("project_id")
    references public."projects"("id") on update cascade on delete set null
);

-- ── 9. audit_logs ───────────────────────────────────────────────────────────
create table if not exists public."audit_logs" (
  "id" "uuid" default "gen_random_uuid"() not null,
  "actor_user_id" "uuid",
  "company_id" "uuid",
  "entity_type" "text" not null,
  "entity_id" "text",
  "action" "text" not null,
  "field" "text",
  "old_value" "text",
  "new_value" "text",
  "ip_address" "text",
  "user_agent" "text",
  "created_at" timestamp(3) without time zone default CURRENT_TIMESTAMP not null,
  constraint "audit_logs_pkey" primary key ("id"),
  constraint "audit_logs_company_id_fkey" foreign key ("company_id")
    references public."companies"("id") on update cascade on delete set null
);

-- ── 10. debt_snapshots ──────────────────────────────────────────────────────
create table if not exists public."debt_snapshots" (
  "id" "uuid" default "gen_random_uuid"() not null,
  "customer_company_id" "uuid" not null,
  "collection_state" public."CollectionState" default 'CURRENT'::public."CollectionState" not null,
  "total_outstanding" numeric(14,2) default 0 not null,
  "overdue_amount" numeric(14,2) default 0 not null,
  "days_overdue" integer default 0 not null,
  "open_invoice_count" integer default 0 not null,
  "last_refreshed_at" timestamp(3) without time zone default CURRENT_TIMESTAMP not null,
  "created_at" timestamp(3) without time zone default CURRENT_TIMESTAMP not null,
  "updated_at" timestamp(3) without time zone not null,
  "first_contact_at" timestamp(3) without time zone,
  "debt_start_at" timestamp(3) without time zone,
  "freeze_from" timestamp without time zone,
  "freeze_until" timestamp without time zone,
  "debt_type" "text",
  "legal_basis" "text",
  "reason" "text",
  "calculation_method" "text",
  "vat_status" "text",
  "document_type" "text",
  "remark" "text",
  "source_event_id" "uuid",
  constraint "debt_snapshots_pkey" primary key ("id"),
  constraint "debt_snapshots_customer_company_id_fkey" foreign key ("customer_company_id")
    references public."companies"("id") on update cascade on delete cascade,
  constraint "debt_snapshots_debt_type_check"
    check (("debt_type" = any (array['trade_receivable'::"text", 'collection_reminder'::"text", 'loan'::"text", 'damages'::"text"]))),
  constraint "debt_snapshots_document_type_check"
    check (("document_type" = any (array['invoice'::"text", 'collection_reminder_notice'::"text", 'unsupported'::"text"]))),
  constraint "debt_snapshots_vat_status_check"
    check (("vat_status" = any (array['vat_included'::"text", 'vat_not_applicable'::"text"])))
);

-- ── 11. Constraints for databases where the table already existed ───────────
-- `create table if not exists` is a no-op on such a database, so each key is
-- re-asserted here. Duplicates are swallowed; nothing is ever dropped.
do $$ begin
  alter table public."companies" add constraint "companies_pkey" primary key ("id");
exception when duplicate_object then null; when duplicate_table then null; when invalid_table_definition then null; end $$;
do $$ begin
  alter table public."customer_sites" add constraint "customer_sites_pkey" primary key ("id");
exception when duplicate_object then null; when duplicate_table then null; when invalid_table_definition then null; end $$;
do $$ begin
  alter table public."projects" add constraint "projects_pkey" primary key ("id");
exception when duplicate_object then null; when duplicate_table then null; when invalid_table_definition then null; end $$;
do $$ begin
  alter table public."document_groups" add constraint "document_groups_pkey" primary key ("id");
exception when duplicate_object then null; when duplicate_table then null; when invalid_table_definition then null; end $$;
do $$ begin
  alter table public."customer_orders" add constraint "customer_orders_pkey" primary key ("id");
exception when duplicate_object then null; when duplicate_table then null; when invalid_table_definition then null; end $$;
do $$ begin
  alter table public."invoices" add constraint "invoices_pkey" primary key ("id");
exception when duplicate_object then null; when duplicate_table then null; when invalid_table_definition then null; end $$;
do $$ begin
  alter table public."standalone_documents" add constraint "standalone_documents_pkey" primary key ("id");
exception when duplicate_object then null; when duplicate_table then null; when invalid_table_definition then null; end $$;
do $$ begin
  alter table public."audit_logs" add constraint "audit_logs_pkey" primary key ("id");
exception when duplicate_object then null; when duplicate_table then null; when invalid_table_definition then null; end $$;
do $$ begin
  alter table public."debt_snapshots" add constraint "debt_snapshots_pkey" primary key ("id");
exception when duplicate_object then null; when duplicate_table then null; when invalid_table_definition then null; end $$;

do $$ begin
  alter table public."customer_sites" add constraint "customer_sites_customer_company_id_fkey"
    foreign key ("customer_company_id") references public."companies"("id") on update cascade on delete cascade;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public."projects" add constraint "projects_customer_company_id_fkey"
    foreign key ("customer_company_id") references public."companies"("id") on update cascade on delete restrict;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public."projects" add constraint "projects_customer_site_id_fkey"
    foreign key ("customer_site_id") references public."customer_sites"("id") on update cascade on delete restrict;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public."document_groups" add constraint "document_groups_customer_company_id_fkey"
    foreign key ("customer_company_id") references public."companies"("id") on update cascade on delete restrict;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public."document_groups" add constraint "document_groups_project_id_fkey"
    foreign key ("project_id") references public."projects"("id") on update cascade on delete restrict;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public."customer_orders" add constraint "customer_orders_customer_company_id_fkey"
    foreign key ("customer_company_id") references public."companies"("id") on update cascade on delete restrict;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public."customer_orders" add constraint "customer_orders_customer_site_id_fkey"
    foreign key ("customer_site_id") references public."customer_sites"("id") on update cascade on delete restrict;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public."customer_orders" add constraint "customer_orders_document_group_id_fkey"
    foreign key ("document_group_id") references public."document_groups"("id") on update cascade on delete restrict;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public."customer_orders" add constraint "customer_orders_project_id_fkey"
    foreign key ("project_id") references public."projects"("id") on update cascade on delete restrict;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public."invoices" add constraint "invoices_customer_company_id_fkey"
    foreign key ("customer_company_id") references public."companies"("id") on update cascade on delete restrict;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public."invoices" add constraint "invoices_customer_order_id_fkey"
    foreign key ("customer_order_id") references public."customer_orders"("id") on update cascade on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public."invoices" add constraint "invoices_project_id_fkey"
    foreign key ("project_id") references public."projects"("id") on update cascade on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public."standalone_documents" add constraint "standalone_documents_customer_company_id_fkey"
    foreign key ("customer_company_id") references public."companies"("id") on update cascade on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public."standalone_documents" add constraint "standalone_documents_customer_order_id_fkey"
    foreign key ("customer_order_id") references public."customer_orders"("id") on update cascade on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public."standalone_documents" add constraint "standalone_documents_partner_company_id_fkey"
    foreign key ("partner_company_id") references public."companies"("id") on update cascade on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public."standalone_documents" add constraint "standalone_documents_project_id_fkey"
    foreign key ("project_id") references public."projects"("id") on update cascade on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public."audit_logs" add constraint "audit_logs_company_id_fkey"
    foreign key ("company_id") references public."companies"("id") on update cascade on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public."debt_snapshots" add constraint "debt_snapshots_customer_company_id_fkey"
    foreign key ("customer_company_id") references public."companies"("id") on update cascade on delete cascade;
exception when duplicate_object then null; end $$;

-- ── 12. Indexes (verbatim from the dump) ────────────────────────────────────
create index if not exists "audit_logs_action_idx" on public."audit_logs" using "btree" ("action");
create index if not exists "audit_logs_actor_user_id_idx" on public."audit_logs" using "btree" ("actor_user_id");
create index if not exists "audit_logs_company_id_idx" on public."audit_logs" using "btree" ("company_id");
create index if not exists "audit_logs_entity_type_entity_id_idx" on public."audit_logs" using "btree" ("entity_type", "entity_id");

create index if not exists "companies_line_user_id_idx" on public."companies" using "btree" ("line_user_id");

create index if not exists "customer_orders_customer_company_id_idx" on public."customer_orders" using "btree" ("customer_company_id");
create index if not exists "customer_orders_customer_site_id_idx" on public."customer_orders" using "btree" ("customer_site_id");
create index if not exists "customer_orders_document_group_id_idx" on public."customer_orders" using "btree" ("document_group_id");
create unique index if not exists "customer_orders_order_no_key" on public."customer_orders" using "btree" ("order_no");
create index if not exists "customer_orders_project_id_idx" on public."customer_orders" using "btree" ("project_id");
create index if not exists "customer_orders_status_idx" on public."customer_orders" using "btree" ("status");

create index if not exists "customer_sites_customer_company_id_idx" on public."customer_sites" using "btree" ("customer_company_id");

create unique index if not exists "debt_snapshots_customer_company_id_key" on public."debt_snapshots" using "btree" ("customer_company_id");

create index if not exists "document_groups_customer_company_id_idx" on public."document_groups" using "btree" ("customer_company_id");
create unique index if not exists "document_groups_group_no_key" on public."document_groups" using "btree" ("group_no");
create index if not exists "document_groups_project_id_idx" on public."document_groups" using "btree" ("project_id");
create index if not exists "document_groups_project_no_idx" on public."document_groups" using "btree" ("project_no");
create index if not exists "document_groups_root_order_no_idx" on public."document_groups" using "btree" ("root_order_no");
create index if not exists "document_groups_status_idx" on public."document_groups" using "btree" ("status");

create index if not exists "invoices_customer_company_id_idx" on public."invoices" using "btree" ("customer_company_id");
create index if not exists "invoices_customer_order_id_idx" on public."invoices" using "btree" ("customer_order_id");
create unique index if not exists "invoices_invoice_no_key" on public."invoices" using "btree" ("invoice_no");
create index if not exists "invoices_invoice_status_idx" on public."invoices" using "btree" ("invoice_status");
create index if not exists "invoices_project_id_idx" on public."invoices" using "btree" ("project_id");
create unique index if not exists "invoices_receipt_no_key" on public."invoices" using "btree" ("receipt_no");

create index if not exists "projects_customer_company_id_idx" on public."projects" using "btree" ("customer_company_id");
create index if not exists "projects_customer_site_id_idx" on public."projects" using "btree" ("customer_site_id");
create unique index if not exists "projects_project_no_key" on public."projects" using "btree" ("project_no");
create index if not exists "projects_status_idx" on public."projects" using "btree" ("status");

create index if not exists "standalone_documents_customer_company_id_idx" on public."standalone_documents" using "btree" ("customer_company_id");
create index if not exists "standalone_documents_customer_order_id_idx" on public."standalone_documents" using "btree" ("customer_order_id");
create unique index if not exists "standalone_documents_document_no_key" on public."standalone_documents" using "btree" ("document_no");
create index if not exists "standalone_documents_document_type_idx" on public."standalone_documents" using "btree" ("document_type");
create index if not exists "standalone_documents_partner_company_id_idx" on public."standalone_documents" using "btree" ("partner_company_id");
create index if not exists "standalone_documents_project_id_idx" on public."standalone_documents" using "btree" ("project_id");

-- ── 13. RLS (verbatim from the dump) ────────────────────────────────────────
-- Same deny-all + service_role_only pattern 20260709000001 re-applies to the
-- whole table list; idempotent here and there.
alter table public."audit_logs" enable row level security;
alter table public."companies" enable row level security;
alter table public."customer_orders" enable row level security;
alter table public."customer_sites" enable row level security;
alter table public."debt_snapshots" enable row level security;
alter table public."document_groups" enable row level security;
alter table public."invoices" enable row level security;
alter table public."projects" enable row level security;
alter table public."standalone_documents" enable row level security;

drop policy if exists "service_role_only" on public."audit_logs";
create policy "service_role_only" on public."audit_logs" for all using (false);
drop policy if exists "service_role_only" on public."companies";
create policy "service_role_only" on public."companies" for all using (false);
drop policy if exists "service_role_only" on public."customer_orders";
create policy "service_role_only" on public."customer_orders" for all using (false);
drop policy if exists "service_role_only" on public."customer_sites";
create policy "service_role_only" on public."customer_sites" for all using (false);
drop policy if exists "service_role_only" on public."debt_snapshots";
create policy "service_role_only" on public."debt_snapshots" for all using (false);
drop policy if exists "service_role_only" on public."document_groups";
create policy "service_role_only" on public."document_groups" for all using (false);
drop policy if exists "service_role_only" on public."invoices";
create policy "service_role_only" on public."invoices" for all using (false);
drop policy if exists "service_role_only" on public."projects";
create policy "service_role_only" on public."projects" for all using (false);
drop policy if exists "service_role_only" on public."standalone_documents";
create policy "service_role_only" on public."standalone_documents" for all using (false);
