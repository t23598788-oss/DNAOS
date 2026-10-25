-- Connectors — Dynamic Registry สำหรับเชื่อมบริการภายนอกเข้ากับ DNA OS
--
-- ทุกบริการภายนอก (Supabase, Vercel, GitHub, n8n, MCP servers, webhooks ฯลฯ)
-- ที่ต้องการเชื่อมกับ DNA OS ต้อง register ผ่านตารางนี้เท่านั้น
--
-- ต่างจาก registry/*.json (static, ต้อง deploy ใหม่ทุกครั้งที่แก้) —
-- ตารางนี้คือ Dynamic Registry: Core อ่านสดจาก DB ทุกครั้ง (มี cache 60s
-- เหมือน app_configs) เพิ่ม/แก้/ลบ Connector ได้จากหน้า Connectors โดยไม่ต้อง
-- deploy ใหม่ registry/*.json ใช้เฉพาะ bootstrap ค่าเริ่มต้นของระบบเท่านั้น
--
-- config  = ค่าที่ไม่ลับ (base_url, endpoints, scopes, headers)
-- secret  = ค่าลับ (password, api_key, token, client_secret, access_token,
--           refresh_token, signing_secret) — อ่านได้เฉพาะ service role

CREATE TABLE IF NOT EXISTS public.connectors (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text         NOT NULL,
  slug             text         NOT NULL UNIQUE,
  auth_type        text         NOT NULL CHECK (auth_type IN ('login', 'oauth', 'api_key', 'token', 'uri', 'mcp', 'webhook')),
  status           text         NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected', 'connecting', 'connected', 'error')),
  config           jsonb        NOT NULL DEFAULT '{}',
  secret           jsonb        NOT NULL DEFAULT '{}',
  last_checked_at  timestamptz,
  last_error       text,
  created_by_admin_id uuid,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_connectors_status ON public.connectors(status);
CREATE INDEX IF NOT EXISTS idx_connectors_auth_type ON public.connectors(auth_type);

-- ไม่ใช้ RLS สำหรับ anon/authenticated เพราะมี secret อยู่ในตาราง
-- ป้องกัน: เข้าถึงได้เฉพาะผ่าน service role key (Next.js server-side API route เท่านั้น)
ALTER TABLE public.connectors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON public.connectors
  USING (false);  -- deny all; bypassed by service role

-- Webhook events — log การเรียกเข้ามาของแต่ละ webhook connector
CREATE TABLE IF NOT EXISTS public.connector_webhook_events (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id  uuid         NOT NULL REFERENCES public.connectors(id) ON DELETE CASCADE,
  headers       jsonb        NOT NULL DEFAULT '{}',
  payload       jsonb        NOT NULL DEFAULT '{}',
  verified      boolean      NOT NULL DEFAULT false,
  created_at    timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_connector_webhook_events_connector ON public.connector_webhook_events(connector_id, created_at DESC);

ALTER TABLE public.connector_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON public.connector_webhook_events
  USING (false);
