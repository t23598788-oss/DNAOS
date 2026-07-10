-- Runs supabase/functions/line-profile-reconcile every 3 minutes so any LINE
-- contact whose name/picture still failed even after the webhook's own
-- inline retries (engines/profile.ts) keeps getting retried automatically,
-- with no manual intervention needed — owner instruction 2026-07-10:
-- "ต้องทำให้มันโหลดได้จนกว่ามันจะได้" (keep trying until it succeeds).
--
-- NOTE: the actual x-reconcile-secret value is NOT in this file (it's a
-- generated secret, set once via `supabase secrets set RECONCILE_CRON_SECRET`
-- and inlined into the cron.schedule call directly against the live DB — this
-- file documents the shape for reproducibility, not the literal secret).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Applied live with the real secret substituted in place of the placeholder below:
-- select cron.schedule(
--   'line-profile-reconcile',
--   '*/3 * * * *',
--   $$
--   select net.http_post(
--     url := 'https://xeytcavxejhyzxwevgto.supabase.co/functions/v1/line-profile-reconcile',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-reconcile-secret', '<RECONCILE_CRON_SECRET value>'
--     ),
--     body := '{}'::jsonb
--   );
--   $$
-- );
