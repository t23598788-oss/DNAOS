-- Partner Self-Service Portal — token-scoped access + price offers.
--
-- Owner expansion 2026-11-11. A partner (pit / supplier) opens a token link and
-- sees ONLY its own deliveries, stock and price offers. The token is the
-- authority; there is no partner login account.
--
--   1. public.partner_portal_tokens
--      token_hash = sha256(raw token). The raw token is returned exactly once
--      by the issuer and never stored. Scopes are a closed allow-list.
--      expires_at is mandatory (no perpetual links).
--
--   2. public.partner_portal_price_offers
--      A partner never writes pit_materials directly (price authority is
--      canonical). It records an OFFER; an admin decision route applies it
--      through engines/canonical/material-price-write.ts#applyMaterialPrice
--      with the real admin actor, so authority resolution still happens.
--
-- Status: APPLIED 2026-11-11 to the linked project (supabase db query, then
-- migration repair --status applied). Verified post-apply: both tables + RLS
-- exist and are service_role-only; they were new, so no partner data moved.

create table if not exists public.partner_portal_tokens (
  id                          uuid primary key default gen_random_uuid(),
  partner_business_profile_id uuid not null
                                references public.partner_business_profiles (id)
                                on update cascade on delete cascade,
  token_hash                  text not null unique,
  label                       text,
  scopes                      text[] not null default '{read}'
                                check (scopes <@ array['read','orders:read','debt:read','stock:read','price:propose']::text[]),
  expires_at                  timestamptz not null,
  revoked_at                  timestamptz,
  created_by                  text not null,
  last_used_at                timestamptz,
  created_at                  timestamptz not null default now()
);

create index if not exists partner_portal_tokens_partner_idx
  on public.partner_portal_tokens (partner_business_profile_id, created_at desc);

alter table public.partner_portal_tokens enable row level security;
drop policy if exists service_role_only on public.partner_portal_tokens;
create policy service_role_only on public.partner_portal_tokens for all using (false);

create table if not exists public.partner_portal_price_offers (
  id                          uuid primary key default gen_random_uuid(),
  token_id                    uuid references public.partner_portal_tokens (id) on delete set null,
  partner_business_profile_id uuid not null
                                references public.partner_business_profiles (id)
                                on update cascade on delete cascade,
  pit_profile_id              uuid not null references public.pit_profiles (id) on delete cascade,
  material_type_id            uuid not null references public.material_types (id) on delete restrict,
  proposed_price              numeric not null check (proposed_price > 0),
  note                        text,
  status                      text not null default 'pending'
                                check (status in ('pending', 'approved', 'rejected')),
  decided_by                  text,
  decided_at                  timestamptz,
  applied_price_id            text,
  error                       text,
  created_at                  timestamptz not null default now()
);

create index if not exists partner_portal_price_offers_status_idx
  on public.partner_portal_price_offers (status, created_at desc);
create index if not exists partner_portal_price_offers_partner_idx
  on public.partner_portal_price_offers (partner_business_profile_id, created_at desc);

alter table public.partner_portal_price_offers enable row level security;
drop policy if exists service_role_only on public.partner_portal_price_offers;
create policy service_role_only on public.partner_portal_price_offers for all using (false);

comment on table public.partner_portal_tokens is
  'Token-scoped partner access. Stores only sha256(token); raw token is returned once at issue time. Expiry is mandatory.';
comment on table public.partner_portal_price_offers is
  'A partner price OFFER from the self-service portal. Price changes still go through the canonical material-price writer after an admin decision.';
