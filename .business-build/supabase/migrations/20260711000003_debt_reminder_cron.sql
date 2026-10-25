-- Runs supabase/functions/debt-reminder-cron every 10 minutes so the
-- configured daily debt-reminder hour (app_configs: debt-reminder-hour) is
-- always caught close to on-time, without a human clicking "ส่ง" — owner
-- request 2026-07-11: "ให้มันมีการตั้งค่าของทวงถามเป็นออโต้เป็นอัตโนมัติ...
-- วันละหนึ่งรอบช่วงเวลากี่โมง". The function itself checks
-- debt-reminder-auto-enabled and only sends once per company per day, so
-- running every 10 minutes (instead of exactly once at the target hour) is
-- safe — see supabase/functions/debt-reminder-cron/index.ts.
--
-- NOTE: same secret pattern as migration 20260710000005 — the real
-- DEBT_REMINDER_CRON_SECRET value is NOT in this file (generated once via
-- `supabase secrets set DEBT_REMINDER_CRON_SECRET=...` and inlined directly
-- against the live DB). This file documents the shape for reproducibility.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Applied live with the real secret substituted in place of the placeholder below:
-- select cron.schedule(
--   'debt-reminder-cron',
--   '*/10 * * * *',
--   $$
--   select net.http_post(
--     url := 'https://xeytcavxejhyzxwevgto.supabase.co/functions/v1/debt-reminder-cron',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-reconcile-secret', '<DEBT_REMINDER_CRON_SECRET value>'
--     ),
--     body := '{}'::jsonb
--   );
--   $$
-- );
