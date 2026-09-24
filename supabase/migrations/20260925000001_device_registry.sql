-- Device Registry (2026-09-25) — paired USER-MACHINE executors of the SAME
-- system (task: ตัวเชื่อมติดตั้งบนเครื่องผู้ใช้ = executor ของระบบเดิม ไม่ใช่
-- backend ชุดใหม่). METADATA + HASHED CREDENTIALS ONLY:
--   * device_token_hash = sha256(device token) — token itself is returned to
--     the device ONCE at pair time and stored in the OS secret store; never
--     here, never in a response again.
--   * pairing_code_hash = sha256(one-time code) — the code is shown once to
--     the admin and exchanged within an expiry window (fail-closed attempts).
--   * NO service-role/owner secret can ever be issued to a device from this
--     model (rule4) — the device holds ONLY its own per-device token, and
--     every job/scope decision re-checks the paired account's role + grants.
-- Single-tenant note: DNA OS has no organization table (profiles = account,
-- companies = business partners) — a device binds to paired_user_id/role; org
-- scope = the account's role scope, stated here rather than invented.
BEGIN;

CREATE TABLE IF NOT EXISTS public.device_registry (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_name       text        NOT NULL,
  paired_user_id    uuid        NOT NULL,
  paired_email      text        NOT NULL,
  paired_role       text        NOT NULL,
  status            text        NOT NULL DEFAULT 'paired'
                    CHECK (status IN ('paired', 'revoked')),
  device_token_hash text,                       -- sha256 hex; NULL until paired, kept after revoke for audit
  grants            text[]      NOT NULL DEFAULT '{device.health,printers.read}',
  os                text,
  os_release        text,
  arch              text,
  cpu_count         int,
  ram_bytes         bigint,
  disk_free_bytes   bigint,
  node_version      text,
  tools             jsonb       NOT NULL DEFAULT '{}',   -- {lp,lpstat,...} + printers[] (probe result)
  pending_probe     text,                                -- server → device command channel (e.g. 'probe_printers')
  last_seen_at      timestamptz,
  revoked_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_device_registry_token ON device_registry(device_token_hash);
CREATE INDEX IF NOT EXISTS idx_device_registry_status ON device_registry(status);

CREATE TABLE IF NOT EXISTS public.device_pairing_codes (
  code_hash   text PRIMARY KEY,                -- sha256 hex of the one-time code
  device_id   uuid NOT NULL REFERENCES public.device_registry(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL,                   -- authed admin who minted it
  expires_at  timestamptz NOT NULL,
  attempts    int NOT NULL DEFAULT 0,           -- fail-closed counter survives restarts
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_device_pairing_device ON device_pairing_codes(device_id);

ALTER TABLE public.device_registry ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_only" ON public.device_registry USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE public.device_pairing_codes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_only" ON public.device_pairing_codes USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TABLE public.device_registry IS
  'Paired user machines (device connector executors). Metadata + sha256 token hash only — no owner/admin/service-role secret is ever stored or issued to a device.';
COMMIT;
