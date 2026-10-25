-- Integration Gateway proposals — allow the railway provider (Connect Core, owner, 2026-09-20).
--
-- Real gap this closes: engines/integration-gateway/contracts/event.ts's
-- GatewayProvider union has included 'railway' since the Railway observe adapter
-- landed (2026-09-18), and Connect Core's Owner-approval step now files a
-- 'connect.approval.requested' proposal for any provider whose contract declares
-- OWNER_REQUIRED (today: railway — engines/connectors/providers/railway.ts).
-- This table's provider CHECK (20260805000003_integration_gateway_proposals.sql
-- line 16) still lists only github/supabase/vercel/vscode/chatgpt-mcp, so the
-- proposal row was rejected by the database even though the event contract
-- allowed it — a real contract/DB mismatch found by reading both files.
--
-- The CHECK stays an explicit allow-list (the same discipline as
-- public.connectors.auth_type) instead of being dropped: the table is written
-- only by the service role, and an unknown provider must fail loudly rather than
-- be accepted silently. Consequence, stated honestly: adding another provider to
-- the Connect Core approval path needs one line here AND in the GatewayProvider
-- union. The alternative (widen to "provider <> ''" and rely on the contract
-- registry) is deliberately NOT taken in this migration.
--
-- Status: NOT APPLIED. This file is a draft for the Owner to review and run
-- (supabase db push / migration apply). Connect Core never applies migrations
-- on its own.

-- Constraint name is discovered rather than assumed (an inline table CHECK is
-- auto-named by Postgres, and a rename elsewhere would silently defeat a
-- hardcoded drop), and the block is idempotent: re-running drops and re-adds the
-- same single constraint.
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
  check (provider in ('github', 'supabase', 'vercel', 'railway', 'vscode', 'chatgpt-mcp'));

comment on constraint integration_gateway_proposals_provider_check on public.integration_gateway_proposals is
  'Explicit provider allow-list for integration_gateway_proposals (Connect Core Owner approvals + Automation proposals). Extend one line per new provider — see supabase/migrations/20260920000001_integration_gateway_proposals_allow_railway.sql.';
