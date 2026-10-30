-- M030 (2026-10-31) — first-time password setup marker (one-flow, no new auth):
-- เก็บเฉพาะ "เวลาที่บัญชีตั้งรหัสผ่านผ่าน Supabase Auth API สำเร็จ" เป็น timestamp
-- รหัสผ่าน (หรือ hash) ไม่มีการเก็บในฐานข้อมูลนี้เด็ดขาด — รหัสผ่านอยู่กับ GoTrue
-- (Supabase Auth) เท่านั้น
--
-- อ่าน: ใช้ RLS เดิม (profiles_select_own — ผู้ใช้อ่านแถวตัวเองได้อยู่แล้ว) และ
--       /auth/confirm อ่านด้วย service-role client ภายใน server route เท่านั้น
-- เขียน: เฉพาะ service role ผ่าน /api/account/password-state
--       (ไม่เพิ่ม UPDATE policy ใหม่ — จุดยืน RLS เดิมไม่เปลี่ยน)
alter table public.profiles
  add column if not exists password_set_at timestamptz;
