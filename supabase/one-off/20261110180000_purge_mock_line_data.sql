-- NOT A MIGRATION — one-off cleanup, never runs automatically.
-- Moved out of supabase/migrations on 2026-11-11 because it contains
-- unconditional DELETE statements. It was never applied: on 2026-11-11
-- the predicates matched 0 of 892 line_events and 0 of 25 bindings.
-- Keep it here for manual use only.

-- Purge mock/test chat data; keep only real LINE user IDs (U + 32 hex).
BEGIN;

DELETE FROM line_events
WHERE line_user_id !~ '^U[0-9a-f]{32}$'
   OR coalesce(line_name, '') IN ('ไม่ทราบชื่อ', 'เทสระบบ');

DELETE FROM partner_channel_bindings
WHERE channel_type = 'LINE'
  AND (
        channel_user_id !~ '^U[0-9a-f]{32}$'
     OR channel_user_id LIKE 'PENDING_LINE_ID_%'
     OR coalesce(display_name, '') IN ('ไม่ทราบชื่อ', 'เทสระบบ')
  );

COMMIT;
