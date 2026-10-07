-- ============================================================================
-- PROPOSED provider allow-list expansion for Meta messaging receive
-- (owner channel-expansion, 2026-10-07) — **DRAFT / NOT APPLIED**
--
-- WHY: app/api/gateway/observe/meta/route.ts + engines/integration-gateway/
-- adapters/meta.ts receive Facebook Messenger (object "page") and Instagram
-- Messaging (object "instagram") through the SAME Connect observe ingress as
-- LINE/GitHub/etc. The integration_gateway_events.provider CHECK is an
-- explicit allow-list (see 20260923000002_gateway_allow_line_provider.sql) —
-- 'facebook' and 'instagram' must be added there before the first real Meta
-- webhook can persist evidence.
--
-- IMPACT (proposed WITH impact, per owner instruction — before touching the
-- real database):
--   * additive: two new enum values in one CHECK constraint — no table/column
--     change, no data rewrite, no backfill, existing rows untouched
--   * publish() of a Meta event FAILS (route returns 500, Meta retries) until
--     this is applied — fail-closed by design, no partial writes
--   * readers (gateway event list/UI) display provider as text — new values
--     render without code change
--   * rollback: re-run the same drop/add with the previous value list
--   * NO other CHECK in the repo gates provider values for this path (checked
--     2026-10-07: only integration_gateway_events)
--
-- RELEASE ORDER: apply this migration FIRST, then deploy/enable the Meta
-- observe endpoint (migration-before-code, same discipline as
-- 20260923000003_connect_external_identity.sql). NOT APPLIED by this change —
-- owner reviews and runs it explicitly.
-- ============================================================================

do $$
declare
  c text;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.integration_gateway_events'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%provider%'
  loop
    execute format('alter table public.integration_gateway_events drop constraint %I', c);
  end loop;
end $$;

alter table public.integration_gateway_events
  add constraint integration_gateway_events_provider_check
  check (provider in ('github', 'supabase', 'vercel', 'railway', 'vscode', 'chatgpt-mcp', 'line', 'facebook', 'instagram'));

comment on constraint integration_gateway_events_provider_check on public.integration_gateway_events is
  'Explicit provider allow-list for integration_gateway_events. Extend one line per new provider — see supabase/migrations/20260923000002_gateway_allow_line_provider.sql and 20261007000001_propose_meta_gateway_providers.sql.';
