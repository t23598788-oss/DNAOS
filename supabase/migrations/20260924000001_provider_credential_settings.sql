-- Provider Credential Settings & Requirements (2026-09-24)
-- "Connections & Credentials" — the schema-driven provider card registry.
--
-- METADATA ONLY. No secret value is ever stored here: real credentials live in
-- the EXISTING Connect credential authority (public.connectors .secret jsonb,
-- service-role-only via its own RLS policy; Vault RPCs for the OAuth path).
-- This file adds:
--   A. provider_credential_requirements — which credential fields each provider
--      needs (the UI renders forms FROM these rows — no per-provider form code)
--   B. provider_connection_settings    — provider/connection metadata:
--      environment, display name, sort order, rotation/verification flags,
--      credential version, last_verified_at, last_rotated_at  (category E's
--      verification status lives here as columns)
--   D. provider_credential_events      — rotation/save/disconnect history
--      (old-version METADATA + field NAMES + actor + result — never values)
-- Category C (credential references) is intentionally NOT a new table: the
-- reference IS the requirement key x connectors.secret key presence, computed
-- read-only by GET /api/admin/provider-settings through redactConnector().

BEGIN;

-- ── A. provider credential requirement registry (schema-driven forms) ─────────
CREATE TABLE IF NOT EXISTS public.provider_credential_requirements (
  id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id    text         NOT NULL,
  credential_key text         NOT NULL,
  field_label    text         NOT NULL,
  field_kind     text         NOT NULL DEFAULT 'text'
                 CHECK (field_kind IN ('secret', 'text', 'readonly')),
  required       boolean      NOT NULL DEFAULT false,
  is_secret      boolean      NOT NULL DEFAULT false,
  -- permission scope this field participates in (display-only, e.g. github 'read:user')
  scope          text         NOT NULL DEFAULT '',
  -- which environments this field applies to ('any' = every environment)
  applies_to     text         NOT NULL DEFAULT 'any'
                 CHECK (applies_to IN ('any', 'local', 'staging', 'production')),
  sort_order     int          NOT NULL DEFAULT 0,
  help_text      text         NOT NULL DEFAULT '',
  status         text         NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'planned', 'retired')),
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (provider_id, credential_key)
);

COMMENT ON TABLE public.provider_credential_requirements IS
  'Metadata only: which credential fields each provider needs. UI forms render from these rows. NEVER stores secret values.';

-- ── B + E. provider account/connection metadata + verification status ────────
CREATE TABLE IF NOT EXISTS public.provider_connection_settings (
  provider_id           text        PRIMARY KEY,
  display_name          text        NOT NULL DEFAULT '',
  environment           text        NOT NULL DEFAULT 'production'
                        CHECK (environment IN ('local', 'staging', 'production')),
  sort_order            int,                      -- null = not ordered yet (shown last, DB-ordered)
  rotation_supported    boolean     NOT NULL DEFAULT true,
  verification_supported boolean    NOT NULL DEFAULT true,
  credential_version    int         NOT NULL DEFAULT 0,
  last_verified_at      timestamptz,
  last_test_status      text        CHECK (last_test_status IN ('pass', 'fail')),
  last_rotated_at       timestamptz,
  connector_id          uuid        REFERENCES public.connectors(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.provider_connection_settings IS
  'Provider/connection metadata (environment, order, version, verification timestamps). Credential VALUES stay in public.connectors.secret / Vault - never here.';

-- ── D. rotation / credential mutation history (metadata + field NAMES only) ──
CREATE TABLE IF NOT EXISTS public.provider_credential_events (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id  text         NOT NULL,
  connector_id uuid         REFERENCES public.connectors(id) ON DELETE SET NULL,
  action       text         NOT NULL
               CHECK (action IN ('save', 'rotate', 'rotate_failed', 'disconnect', 'settings_changed')),
  field_keys   jsonb        NOT NULL DEFAULT '[]',   -- credential KEY names only, never values
  version      int,                                  -- resulting credential_version (rotates)
  detail       jsonb        NOT NULL DEFAULT '{}',   -- metadata only (test result, restore flag ...)
  actor        text,                                 -- authenticated email of who pressed the button
  result       text         NOT NULL DEFAULT 'ok',
  created_at   timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.provider_credential_events IS
  'Credential mutation history: field key names + version + actor + result. Secret VALUES are never written to this or any business table.';

-- ── RLS: deny-by-default, service role only (same discipline as connectors) ──
ALTER TABLE public.provider_credential_requirements ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_only" ON public.provider_credential_requirements USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.provider_connection_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_only" ON public.provider_connection_settings USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.provider_credential_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_only" ON public.provider_credential_events USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_provider_req_provider ON public.provider_credential_requirements(provider_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_provider_settings_sort ON public.provider_connection_settings(sort_order NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_provider_events_provider ON public.provider_credential_events(provider_id, created_at DESC);

-- ── Seed A: requirement rows - ground truth copied from the Connect contracts
-- (engines/connectors/providers/{line,railway,github}.ts fieldSpecs +
-- REQUIRED_*_KEYS). required flags mirror what the CONTRACT enforces; optional
-- rows document what the system may use without forcing the Owner to type it.
INSERT INTO public.provider_credential_requirements
  (provider_id, credential_key, field_label, field_kind, required, is_secret, scope, applies_to, sort_order, help_text, status)
VALUES
  -- LINE (contract: REQUIRED_SECRET_KEYS = [channel_access_token], authModes=[token])
  ('line', 'channel_secret',        'Channel Secret',       'secret', false, true,  '', 'any', 10,
   'ใช้ตรวจลายเซ็น webhook — ระบบอ่านจากบัญชี LINE (observe channel) เป็นหลัก จึงไม่บังคับตั้งที่นี่', 'active'),
  ('line', 'channel_access_token',  'Channel Access Token', 'secret', true,  true,  '', 'any', 20,
   'รหัสสำหรับส่ง/ตอบข้อความ และใช้ Test Connection', 'active'),
  ('line', 'channel_id',            'Channel ID',           'text',   false, false, '', 'any', 30,
   'ใส่ถ้าระบบต้องใช้อ้างอิง — ไม่บังคับ', 'active'),
  -- Railway (contract: CANONICAL_TOKEN_KEY = api_token + config service_id/environment_id/base_url)
  ('railway', 'api_token',        'API Token',      'secret',  true,  true,  '', 'any', 10,
   'สร้างที่ railway.com/account/tokens — ใช้ Test Connection', 'active'),
  ('railway', 'project_id',       'Project',        'readonly', false, false, '', 'any', 20,
   'เลือกจาก Discover ที่หน้า Connectors — มนุษย์เลือก ไม่ต้องพิมพ์เอง', 'active'),
  ('railway', 'environment_id',   'Environment ID', 'text',    false, false, '', 'any', 30,
   'จากรายการ Discover หรือกรอกเองถ้าจำเป็น', 'active'),
  ('railway', 'service_id',       'Service ID',     'text',    false, false, '', 'any', 40,
   'จากรายการ Discover หรือกรอกเองถ้าจำเป็น', 'active'),
  ('railway', 'base_url',         'API Base URL',   'readonly', false, false, '', 'any', 50,
   'ค่าเริ่มต้นจาก contract — ปกติไม่ต้องแก้', 'active'),
  -- GitHub (contract: oauth, REQUIRED_CONFIG_KEYS=[client_id], REQUIRED_SECRET_KEYS=[client_secret], DEFAULT_SCOPE='read:user')
  ('github', 'client_id',     'Client ID',     'text',   true,  false, 'read:user', 'any', 10,
   'GitHub OAuth App Client ID', 'active'),
  ('github', 'client_secret', 'Client Secret', 'secret', true,  true,  'read:user', 'any', 20,
   'GitHub OAuth App Client Secret — ใช้แลก token (ไม่ส่งกลับหน้าจอหลังบันทึก)', 'active')
ON CONFLICT (provider_id, credential_key) DO NOTHING;

-- ── Seed B: default order per owner's example (01 LINE ... 05 Google). The rest
-- of the provider universe shows with NULL sort (DB orders them last) and can
-- be reordered from the UI - order ALWAYS comes from this table, never code.
INSERT INTO public.provider_connection_settings (provider_id, display_name, environment, sort_order)
VALUES
  ('line',      'LINE',      'production', 10),
  ('github',    'GitHub',    'production', 20),
  ('railway',   'Railway',   'production', 30),
  ('supabase',  'Supabase',  'production', 40),
  ('google',    'Google',    'production', 50)
ON CONFLICT (provider_id) DO NOTHING;

COMMIT;


