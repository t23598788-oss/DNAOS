-- TASK-001 (SSO + Permission system): one role per Supabase Auth user, backing
-- the single shared session used across every Portal and every API route.
--
-- Bootstrap rule: the FIRST person ever to sign up becomes super_admin
-- automatically (standard "first user is admin" pattern for a system that
-- currently has zero Supabase Auth users — see TASK-022). Every signup after
-- that defaults to the lowest-privilege role, 'customer'; a super_admin/admin
-- promotes real people to employee/partner/ai_service afterward via
-- /api/admin/users (see core/auth).

create type public.app_role as enum (
  'super_admin',
  'admin',
  'employee',
  'partner',
  'customer',
  'ai_service'
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role public.app_role not null default 'customer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- ทุกคนอ่าน role ตัวเองได้ (ต้องใช้ตัดสินใจ nav/redirect ฝั่ง client)
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

-- admin tier อ่าน profile ของทุกคนได้ (สำหรับหน้า /admin/users)
create policy "profiles_select_admin_tier" on public.profiles
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('super_admin', 'admin')
    )
  );

-- ไม่มี insert/update/delete policy สำหรับ client โดยตั้งใจ — เขียนได้เฉพาะผ่าน
-- service-role client ใน API route เท่านั้น (core/auth ผูก role assignment กับ
-- requireAuth ที่ role-checked แล้ว) ป้องกัน user ยกระดับสิทธิ์ตัวเอง

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  existing_count int;
  assigned_role public.app_role;
begin
  select count(*) into existing_count from public.profiles;

  if existing_count = 0 then
    assigned_role := 'super_admin';
  else
    assigned_role := 'customer';
  end if;

  insert into public.profiles (id, email, role)
  values (new.id, new.email, assigned_role);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
