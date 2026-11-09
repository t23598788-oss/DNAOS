-- Global Background Voice Listener (owner, 2026-07-30): "ดักฟังเสียงเบื้องหลัง
-- ทุกหน้าจอ...สแตนด์บายยาวจนกว่าจะสั่งปิด" — followed by an explicit
-- architecture correction the same day: "เลิกเอาตรรกะระบบอัตโนมัติมาผูกติดกับ
-- หน้าต่างแอป DNA OS! แอปมีหน้าที่แค่หน้าต่าง UI...สคริปต์ทำงานอัตโนมัติ 24 ชม.
-- ให้ถอดไปรันเป็น Background Daemon / macOS launchd + Supabase Backend...
-- แยก Layer ของแอปออกจาก Background Service และ Supabase ให้ถูกต้อง" — this
-- table is the real, decoupled hand-off point: a macOS launchd daemon
-- (~/dna-os-ollama/voice-wake-watcher.mjs, independent of whether the DNA OS
-- app/window is open at all) listens continuously via local Whisper
-- (whisper-cpp, already installed) and INSERTs a row here the moment it
-- hears the wake word. The DNA OS Next.js app is a pure UI layer — it never
-- touches a microphone itself, it only subscribes to this table via
-- Supabase Realtime (same real pattern as ai_tasks + 20260726000005's
-- telemetry read policy, not invented fresh) and reacts to real rows.
create table if not exists public.voice_wake_events (
  id uuid primary key default gen_random_uuid(),
  transcript text,
  created_at timestamptz not null default now()
);

alter table public.voice_wake_events enable row level security;

-- Same shape as ai_tasks (20260725000006): only the local daemon (using the
-- service_role key, which bypasses RLS entirely) may write; no client-side
-- key can insert/update/delete a wake event.
create policy service_role_only on public.voice_wake_events
  for all using (false);

-- Same shape as 20260726000005_ai_tasks_telemetry_readonly.sql: the admin
-- workspace UI needs read access for its own Realtime subscription — reusing
-- the existing is_admin_workspace_user() function, not a new one.
create policy admin_workspace_read_voice_wake_events
  on public.voice_wake_events
  for select
  to authenticated
  using (public.is_admin_workspace_user());

do $$
begin
  -- add to realtime only when the publication exists (Supabase); plain Postgres skips
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'voice_wake_events'
  ) then
    alter publication supabase_realtime add table public.voice_wake_events;
  end if;
end
$$;
