-- API Tokens — ท่อเชื่อมต่อ AI ภายนอกกับ DNA OS
--
-- ทุก AI ภายนอก (Gemini, ChatGPT, Claude ฯลฯ) ที่ต้องการ query DNA OS
-- ต้องใช้ token จากตารางนี้
-- token ผูกกับ user_email เพื่อ trace ที่มา

CREATE TABLE IF NOT EXISTS public.api_tokens (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email  text         NOT NULL,
  token       text         NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  label       text         NOT NULL DEFAULT 'default',
  scopes      text[]       NOT NULL DEFAULT '{"read"}',
  -- scopes: "read" = query only, "write" = สร้าง/แก้ไข (ยังไม่รองรับ)
  last_used_at timestamptz,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  revoked_at  timestamptz
);

-- index สำหรับตรวจ token เร็ว
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_tokens_token ON public.api_tokens(token)
  WHERE revoked_at IS NULL;

-- ไม่ใช้ RLS เพราะ query ผ่าน service role key เท่านั้น (ไม่ใช่ anon key)
-- ป้องกัน: anon key ไม่มีสิทธิ์อ่าน api_tokens ตาราง

ALTER TABLE public.api_tokens ENABLE ROW LEVEL SECURITY;

-- เฉพาะ service role เท่านั้นอ่านได้ (Next.js API route ใช้ service role)
CREATE POLICY "service_role_only" ON public.api_tokens
  USING (false);  -- deny all; bypassed by service role
