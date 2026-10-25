-- Migrating the real, live tables from the OTHER Supabase project
-- (tmxkiripdvorrcnuezvm) that the actually-connected LINE OA has been writing
-- to — discovered 2026-07-09 that this project, not xeytcavxejhyzxwevgto, is
-- where the real LINE bot + AI matching pipeline has been running (251 real
-- messages, 76 real partners, 10 active matches). Owner decided to consolidate
-- into this project (xeytcavxejhyzxwevgto). Schema copied as-is from the
-- source project — kept separate from companies/customer_orders (the newer
-- reorg schema already used by debt_snapshots this session) rather than
-- force-merged, since reconciling them is a real data decision, not a
-- mechanical one.

create table if not exists public.partners (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  code                  text,
  partner_type_id       text,
  partner_type_label    text,
  name                  text not null,
  tax_id                text,
  address               text,
  phone                 text,
  contact_name          text,
  role_name             text,
  bank_id               text,
  bank_label            text,
  bank_account_number   text,
  bank_account_name     text,
  notes                 text,
  created_by            uuid,
  updated_by            uuid,
  capabilities          jsonb,
  latitude              numeric,
  longitude             numeric,
  geom                  geometry,
  pit_profile_id        uuid
);

create table if not exists public.match_queue (
  id                uuid primary key default gen_random_uuid(),
  customer_line_id  text,
  customer_request  text,
  pit_id            uuid,
  driver_id         uuid,
  status            text,
  quoted_price      numeric,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz
);

create table if not exists public.job_vehicle_pricings (
  id                        uuid primary key default gen_random_uuid(),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  deleted_at                timestamptz,
  job_id                    uuid,
  job_vehicle_type_id       uuid,
  total_price               numeric,
  price_per_trip            numeric,
  material_cost_per_trip    numeric,
  fuel_cost_per_trip        numeric,
  profit_per_trip           numeric,
  system_fee_per_trip       numeric,
  tax_per_trip              numeric,
  trip_count                integer
);

create table if not exists public.line_sessions (
  id              uuid primary key default gen_random_uuid(),
  line_user_id    text not null,
  status          text,
  item            text,
  quantity        numeric,
  unit            text,
  contact_name    text,
  phone           text,
  address         text,
  turn_count      integer,
  draft_event_id  uuid,
  order_items     jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.line_draft_documents (
  id                    uuid primary key default gen_random_uuid(),
  event_id              uuid,
  doc_type              text,
  payload               jsonb,
  status                text,
  created_document_id   uuid,
  admin_note            text,
  approved_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists public.user_line_auth (
  user_id             uuid primary key,
  line_user_id        text not null,
  line_display_name   text,
  line_picture_url    text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists partners_name_idx on public.partners (name);
create index if not exists match_queue_status_idx on public.match_queue (status);
create index if not exists line_sessions_line_user_id_idx on public.line_sessions (line_user_id);
create index if not exists user_line_auth_line_user_id_idx on public.user_line_auth (line_user_id);

do $$
declare
  t text;
begin
  foreach t in array array['partners','match_queue','job_vehicle_pricings','line_sessions','line_draft_documents','user_line_auth']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists service_role_only on public.%I', t);
    execute format('create policy service_role_only on public.%I for all using (false)', t);
  end loop;
end $$;
