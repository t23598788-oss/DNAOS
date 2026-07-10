-- app_configs: generic key-value store for business config (company settings, pricing rules, etc.)
-- Required by core/config-loader.ts — every document/pricing calculation reads from this table
-- with no hardcoded fallback (ห้าม hardcode ข้อมูลธุรกิจ). Table was missing entirely in
-- production, which made every document-creation call (loadCompanySettings → loadConfigs)
-- throw "Could not find the table 'public.app_configs'".

create table if not exists public.app_configs (
  title text primary key,
  data text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_configs enable row level security;

-- อ่านได้แบบ public (ตรงกับ comment ใน company-settings.ts — ข้อมูลนี้พิมพ์บนเอกสารทุกใบอยู่แล้ว)
create policy "app_configs_select_anon" on public.app_configs
  for select
  using (true);

-- เขียนได้เฉพาะ user ที่ login แล้ว (Supabase Auth) — ตรงกับ saveCompanySettings ที่ผูก JWT ของ user
create policy "app_configs_write_authenticated" on public.app_configs
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
