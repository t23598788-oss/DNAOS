-- Integration Gateway — allow the LINE provider in the gateway event/proposal
-- allow-lists (capability A of the provider-retreat line, 2026-09-23).
--
-- Real gap this closes: engines/integration-gateway/contracts/event.ts now
-- includes 'line' in the GatewayProvider union and
-- engines/integration-gateway/adapters/line.ts emits provider='line' events
-- through app/api/gateway/observe/line/route.ts -> event-bus/bus.ts ->
-- evidence/store.ts (upsert into integration_gateway_events). This table's
-- provider CHECK (20260805000002_integration_gateway_observe.sql:15) still
-- lists only github/supabase/vercel/vscode/chatgpt-mcp, so the very first real
-- LINE event would be rejected by the database even though the contract allows
-- it — the same contract/DB mismatch class 20260920000001 fixed for
-- integration_gateway_proposals.
--
-- The proposals table needs the same one-word extension because Connect Core
-- now declares engines/connectors/providers/line.ts with
-- approvalRequirement OWNER_REQUIRED: the Owner-approval step files a
-- 'connect.approval.requested' proposal whose provider column carries the same
-- id.
--
-- ALSO INCLUDED, stated separately so it can be dropped if the Owner prefers:
-- 'railway' is added to integration_gateway_events' allow-list. That is a
-- pre-existing defect found while reading this constraint, not part of the LINE
-- work: the railway adapter + observe ingress landed 2026-09-18 and the
-- GatewayProvider union has included 'railway' since, but no migration ever
-- extended THIS table's CHECK (20260920000001 only fixed the proposals table),
-- so a real Railway webhook would fail its evidence insert with a CHECK
-- violation. Reviewer: delete 'railway' from the list below to keep this
-- migration strictly LINE-scoped.
--
-- The CHECK stays an explicit allow-list (same discipline as
-- public.connectors.auth_type) instead of being dropped or widened to
-- "provider <> ''": the tables are written only by the service role, and an
-- unknown provider must fail loudly. Consequence, stated honestly: every new
-- provider needs one line here AND in the GatewayProvider union.
--
-- Status: NOT APPLIED. Draft for the Owner to review and run (supabase db push /
-- migration apply). No capability in this repo applies migrations on its own.
-- Until it is applied, the LINE observe path fails closed at the evidence write
-- (publish() returns ok:false -> the ingress answers 500) — never silently.

-- Constraint names are discovered rather than assumed (inline table CHECKs are
-- auto-named by Postgres, and a rename elsewhere would silently defeat a
-- hardcoded drop); each block is idempotent and touches only provider-shaped
-- CHECKs.
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
end
$$;

alter table public.integration_gateway_events
  add constraint integration_gateway_events_provider_check
  check (provider in ('github', 'supabase', 'vercel', 'railway', 'vscode', 'chatgpt-mcp', 'line'));

comment on constraint integration_gateway_events_provider_check on public.integration_gateway_events is
  'Explicit provider allow-list for integration_gateway_events. Extend one line per new provider — see supabase/migrations/20260923000002_gateway_allow_line_provider.sql.';

do $$
declare
  c text;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.integration_gateway_proposals'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%provider%'
  loop
    execute format('alter table public.integration_gateway_proposals drop constraint %I', c);
  end loop;
end
$$;

alter table public.integration_gateway_proposals
  add constraint integration_gateway_proposals_provider_check
  check (provider in ('github', 'supabase', 'vercel', 'railway', 'vscode', 'chatgpt-mcp', 'line'));

comment on constraint integration_gateway_proposals_provider_check on public.integration_gateway_proposals is
  'Explicit provider allow-list for integration_gateway_proposals (Connect Core Owner approvals + Automation proposals). Extend one line per new provider — see supabase/migrations/20260923000002_gateway_allow_line_provider.sql.';
