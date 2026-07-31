-- System Health Check (owner, 2026-07-29): real incident — a Supabase Auth
-- slowdown caused a real 504 on /admin, then a real "Failed to fetch" on
-- login, and the owner had to notice both himself and report them. Owner's
-- own instruction: "เขียนซอฟต์แวร์...เพื่อจะเช็คตรงนี้เอง...ทำงานแบบเงียบๆ
-- อยู่หลังบ้าน" — this closes that gap. A single-row status table (not a
-- growing log — Rule 107 evidence isolation doesn't apply here, this is
-- live state, not an audit ledger) tracks consecutive failures so the
-- health-check cron only alerts the owner on a REAL sustained problem
-- (2+ consecutive failed checks, ~10 min sustained given a 5-min schedule),
-- never on one transient blip, and only once per incident (not every run
-- while still down) — same discipline as every other alert in this system:
-- never guess, never spam, state only what's actually confirmed.
create table if not exists public.system_health_status (
  id                  int primary key default 1,
  status              text not null default 'healthy' check (status in ('healthy', 'degraded')),
  consecutive_failures int not null default 0,
  last_check_at       timestamptz,
  last_error          text,
  last_alert_at       timestamptz,
  constraint system_health_status_singleton check (id = 1)
);

insert into public.system_health_status (id, status) values (1, 'healthy')
  on conflict (id) do nothing;

alter table public.system_health_status enable row level security;
drop policy if exists service_role_only on public.system_health_status;
create policy service_role_only on public.system_health_status for all using (false);

-- Applied live with the real secret substituted in place of the placeholder below:
-- select cron.schedule(
--   'system-health-check',
--   '*/5 * * * *',
--   $$
--   select net.http_post(
--     url := 'https://xeytcavxejhyzxwevgto.supabase.co/functions/v1/system-health-check',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-system-health-check-secret', '<SYSTEM_HEALTH_CHECK_SECRET value>'
--     ),
--     body := '{}'::jsonb
--   );
--   $$
-- );
