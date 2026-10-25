-- Security fix 2026-07-09: 54 public tables had RLS disabled with full anon/authenticated
-- CRUD grants (real debtor PII, admin sessions, financial data publicly writable/readable).
-- Applies the same service_role_only deny-all pattern already used by connectors/connector_webhook_events.
-- Service role (used by every real API route/edge function per grep) bypasses RLS automatically.
--
-- Local-migration bootstrap fix (owner, 2026-07-30, KM-007 —
-- registry/existence.json known_mistakes): this list is legacy Prisma-era
-- tables (see "_prisma_migrations", the first name in the list — this
-- system started on Prisma before moving to Supabase-native migrations).
-- At least one of these (supplier_inventory) was independently confirmed
-- this session to not exist in production at all anymore, via a live
-- `information_schema.tables` query — meaning this file likely could
-- never have replayed cleanly even against production from empty, and a
-- fresh local bootstrap would fail on the very first name. Rewritten as a
-- loop that only touches tables that actually exist — a real no-op change
-- in production for every table that's genuinely still there (RLS+policy
-- already applied), and safely skips whichever ones are already gone.
DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    '_prisma_migrations', 'admin_sessions', 'admins', 'alerts', 'app_sessions',
    'audit_logs', 'boq_items', 'boqs', 'collection_notes', 'companies',
    'company_members', 'customer_credit_profiles', 'customer_order_items',
    'customer_order_request_items', 'customer_order_requests', 'customer_orders',
    'customer_sites', 'debt_snapshots', 'delivery_proofs', 'dispute_status_history',
    'disputes', 'document_groups', 'document_references', 'invoice_items', 'invoices',
    'line_link_tokens', 'notifications', 'partner_product_submissions', 'payments',
    'price_histories', 'pricing_snapshot_items', 'pricing_snapshots', 'product_categories',
    'product_variants', 'products', 'projects', 'quotation_items', 'quotations',
    'settlement_batches', 'settlement_items', 'standalone_document_items',
    'standalone_documents', 'supplier_contract_items', 'supplier_contracts',
    'supplier_inventory', 'supplier_inventory_movements', 'supplier_products',
    'supplier_purchase_order_items', 'supplier_purchase_orders', 'transport_job_items',
    'transport_job_status_history', 'transport_jobs', 'user_identities', 'users'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    IF to_regclass('public.' || quote_ident(tbl)) IS NOT NULL THEN
      EXECUTE format('alter table public.%I enable row level security', tbl);
      EXECUTE format('drop policy if exists service_role_only on public.%I', tbl);
      EXECUTE format('create policy service_role_only on public.%I for all using (false)', tbl);
    END IF;
  END LOOP;
END $$;
