-- Add columns for LINE Receiver (Phase 1)
-- เพิ่ม columns ที่ขาด โดยไม่กระทบข้อมูลเดิม

-- Local-migration bootstrap fix (owner, 2026-07-30, KM-007 —
-- registry/existence.json known_mistakes): public.line_events is only
-- really CREATEd later (20260709000002_line_events.sql). Guarded so a
-- fresh local bootstrap doesn't fail here; reapplied in
-- 20260710000011_geom_columns_bootstrap_fix.sql once line_events exists.
-- No-op in production (these columns already exist there).
DO $$ BEGIN
  IF to_regclass('public.line_events') IS NOT NULL THEN
    ALTER TABLE public.line_events
      ADD COLUMN IF NOT EXISTS reply_token TEXT,
      ADD COLUMN IF NOT EXISTS group_id TEXT,
      ADD COLUMN IF NOT EXISTS event_timestamp TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS raw_json JSONB,
      ADD COLUMN IF NOT EXISTS line_message_id TEXT;
  END IF;
END $$;
