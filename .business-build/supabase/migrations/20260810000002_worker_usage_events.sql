-- Worker Usage Meter (owner, 2026-08-10, DigitalOcean AI Inference
-- Infrastructure Control & Billing Layer). Real, per-call telemetry for
-- EVERY Worker Router dispatch (app/api/admin/ide/_lib/codeWorkerRuntime.ts,
-- generic — every real WorkerAdapter, not just DigitalOcean), regardless
-- of cost/status. Distinct from registry/COST_LEDGER.json (that file is
-- PAID/UNKNOWN_COST-only, cost-focused, append-only JSON, written by
-- costGateRuntime.ts#recordActualCost() — already real, already reused
-- unchanged) and distinct from executionBudgetRuntime.ts's in-memory
-- BudgetUsage Map (per-process, non-persistent, budget-enforcement only).
-- This table is the one real, persistent, queryable-over-time record of
-- every real dispatch, token count, latency, and outcome — checked first
-- (Rule 103/111): no existing table covers this shape.
create table if not exists public.worker_usage_events (
  id                uuid primary key default gen_random_uuid(),
  request_id        text not null,
  provider          text not null,
  service           text not null, -- the real WorkerRequest.capabilityRequired, e.g. "code.generate"
  model             text,
  adapter_id        text not null, -- real WorkerAdapter.id, e.g. "digitalocean-api"
  input_tokens      integer,        -- null = genuinely not reported by the provider — never estimated here
  output_tokens     integer,
  total_tokens      integer generated always as (
    case when input_tokens is not null and output_tokens is not null
      then input_tokens + output_tokens else null end
  ) stored,
  token_source      text not null default 'UNKNOWN'
    check (token_source in ('PROVIDER_REPORTED', 'UNKNOWN')),
  token_unknown_reason text, -- required context when token_source = 'UNKNOWN', never silently blank
  latency_ms        integer not null,
  status             text not null, -- real WorkerResponseStatus value, e.g. "SUCCEEDED" | "FAILED" | "TIMEOUT" | "NOT_CONFIGURED" ...
  error              text,
  started_at         timestamptz not null,
  completed_at       timestamptz not null,
  created_at         timestamptz not null default now()
);

comment on table public.worker_usage_events is
  'Real, append-only per-call usage telemetry for every Worker Router dispatch (codeWorkerRuntime.ts -> adapter.execute()). Provider-neutral: DigitalOcean, Anthropic, Ollama, RunPod-backed adapters all write the same shape. token_source=UNKNOWN + token_unknown_reason is the honest default when a provider genuinely does not report usage — never a guessed token count.';

create index if not exists worker_usage_events_provider_idx on public.worker_usage_events (provider, created_at desc);
create index if not exists worker_usage_events_request_id_idx on public.worker_usage_events (request_id);
create index if not exists worker_usage_events_status_idx on public.worker_usage_events (status);

alter table public.worker_usage_events enable row level security;

create policy service_role_only on public.worker_usage_events
  for all using (false);

create policy admin_workspace_read_worker_usage_events
  on public.worker_usage_events
  for select
  to authenticated
  using (public.is_admin_workspace_user());
