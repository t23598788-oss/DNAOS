-- Fuel Price Auto-Sync (owner, 2026-07-24): "เฮียจะเอา AI มาดึงเว็บจากปั๊ม
-- น้ำมันจริงๆ ภายใน 24 ชั่วโมง...โดยที่มนุษย์ไม่ต้องมานั่งระบุ" — replaces a
-- human manually typing app_configs['fuel-price'] with a real daily fetch
-- from a real, live, keyless public source (Bangchak's public retail oil
-- price API, verified live 2026-07-24: https://oil-price.bangchak.co.th/
-- ApiOilPrice2/en returns real JSON, no auth required). This table is the
-- audit trail Rule 109 (verify before trusting) requires — every fetch is
-- logged with its real source and timestamp, never silently overwritten.
--
-- Scope note (honest, not overclaimed): this is a NATIONAL/brand-level
-- reference price (same across Bangchak's stations in a pricing zone), not
-- a per-individual-partner-gas-station price. The owner's fuller idea (GPS-
-- matched partner stations + comparing against real fuel_bill OCR receipts)
-- needs a separate gas-station-partner registry + extending ocr-classify.ts
-- to extract liters/price-per-liter (today it only extracts a total
-- `amount`) — flagged as a real next phase, not built in this migration.
create table if not exists public.fuel_price_log (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'bangchak',
  oil_name text not null,
  price numeric not null,
  effective_date text,
  fetched_at timestamptz not null default now()
);

create index if not exists fuel_price_log_fetched_at_idx on public.fuel_price_log (fetched_at desc);

alter table public.fuel_price_log enable row level security;
drop policy if exists service_role_only on public.fuel_price_log;
create policy service_role_only on public.fuel_price_log for all using (false);
