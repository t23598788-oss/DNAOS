-- Public publication registry (2026-10-24, owner convention corrected 2026-10-25)
-- — ADDITIVE, SOURCE ONLY.
--
-- STATUS: NOT APPLIED. Constraint (owner): no Production DB change without an
-- approved window. This file is the single central registry the public reader
-- (core/public-catalog/reader.ts) consults; it is NOT a copy of product data.
-- Every business fact still lives in its canonical source table:
--   pit_materials  (price per material per pit)     20260710000008:41
--   material_types (material name)                  20260710000001:10
--   pit_profiles   (supplier / plant, service area) 20260710000008:11
--   vehicle_types  (truck class, capacity)          20260710000008:51
--   equipment_assets                                20260724000004:16
--
-- WHY a new table instead of a column on each source table:
--   1. publication is a CROSS-CUTTING permission (who authorized it, what may
--      be shown, when it expires, which trace proves it) — not a property of a
--      price row;
--   2. source tables are already service_role_only (RLS using(false),
--      20260710000008:69-72) and are written by admin routes; adding an
--      is_public boolean there would put the public surface inside a
--      financial table with no audit trail;
--   3. one row per (source_table, source_record_id) keeps DEFAULT DENY trivial:
--      no row => not public, whatever the source says.
--
-- DEFAULT DENY is enforced three ways:
--   a. no anon/authenticated policy at all => RLS denies everything
--      (service_role bypasses RLS; only the server reader uses it);
--   b. the reader additionally filters status='published' AND (expires_at IS NULL
--      OR expires_at > now());
--   c. the reader may only emit fields listed in allowed_public_fields.
--
-- Rollback: drop table public.publication_records;  (no source table altered)

create table if not exists public.publication_records (
  id                    uuid primary key default gen_random_uuid(),

  -- the canonical source this row publishes (reference, never a copy)
  source_table          text not null,
  source_record_id      uuid not null,
  constraint publication_source_table_known check (
    source_table in ('pit_materials', 'material_types', 'vehicle_types', 'equipment_assets')
  ),

  -- canonical owner of the record, in one of exactly two shapes:
  --   'pit:<pit_profiles.id>'  a material price is owned by the plant it
  --                            belongs to (pit_materials.pit_profile_id)
  --   'platform'               a resource whose table has NO owner column:
  --                            material_types, vehicle_types,
  --                            equipment_assets (column census, real DB,
  --                            2026-10-25 — none of them has company_id /
  --                            partner_id / owner_id). The platform owner
  --                            publishes those; no organisation is invented.
  -- The reader re-derives the owner from the source row and rejects any
  -- mismatch (core/public-catalog/policy.ownerAccepted), so this value can
  -- never grant publication to somebody else's price row.
  organization_owner    text not null,

  -- explicit field whitelist. Empty = nothing may be shown even when published.
  -- Known public-safe keys: name, category, spec, unit, price, currency,
  -- supplier_name, service_area, coordinates, image_url, contact_url,
  -- procurement, updated_at
  --   service_area = parsed จังหวัด/อำเภอ ONLY (never the raw street address)
  --   coordinates  = lat/lng; a pit's GPS is internal by default
  allowed_public_fields text[] not null default '{}',

  status                text not null default 'draft',
  constraint publication_status_known check (status in ('draft', 'published', 'expired', 'withdrawn')),

  -- who allowed publication and who verified the facts/price
  authorized_by         text not null,
  verified_by           text,
  verified_at           timestamptz,

  published_at          timestamptz,
  expires_at            timestamptz,
  updated_at            timestamptz not null default now(),
  created_at            timestamptz not null default now(),

  -- permanent public URL
  public_slug           text not null,
  public_url            text,
  constraint publication_slug_shape check (public_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),

  -- provenance: evidence payload + trace id (never a secret, never PII)
  evidence              jsonb not null default '{}'::jsonb,
  trace_id              text,

  constraint publication_published_has_timestamp check (
    status <> 'published' or published_at is not null
  ),
  constraint publication_one_per_source unique (source_table, source_record_id),
  constraint publication_slug_unique unique (public_slug)
);

create index if not exists publication_records_live_idx
  on public.publication_records (status, expires_at);
create index if not exists publication_records_source_idx
  on public.publication_records (source_table, source_record_id);

alter table public.publication_records enable row level security;

-- Deliberately NO policy for anon/authenticated: RLS then denies all client
-- access. The only reader is core/public-catalog/reader.ts on the server with
-- service_role, and it filters status/expiry/field-whitelist on every request.
revoke all on public.publication_records from anon, authenticated;

-- Audit trail of permission changes (append-only). Kept separate so the live
-- registry row stays small and every transition is provable.
create table if not exists public.publication_events (
  id                    uuid primary key default gen_random_uuid(),
  publication_record_id uuid not null references public.publication_records(id) on delete cascade,
  from_status           text,
  to_status             text not null,
  actor                 text not null,
  reason                text,
  evidence              jsonb not null default '{}'::jsonb,
  trace_id              text,
  created_at            timestamptz not null default now()
);

create index if not exists publication_events_record_idx
  on public.publication_events (publication_record_id, created_at desc);

alter table public.publication_events enable row level security;
revoke all on public.publication_events from anon, authenticated;
