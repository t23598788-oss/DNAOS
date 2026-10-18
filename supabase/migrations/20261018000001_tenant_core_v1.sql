-- TENANT CORE V1 (additive · 2026-10-18, owner mission SOFTWARE DEVELOPMENT AUTHORITY)
--
-- ขอบเขต: ตาราง tenant root ที่ปลายขอบเขตแยกข้อมูลระหว่างองค์กร (Layer 2) —
-- additive ทั้งหมด ไม่แตะ canonical writers/gateways/document engine เดิม
-- (ARCHITECTURE RULES: ห้ามสร้างสาย duplicate · ตารางนี้ไม่ซ้ำหน้าที่ companies
-- เดิม: companies = business entity ฝั่งบัญชี/หนี้ภายในองค์กร, organizations =
-- tenant root ของซอฟต์แวร์ — หนึ่งองค์กรมีได้หลาย companies)
--
-- ภาษี/บัญชีธนาคาร/LINE ID ที่เจาะจงใคร — องค์กรทุกแห่งที่ติดตั้งซอฟต์แวร์สร้างข้อมูลจริง
-- ของตัวเองบนฐานข้อมูลผ่าน admin routes ที่ตรวจ requireAuth เดิมเท่านั้น (fail-closed)
-- รายหนึ่ง) ต้องถูกตั้งผ่านทาง admin routes ที่ตรวจ requireAuth เดิมเท่านั้น
-- (fail-closed: migration ไม่ถือว่าผู้ติดตั้งคือองค์กรใด)
--
-- หมายเหตุการใช้งาน: implementer ต้อง APPLY อย่างมีสติด์ก่อนใช้ (สถิติ production
-- ในภารกิจนี้ "ไม่ได้ apply") และ committee-columns /* organizations.id ปลายทาง
-- องค์กรเดียว */ ต้องถูกนำไปใช้ทีละเส้นทางที่มี org-scope guard คุมก่อนเสมอ

create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id)
);

create table if not exists public.org_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            text not null check (role in ('owner','admin','member')),
  created_at      timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index if not exists org_members_user_idx on public.org_members (user_id);

alter table public.organizations enable row level security;
alter table public.org_members  enable row level security;

-- fail-closed: ไม่มี policy ของ anon/public ใด ๆ เปิด select กว้าง — สิทธิ์ทั้งหมด
-- ผ่าน membership (auth.uid()) เท่านั้น · service_role ผ่าน bypassrls ของ service key
create policy organizations_select_member_only
  on public.organizations for select
  using (
    exists (
      select 1 from public.org_members m
      where m.organization_id = organizations.id and m.user_id = auth.uid()
    )
  );

create policy organizations_insert_any_authed_creates_own
  on public.organizations for insert
  to authenticated
  with check (created_by = auth.uid());

create policy organizations_update_owner_or_admin
  on public.organizations for update
  using (
    exists (
      select 1 from public.org_members m
      where m.organization_id = organizations.id
        and m.user_id = auth.uid()
        and m.role in ('owner','admin')
    )
  );

create policy org_members_select_own_or_staff
  on public.org_members for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.org_members m
      where m.organization_id = org_members.organization_id
        and m.user_id = auth.uid()
        and m.role in ('owner','admin')
    )
  );

-- member หลายเดือนต้องชี้อาณาเขต — เฉพาะ owner/admin เท่านั้นที่เพิ่มสมาชิกลงองค์กรตัวเอง
create policy org_members_insert_owner_or_admin
  on public.org_members for insert
  to authenticated
  with check (
    exists (
      select 1 from public.org_members m
      where m.organization_id = organization_id
        and m.user_id = auth.uid()
        and m.role in ('owner','admin')
    )
  );

create policy org_members_update_owner_only
  on public.org_members for update
  using (
    exists (
      select 1 from public.org_members m
      where m.organization_id = org_members.organization_id
        and m.user_id = auth.uid()
        and m.role = 'owner'
    )
  );

create policy org_members_delete_owner_or_admin
  on public.org_members for delete
  using (
    exists (
      select 1 from public.org_members m
      where m.organization_id = org_members.organization_id
        and m.user_id = auth.uid()
        and m.role in ('owner','admin')
    )
  );

-- แนวเชื่อมฝั่งข้อมูลธุรกรรมเชิงบัญชี: companies ยังเป็น business entity เดิมทุกกำบัง —
-- เพิ่มช่องอ้างอิง tenant เป็น nullable additive (ข้อมูล production จริง"แม็ปเข้า
-- องค์กรใด" = นิติบุคคลที่ admin องค์กรนั้นตัดสินใจเอง ซอฟต์แวร์ไม่สันนิษฐานแทน)
alter table public.companies
  add column if not exists organization_id uuid references public.organizations(id);

create index if not exists companies_organization_idx
  on public.companies (organization_id);

alter table public.companies enable row level security;
-- companies เปิด RLS แบบ member-only: จำกัดใน scope ของถิ่น (แก้เฉพาะต่อเมื่อ owner
-- ททายกทำสมาคมปัจจุบัน ให้เส้นเลยไปเจอ requireAuth(ADMIN_TIER) เดิมก่อน)
create policy companies_select_member_only
  on public.companies for select
  using (
    organization_id is null
    or exists (
      select 1 from public.org_members m
      where m.organization_id = companies.organization_id and m.user_id = auth.uid()
    )
  );
