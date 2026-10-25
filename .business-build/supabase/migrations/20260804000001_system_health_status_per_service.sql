-- Infrastructure Health / Runtime Verification (owner, 2026-08-04)
--
-- "Do not trust configuration. Verify periodically." — system_health_status
-- (2026-07-29) already IS the real per-service health mechanism (consecutive-
-- failure counter, alert-once-per-incident), just hardcoded to a single row
-- for Supabase only. Extending it to one row per real service (Rule 111 —
-- extend, don't duplicate) instead of building a second health table.
alter table public.system_health_status
  drop constraint if exists system_health_status_singleton;

alter table public.system_health_status
  add column if not exists service_key text not null default 'supabase',
  add column if not exists check_kind text, -- 'http_reachability' | 'oauth_token' | 'cron_execution'
  add column if not exists detail jsonb;

-- id no longer means "the one singleton row" — give it a real sequence so
-- future per-service rows get distinct ids without the old `default 1`.
create sequence if not exists public.system_health_status_id_seq owned by public.system_health_status.id;
select setval('public.system_health_status_id_seq', greatest((select max(id) from public.system_health_status), 1));
alter table public.system_health_status alter column id set default nextval('public.system_health_status_id_seq');

create unique index if not exists system_health_status_service_key_idx on public.system_health_status(service_key);
