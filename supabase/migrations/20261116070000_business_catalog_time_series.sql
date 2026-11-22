-- Business catalog model. adapter_id is an opaque UUID corresponding to
-- system.system_adapters.adapter_id in the same Supabase project. PostgreSQL
-- does not declare a foreign key across schemas.

create table if not exists public.catalog_products (
  product_id uuid primary key default gen_random_uuid(),
  adapter_id uuid not null,
  product_key text not null check (length(btrim(product_key)) between 1 and 240),
  name text not null check (length(btrim(name)) between 1 and 300),
  description text,
  category_key text,
  status text not null default 'active'
    check (status in ('active', 'inactive', 'archived')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (adapter_id, product_key),
  unique (product_id, adapter_id)
);

create index if not exists catalog_products_adapter_status_idx
  on public.catalog_products (adapter_id, status, product_key);

create table if not exists public.catalog_variants (
  variant_id uuid primary key default gen_random_uuid(),
  product_id uuid not null,
  adapter_id uuid not null,
  sku text not null check (length(btrim(sku)) between 1 and 240),
  name text,
  attributes jsonb not null default '{}'::jsonb
    check (jsonb_typeof(attributes) = 'object'),
  status text not null default 'active'
    check (status in ('active', 'inactive', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_variants_product_adapter_fk
    foreign key (product_id, adapter_id)
    references public.catalog_products (product_id, adapter_id)
    on update restrict on delete restrict,
  unique (adapter_id, sku),
  unique (variant_id, adapter_id)
);

create index if not exists catalog_variants_product_idx
  on public.catalog_variants (product_id, status);

create table if not exists public.catalog_price_kinds (
  price_kind_id uuid primary key default gen_random_uuid(),
  price_kind_key text not null unique
    check (price_kind_key ~ '^[a-z][a-z0-9_]{0,79}$'),
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  description text,
  created_at timestamptz not null default now()
);

insert into public.catalog_price_kinds (price_kind_key, display_name, description)
values
  ('retail', 'Retail', 'Retail price category.'),
  ('wholesale', 'Wholesale', 'Wholesale price category.')
on conflict (price_kind_key) do nothing;

create table if not exists public.catalog_variant_prices (
  variant_price_id uuid primary key default gen_random_uuid(),
  adapter_id uuid not null,
  variant_id uuid not null,
  price_kind_id uuid not null references public.catalog_price_kinds(price_kind_id)
    on update restrict on delete restrict,
  amount numeric(20, 6) not null check (amount >= 0),
  currency_code char(3) not null check (currency_code ~ '^[A-Z]{3}$'),
  valid_from timestamptz not null,
  valid_to timestamptz,
  source_reference text,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  recorded_at timestamptz not null default now(),
  constraint catalog_variant_prices_valid_window_ck
    check (valid_to is null or valid_to > valid_from),
  constraint catalog_variant_prices_variant_adapter_fk
    foreign key (variant_id, adapter_id)
    references public.catalog_variants (variant_id, adapter_id)
    on update restrict on delete restrict,
  unique (adapter_id, variant_id, price_kind_id, currency_code, valid_from)
);

create index if not exists catalog_variant_prices_asof_idx
  on public.catalog_variant_prices
    (adapter_id, variant_id, price_kind_id, currency_code, valid_from desc);

-- Enforce non-overlapping half-open [valid_from, valid_to) intervals per
-- adapter/variant/kind/currency, including concurrent inserts. New prices are
-- inserted as new rows; price history is never overwritten.
create or replace function public.guard_catalog_variant_price_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  lock_key text;
begin
  lock_key := concat_ws(':', new.adapter_id::text, new.variant_id::text,
                        new.price_kind_id::text, new.currency_code::text);
  perform pg_advisory_xact_lock(hashtextextended(lock_key, 0));

  if exists (
    select 1
    from public.catalog_variant_prices existing
    where existing.adapter_id = new.adapter_id
      and existing.variant_id = new.variant_id
      and existing.price_kind_id = new.price_kind_id
      and existing.currency_code = new.currency_code
      and tstzrange(existing.valid_from,
                    coalesce(existing.valid_to, 'infinity'::timestamptz), '[)')
          &&
          tstzrange(new.valid_from,
                    coalesce(new.valid_to, 'infinity'::timestamptz), '[)')
  ) then
    raise exception 'catalog price validity ranges cannot overlap'
      using errcode = '23P01';
  end if;

  return new;
end;
$$;

drop trigger if exists catalog_variant_prices_no_overlap on public.catalog_variant_prices;
create trigger catalog_variant_prices_no_overlap
before insert on public.catalog_variant_prices
for each row execute function public.guard_catalog_variant_price_insert();

create or replace function public.reject_catalog_variant_price_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'catalog_variant_prices is append-only; insert a new price row'
    using errcode = '55000';
end;
$$;

drop trigger if exists catalog_variant_prices_append_only on public.catalog_variant_prices;
create trigger catalog_variant_prices_append_only
before update or delete on public.catalog_variant_prices
for each row execute function public.reject_catalog_variant_price_mutation();

alter table public.catalog_products enable row level security;
alter table public.catalog_variants enable row level security;
alter table public.catalog_price_kinds enable row level security;
alter table public.catalog_variant_prices enable row level security;

revoke all on public.catalog_products from public, anon, authenticated;
revoke all on public.catalog_variants from public, anon, authenticated;
revoke all on public.catalog_price_kinds from public, anon, authenticated;
revoke all on public.catalog_variant_prices from public, anon, authenticated;
revoke all on function public.guard_catalog_variant_price_insert() from public, anon, authenticated;
revoke all on function public.reject_catalog_variant_price_mutation() from public, anon, authenticated;

grant select, insert, update on public.catalog_products to service_role;
grant select, insert, update on public.catalog_variants to service_role;
grant select on public.catalog_price_kinds to service_role;
grant select, insert on public.catalog_variant_prices to service_role;
grant usage, select on all sequences in schema public to service_role;

comment on table public.catalog_products is
  'Business catalog product master. adapter_id is an opaque UUID corresponding to system.system_adapters in the same Supabase project; no cross-schema FK is declared.';
comment on table public.catalog_variants is
  'Sellable SKU or option belonging to a catalog product and the same adapter scope.';
comment on table public.catalog_price_kinds is
  'Generic price categories such as retail and wholesale.';
comment on table public.catalog_variant_prices is
  'Append-only time-valid price history using non-overlapping half-open validity intervals.';
comment on column public.catalog_variant_prices.adapter_id is
  'Opaque UUID corresponding to system.system_adapters.adapter_id; intentionally not a cross-schema FK.';
