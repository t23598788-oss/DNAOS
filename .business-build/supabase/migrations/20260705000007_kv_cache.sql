-- KV Cache — generic key-value store for DNA OS runtime state
--
-- ใช้เก็บ display state, session context ระหว่าง AI requests
-- key = "display_state:{sessionId}"
-- value = JSON object (DisplayState, conversation context, etc.)

CREATE TABLE IF NOT EXISTS public.kv_cache (
  key         text         PRIMARY KEY,
  value       jsonb        NOT NULL DEFAULT '{}',
  updated_at  timestamptz  NOT NULL DEFAULT now()
);

-- ไม่ใช้ RLS เพราะ access ผ่าน server-side API routes เท่านั้น
-- (anon key + server environment — ไม่ expose ตรงถึง client)
-- cleanup index: ล้าง entries ที่ไม่ได้ใช้นาน
CREATE INDEX IF NOT EXISTS idx_kv_cache_updated_at ON public.kv_cache(updated_at DESC);
