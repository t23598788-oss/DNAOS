-- Multi-storefront LINE (owner, 2026-07-25): "ใช้บัญชี LINE บัญชีเดียวเป็น
-- บัญชีหลัก แต่แยกหน้าร้าน LINE ที่จะไปโฆษณายิงแอดเข้ากลุ่มหมู่บ้าน...รับเข้า
-- ช่องทางเดียว แต่ส่งออกกระจายไปตามกลุ่มมัน" — multiple real LINE Official
-- Accounts (different profile picture/persona per audience, e.g. the main
-- gravel-business account vs a village-photocopy-shop storefront) can all
-- point their webhook URL at this same Supabase Edge Function. LINE's
-- webhook payload carries `destination` (the receiving channel's numeric
-- ID) — this table maps that ID to the right channel_secret (to verify the
-- signature) and channel_access_token (to reply through the SAME account
-- the customer actually messaged, not always the main one). Extends the
-- existing single-channel env-var setup (LINE_CHANNEL_SECRET/
-- LINE_CHANNEL_ACCESS_TOKEN) rather than replacing it — a destination with
-- no matching row here falls back to the env vars, so the existing main
-- account keeps working with zero DB rows required.
create table if not exists public.line_channels (
  channel_id text primary key,
  channel_secret text not null,
  channel_access_token text not null,
  label text not null,
  created_at timestamptz not null default now()
);

alter table public.line_channels enable row level security;

create policy service_role_only on public.line_channels
  for all using (false);
