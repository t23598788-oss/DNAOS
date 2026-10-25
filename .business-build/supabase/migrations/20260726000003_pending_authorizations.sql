-- Team collaboration without a LINE group (owner, 2026-07-26): "ใช้งานกลุ่ม
-- ร่วมกันโดยไม่ต้องตั้งกลุ่ม...ถ้ามีการอ้างอิงหาบุคคลที่สาม...ระบบจะยิงคำถาม
-- ไปหาคนที่มีหน้าที่รับผิดชอบเสมอ...ยืนยันตัวตนผ่านมนุษย์ที่ยืนยันตัวตน
-- พิมพ์กลับมา ถ้าไม่มีแบบนี้มันจะเป็นช่องโหว่ในการโกหกหลอกลวง" — real fraud
-- prevention: company_line_links already records the first/real linked
-- person per company (owner: "คนแรกที่ทักมาจากบริษัทคือคนรับผิดชอบอัตโนมัติ")
-- — this table holds a pending request from someone claiming authority from
-- that real person, until the real person confirms it themselves in their
-- own real chat. Never auto-approved by the claimant's own words alone.
create table if not exists public.pending_authorizations (
  id uuid primary key default gen_random_uuid(),
  -- Local-migration bootstrap fix (owner, 2026-07-30, KM-007 —
  -- registry/existence.json known_mistakes): public.companies has no
  -- CREATE TABLE anywhere in this migration history (legacy, off-record).
  -- FK dropped entirely. No-op change in production.
  company_id uuid not null,
  claimant_line_user_id text not null,
  claimant_description text,
  request_description text not null,
  responsible_line_user_id text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied', 'expired')),
  business_event_id uuid,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists pending_authorizations_status_idx on public.pending_authorizations (status);

alter table public.pending_authorizations enable row level security;

create policy service_role_only on public.pending_authorizations
  for all using (false);
