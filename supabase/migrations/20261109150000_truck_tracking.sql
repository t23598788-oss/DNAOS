-- Real-time order & truck tracking (2026-11-09).
--
-- Owner wants a "Grab-like" view of every order: from creation, through the
-- job broadcast, to the truck arriving at the customer site. This migration
-- adds the two pieces that make the stream unbroken:
--
--   truck_jobs    one row per dispatched job (order -> truck -> driver)
--   truck_events  append-only event stream, one row per state change
--
-- The strict state machine is enforced in the tracking worker
-- (engines/integration-gateway/workers/truck-tracker.ts); the checks below
-- guard the same vocabulary at the storage layer.

-- 1. Jobs — who is carrying which order, and where it is right now.
create table if not exists public.truck_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.customer_orders (id) on delete cascade,
  assigned_truck_id text,
  assigned_driver_id text,
  current_status text not null default 'BROADCASTED'
    check (current_status in (
      'BROADCASTED',
      'ACCEPTED',
      'EN_ROUTE_TO_PICKUP',
      'PICKED_UP',
      'EN_ROUTE_TO_CUSTOMER',
      'AT_SITE',
      'DELIVERED'
    )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_truck_jobs_order
  on public.truck_jobs (order_id);
create index if not exists idx_truck_jobs_status
  on public.truck_jobs (current_status);
create index if not exists idx_truck_jobs_truck
  on public.truck_jobs (assigned_truck_id)
  where assigned_truck_id is not null;

-- 2. Event stream — append-only, one row per state change.
--    metadata carries GPS coordinates, photo URLs and free-form notes.
create table if not exists public.truck_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.truck_jobs (id) on delete cascade,
  event_type text not null
    check (event_type in (
      'JOB_BROADCASTED',
      'JOB_ACCEPTED',
      'EN_ROUTE_TO_PICKUP',
      'PICKED_UP',
      'EN_ROUTE_TO_CUSTOMER',
      'AT_SITE',
      'DELIVERED'
    )),
  actor_id text not null default 'system',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_truck_events_job
  on public.truck_events (job_id, created_at);
create index if not exists idx_truck_events_created_at
  on public.truck_events (created_at desc);
