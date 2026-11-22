-- Forward-compatible increment for environments that already applied the
-- initial DO metering migration before regions, invoices, and request pacing.

alter table public.do_catalog drop constraint if exists do_catalog_resource_type_check;
alter table public.do_catalog add constraint do_catalog_resource_type_check
  check (resource_type in ('droplet_size', 'one_click_app', 'database_option', 'region'));

create table if not exists public.do_billing_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_uuid text not null unique,
  invoice_id text,
  invoice_period text,
  amount_usd numeric(14,6),
  updated_at timestamptz,
  is_preview boolean not null default false,
  safe_summary jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now()
);
create index if not exists do_billing_invoices_period_idx on public.do_billing_invoices (invoice_period desc, fetched_at desc);
alter table public.do_billing_invoices enable row level security;
revoke all on public.do_billing_invoices from anon, authenticated;
grant all on public.do_billing_invoices to service_role;

create table if not exists public.do_api_rate_limit_state (
  limiter_key text primary key check (limiter_key = 'digitalocean'),
  next_request_at timestamptz not null default now()
);
insert into public.do_api_rate_limit_state (limiter_key, next_request_at)
values ('digitalocean', now()) on conflict (limiter_key) do nothing;
alter table public.do_api_rate_limit_state enable row level security;
revoke all on public.do_api_rate_limit_state from public, anon, authenticated;
grant all on public.do_api_rate_limit_state to service_role;

create or replace function public.do_rate_limit_reserve_slot(p_interval_milliseconds integer default 750)
returns table(permit_at timestamptz)
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_next timestamptz;
  v_permit timestamptz;
begin
  if p_interval_milliseconds < 720 or p_interval_milliseconds > 60000 then
    raise exception 'RATE_LIMIT_INTERVAL_INVALID' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('digitalocean-rate-limit'));
  select s.next_request_at into v_next
    from public.do_api_rate_limit_state s where s.limiter_key = 'digitalocean' for update;
  v_permit := greatest(clock_timestamp(), coalesce(v_next, clock_timestamp()));
  update public.do_api_rate_limit_state
    set next_request_at = v_permit + (p_interval_milliseconds * interval '1 millisecond')
    where limiter_key = 'digitalocean';
  return query select v_permit;
end;
$$;

create or replace function public.do_rate_limit_defer(p_until timestamptz)
returns void
language plpgsql security definer set search_path = pg_catalog, public
as $$
begin
  if p_until is null or p_until > now() + interval '1 hour' then
    raise exception 'RATE_LIMIT_DEFER_INVALID' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('digitalocean-rate-limit'));
  update public.do_api_rate_limit_state
    set next_request_at = greatest(next_request_at, p_until)
    where limiter_key = 'digitalocean';
end;
$$;

revoke all on function public.do_rate_limit_reserve_slot(integer) from public, anon, authenticated;
grant execute on function public.do_rate_limit_reserve_slot(integer) to service_role;
revoke all on function public.do_rate_limit_defer(timestamptz) from public, anon, authenticated;
grant execute on function public.do_rate_limit_defer(timestamptz) to service_role;

comment on table public.do_api_rate_limit_state is 'Shared serialized DO request queue paced at 750ms per request (4,800/hour and 80/minute), leaving headroom under provider limits.';
comment on table public.do_billing_invoices is 'DigitalOcean invoice identifiers and sanitized financial summary; excludes customer name, email, and billing address.';
