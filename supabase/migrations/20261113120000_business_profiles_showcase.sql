-- BUSINESS PROFILES + SHOWCASE SCHEMA — 2026-11-13
-- Independent channel-safe business profile, catalog, product, media showcase,
-- and timeline post tables for the central business showcase UI.

create extension if not exists "pgcrypto";

-- 1. business_profiles
create table if not exists public.business_profiles (
  id uuid primary key default gen_random_uuid(),
  company_name varchar(255) not null,
  business_type varchar(100),
  verified_status boolean not null default false,
  channel_origin varchar(50),
  created_at timestamptz not null default now()
);

create index if not exists idx_business_profiles_business_type
  on public.business_profiles (business_type);
create index if not exists idx_business_profiles_channel_origin
  on public.business_profiles (channel_origin);

-- 2. catalogs
create table if not exists public.catalogs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles (id)
    on update cascade on delete cascade,
  title varchar(255) not null,
  description text,
  created_at timestamptz not null default now()
);

create index if not exists idx_catalogs_business_id
  on public.catalogs (business_id);

-- 3. products
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  catalog_id uuid references public.catalogs (id)
    on update cascade on delete set null,
  business_id uuid not null references public.business_profiles (id)
    on update cascade on delete cascade,
  name varchar(255) not null,
  specs jsonb not null default '{}'::jsonb,
  price numeric(18,2),
  status varchar(50) not null default 'AVAILABLE',
  created_at timestamptz not null default now(),
  constraint products_status_check check (
    status in ('AVAILABLE', 'OUT_OF_STOCK', 'CUSTOM_ORDER')
  )
);

create index if not exists idx_products_catalog_id
  on public.products (catalog_id);
create index if not exists idx_products_business_id
  on public.products (business_id);
create index if not exists idx_products_status
  on public.products (status);

-- 4. media_showcases
create table if not exists public.media_showcases (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles (id)
    on update cascade on delete cascade,
  product_id uuid references public.products (id)
    on update cascade on delete set null,
  media_type varchar(50) not null,
  media_url text not null,
  thumbnail_url text,
  caption text,
  created_at timestamptz not null default now(),
  constraint media_showcases_media_type_check check (
    media_type in ('IMAGE', 'VIDEO', 'WORK_SITE_REVIEW', 'DOCUMENT')
  )
);

create index if not exists idx_media_showcases_business_id
  on public.media_showcases (business_id);
create index if not exists idx_media_showcases_product_id
  on public.media_showcases (product_id);
create index if not exists idx_media_showcases_media_type
  on public.media_showcases (media_type);

-- 5. business_timeline_posts
create table if not exists public.business_timeline_posts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles (id)
    on update cascade on delete cascade,
  content text,
  metadata jsonb not null default '{}'::jsonb,
  posted_at timestamptz not null default now()
);

create index if not exists idx_business_timeline_posts_business_id
  on public.business_timeline_posts (business_id);
create index if not exists idx_business_timeline_posts_posted_at
  on public.business_timeline_posts (posted_at desc);

-- Access control
alter table public.business_profiles enable row level security;
alter table public.catalogs enable row level security;
alter table public.products enable row level security;
alter table public.media_showcases enable row level security;
alter table public.business_timeline_posts enable row level security;

comment on table public.business_profiles is
  'Business profile / company identity for showcase and partner discovery.';
comment on table public.catalogs is
  'Product/service catalogs owned by a business profile.';
comment on table public.products is
  'Products/services with specs and pricing for a business profile.';
comment on table public.media_showcases is
  'Images, videos, work-site reviews, and documents showcased by a business.';
comment on table public.business_timeline_posts is
  'Historical posts / digital footprint timeline for a business profile.';