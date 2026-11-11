-- Predictive maintenance alerts (owner expansion 2026-11-11).
--
-- The 250-hour maintenance ticket + +50h auto-lock already exist
-- (supabase/functions/equipment-maintenance-cron). What was missing is the
-- WARNING BEFORE the lock: when an asset is within a configured lead time of
-- the next maintenance boundary, notify the people holding ROLE_ENGINEER so a
-- service can be booked before the system locks the machine.
--
-- Two real additions:
--   1. public.equipment_maintenance_alerts — one row per
--      (equipment, boundary). The unique key is the deduplication: the same
--      250h crossing can never notify twice, even across telemetry retries.
--   2. event_rules seed EVENT_MAINTENANCE_DUE -> ROLE_ENGINEER (existing rules
--      engine + existing LINE gateway; no second notification system).
--
-- The interval and lead time are NOT hardcoded here: they are read at runtime
-- from app_configs['equipment_maintenance_alert'] = {"interval_hours":250,
-- "lead_hours":10}. Missing config => the engine skips, it never invents a
-- number.
--
-- Status: APPLIED 2026-11-11 to the linked project (supabase db query, then
-- migration repair --status applied). Verified post-apply: alert table + RLS
-- exist and RULE_MAINTENANCE_DUE was seeded once (no pre-existing rule to
-- overwrite).

create table if not exists public.equipment_maintenance_alerts (
  id              uuid primary key default gen_random_uuid(),
  equipment_id    uuid not null references public.equipment_assets (id) on delete cascade,
  trigger_hours   numeric not null,
  total_hours     numeric not null,
  status          text not null check (status in ('sent', 'failed', 'skipped')),
  error           text,
  notified_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  unique (equipment_id, trigger_hours)
);

create index if not exists equipment_maintenance_alerts_equipment_idx
  on public.equipment_maintenance_alerts (equipment_id, trigger_hours desc);

alter table public.equipment_maintenance_alerts enable row level security;
drop policy if exists service_role_only on public.equipment_maintenance_alerts;
create policy service_role_only on public.equipment_maintenance_alerts for all using (false);

insert into public.event_rules
  (code, name, event_type, target_roles, action, message_template, priority)
values
  (
    'RULE_MAINTENANCE_DUE',
    'เครื่องจักรใกล้ถึงรอบซ่อมบำรุง → แจ้งช่าง/วิศวกร',
    'EVENT_MAINTENANCE_DUE',
    array['ROLE_ENGINEER'],
    'notify_line',
    E'แจ้งเตือนซ่อมบำรุงล่วงหน้า\nเครื่อง: {{asset_code}}\nชั่วโมงสะสม: {{total_engine_hours}} ชม.\nรอบซ่อมถัดไป: {{next_maintenance_hours}} ชม.\nเหลืออีก: {{remaining_hours}} ชม.\nกรุณาจองคิวซ่อมก่อนระบบล็อกอัตโนมัติ',
    30
  )
on conflict (code) do nothing;

comment on table public.equipment_maintenance_alerts is
  'One predictive maintenance warning per (equipment, boundary). Unique key is the deduplication guard for telemetry retries.';
