-- DigitalOcean catalog, request meter, and daily billing reconciliation.
-- Additive; do not apply until the target Supabase project is confirmed.

create table if not exists public.do_catalog (
  id uuid primary key default gen_random_uuid(),
  resource_type text not null check (resource_type in ('droplet_size', 'one_click_app', 'database_option')),
  resource_key text not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  unique (resource_type, resource_key)
);

create index if not exists do_catalog_fetched_at_idx on public.do_catalog (fetched_at desc);
alter table public.do_catalog enable row level security;
revoke all on public.do_catalog from anon, authenticated;
grant all on public.do_catalog to service_role;

create table if not exists public.do_usage_events (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  request_id text not null,
  method text not null,
  api_path text not null,
  operation text not null,
  status_code integer,
  outcome text not null check (outcome in ('succeeded', 'failed', 'blocked')),
  latency_ms integer,
  estimated_resource_cost_usd numeric(14,6) not null default 0,
  response_bytes bigint,
  error_code text,
  created_at timestamptz not null default now()
);

create index if not exists do_usage_events_created_idx on public.do_usage_events (created_at desc);
create index if not exists do_usage_events_operation_idx on public.do_usage_events (operation, created_at desc);
alter table public.do_usage_events enable row level security;
revoke all on public.do_usage_events from anon, authenticated;
grant all on public.do_usage_events to service_role;

create table if not exists public.do_billing_reconciliations (
  id uuid primary key default gen_random_uuid(),
  run_key text not null unique,
  account_urn text not null,
  period_start date not null,
  period_end date not null,
  account_balance_usd numeric(14,6),
  prepayment_balance_usd numeric(14,6),
  prepayment_blocked boolean,
  month_to_date_balance_usd numeric(14,6),
  month_to_date_usage_usd numeric(14,6),
  provider_insights_total_usd numeric(14,6),
  gateway_estimated_cost_usd numeric(14,6) not null default 0,
  variance_usd numeric(14,6),
  variance_basis text not null default 'aggregate_only_not_per_request_attribution',
  billing_history jsonb not null default '[]'::jsonb,
  sku_insights jsonb not null default '[]'::jsonb,
  status text not null check (status in ('matched', 'discrepancy', 'incomplete', 'failed')),
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists do_billing_reconciliations_period_idx
  on public.do_billing_reconciliations (period_end desc, created_at desc);
alter table public.do_billing_reconciliations enable row level security;
revoke all on public.do_billing_reconciliations from anon, authenticated;
grant all on public.do_billing_reconciliations to service_role;

comment on table public.do_catalog is 'Latest DigitalOcean catalog snapshot per resource type/key; payload is provider response data and fetched_at is the refresh timestamp.';
comment on table public.do_usage_events is 'Append-only idempotent log of DigitalOcean API calls routed through the DNA OS metering gateway. It records API requests, not direct provider resource charges.';
comment on table public.do_billing_reconciliations is 'Daily aggregate reconciliation of provider billing history/insights against explicitly estimated gateway resource cost; provider billing is not attributable to individual API calls.';
