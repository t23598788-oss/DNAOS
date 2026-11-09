-- ============================================================================
-- Baseline: ฟังก์ชัน public.is_admin_workspace_user()
--
-- ปัญหา: ฟังก์ชันนี้เป็น helper ที่ policy ของ 8 ไฟล์ถัดไปเรียกใช้ แต่ตัวนิยาม
--        ถูกฝังอยู่ใน 20260720000001_line_events_realtime.sql ซึ่ง statement แรก
--        คือ `alter publication supabase_realtime add table public.line_events`
--        บน Postgres ที่ไม่มี publication นี้ (replay จาก DB ว่าง) statement นั้น
--        ล้มทันที แล้วไฟล์ abort ก่อนถึงบรรทัดที่สร้างฟังก์ชัน → ทุกไฟล์ที่ตามมา
--        ล้มด้วย "function public.is_admin_workspace_user() does not exist"
--
-- ทำไมต้องเป็น baseline: ฟังก์ชันเป็น dependency ข้ามไฟล์ (มี 8 ไฟล์ใช้) จึงต้อง
--        ถูกสร้างให้เสร็จก่อนผู้ใช้รายแรก ไม่ใช่พ่วงไปกับงาน realtime ของตารางเดียว
--
-- ตำแหน่ง: หลัง 20260708000001_profiles_roles.sql (สร้าง public.profiles ที่
--        ฟังก์ชันอ่าน) และก่อน 20260720000001 (ผู้ใช้รายแรก)
--
-- นิยามคัดลอกมาจาก dump (public.is_admin_workspace_user) และตรงกับ
--        20260720000001 ทุกบรรทัด: sql / stable / security definer /
--        search_path = public, อ่าน public.profiles (id = auth.uid() และ
--        role in ('super_admin','admin','employee'))
--
-- check_function_bodies = false: ฟังก์ชันภาษา sql จะถูก parse/validate ตอนสร้าง
--        และ body อ้าง auth.uid() ซึ่ง schema auth เป็นของ Supabase — บน Postgres
--        เปล่า (หรือ local DB ที่ import จาก dump) จะล้มด้วย
--        'schema "auth" does not exist' ทั้งที่นิยามถูกต้อง จึงปิดการ validate
--        เฉพาะไฟล์นี้แล้ว reset กลับ (นิยามยังเหมือนเดิมทุกบรรทัด)
--
-- Idempotent: create or replace จึงทับนิยามเดิมของ 20260720000001 ได้โดยไม่มี
--        drift; grant ถูก guard ด้วยการมีอยู่ของ role (Postgres เปล่าไม่มี role
--        authenticated ของ Supabase) — บน Supabase จะ grant ตามปกติ
-- ============================================================================

set check_function_bodies = false;

create or replace function public.is_admin_workspace_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('super_admin', 'admin', 'employee')
  );
$$;

reset check_function_bodies;

do $$
begin
  execute 'revoke all on function public.is_admin_workspace_user() from public';

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.is_admin_workspace_user() to authenticated';
  else
    raise notice 'role authenticated missing — skipped grant (plain Postgres replay)';
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.is_admin_workspace_user() to service_role';
  end if;
end
$$;
