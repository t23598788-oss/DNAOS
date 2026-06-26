-- Add columns for LINE Receiver (Phase 1)
-- เพิ่ม columns ที่ขาด โดยไม่กระทบข้อมูลเดิม

ALTER TABLE public.line_events
  ADD COLUMN IF NOT EXISTS reply_token TEXT,
  ADD COLUMN IF NOT EXISTS group_id TEXT,
  ADD COLUMN IF NOT EXISTS event_timestamp TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS raw_json JSONB,
  ADD COLUMN IF NOT EXISTS line_message_id TEXT;
