-- AI Connection Management — Stage 1: Data Model + Health Service only.
-- Owner-approved scope (2026-08-04): no pairing/OAuth/mcp_* tables, no /chat,
-- no route changes here. Purely additive — no existing api_tokens row or
-- column is altered destructively; every 'manual' row keeps working exactly
-- as it does today, with token unchanged and connection_kind defaulting to
-- 'manual'.
--
-- Live-verified before writing this file (not assumed):
--   - vault schema exists on this project
--   - vault.create_secret() works (real secret created + deleted in the test)
--   - vault.decrypted_secrets is readable via a SECURITY DEFINER wrapper
--     function called through the real service-role REST path (the same
--     path services/supabase/api-tokens.ts's serviceClient() uses) — HTTP
--     200, correct decrypted value returned
--   - anon key correctly gets 401 against that same wrapper (permission
--     denied for function) — confirms the lockdown holds
--   - vault schema itself is NOT exposed to PostgREST directly (only
--     public, graphql_public) — confirmed via a raw REST call, HTTP 406 —
--     this is the correct/expected posture, not a gap
-- So both storage mechanisms below are real, working options for Stage 2's
-- credential-minting code to choose between; this migration just makes the
-- schema support either one.

-- ── 1. api_tokens: allow a 'system' row with no plaintext token ──

ALTER TABLE public.api_tokens
  ALTER COLUMN token DROP NOT NULL;

ALTER TABLE public.api_tokens
  ADD COLUMN IF NOT EXISTS connection_kind text NOT NULL DEFAULT 'manual'
    CHECK (connection_kind IN ('manual', 'system')),
  ADD COLUMN IF NOT EXISTS token_hash text,
  ADD COLUMN IF NOT EXISTS vault_secret_id uuid;

-- Existing UNIQUE constraint on token (from 20260705000006_api_tokens.sql)
-- already tolerates multiple NULLs in Postgres (NULL <> NULL), so making the
-- column nullable does not weaken uniqueness for the 'manual' rows that do
-- have a real plaintext token.

-- manual rows must keep having a real plaintext token (unchanged contract);
-- system rows must have NO plaintext token and exactly one of
-- {token_hash, vault_secret_id} — never both, never neither, never a
-- placeholder value in either column.
ALTER TABLE public.api_tokens
  ADD CONSTRAINT api_tokens_connection_kind_shape CHECK (
    (
      connection_kind = 'manual'
      AND token IS NOT NULL
      AND token_hash IS NULL
      AND vault_secret_id IS NULL
    )
    OR
    (
      connection_kind = 'system'
      AND token IS NULL
      AND (
        (token_hash IS NOT NULL AND vault_secret_id IS NULL)
        OR
        (token_hash IS NULL AND vault_secret_id IS NOT NULL)
      )
    )
  );

-- At most one live (non-revoked) system connection at a time. This is a
-- real constraint the database enforces, not just application discipline —
-- a second concurrent INSERT attempting connection_kind='system' while one
-- is already active fails at the database, not silently overwrites.
CREATE UNIQUE INDEX IF NOT EXISTS api_tokens_one_active_system_connection
  ON public.api_tokens (connection_kind)
  WHERE connection_kind = 'system' AND revoked_at IS NULL;

COMMENT ON COLUMN public.api_tokens.connection_kind IS
  'manual = existing admin-created tokens (unchanged behavior). system = the one backend-managed AI Connection (Stage 1, 2026-08-04) — never has a plaintext token column value.';
COMMENT ON COLUMN public.api_tokens.token_hash IS
  'HMAC-SHA-256(token, server-only pepper) fallback storage — only used for connection_kind=system rows when Vault is not the chosen mechanism for that row. Never a plain hash, never logged.';
COMMENT ON COLUMN public.api_tokens.vault_secret_id IS
  'References vault.secrets.id — the real, verified-working credential storage mechanism for connection_kind=system rows. Decrypted only via a locked-down SECURITY DEFINER wrapper function (added in Stage 2 when the real system connection is created), service_role only.';

-- ── 2. ai_connection_status: a real singleton table ──
-- Classic Postgres singleton pattern: a boolean primary key that can only
-- ever be TRUE, so a second row is structurally impossible, not just
-- discouraged by convention. api_token_id is a plain nullable FK — related
-- data, not the uniqueness mechanism (per explicit instruction: "ไม่ใช่
-- singleton mechanism").

CREATE TABLE IF NOT EXISTS public.ai_connection_status (
  singleton_key           boolean PRIMARY KEY DEFAULT true CHECK (singleton_key),
  api_token_id             uuid REFERENCES public.api_tokens(id),
  status                   text NOT NULL DEFAULT 'disconnected'
                              CHECK (status IN ('disconnected', 'provisioning', 'connected', 'degraded', 'failed')),
  auth_ok                  boolean,
  read_command_ok          boolean,
  write_blocked_ok         boolean,
  mcp_reachability         text
                              CHECK (mcp_reachability IN ('applicable', 'not_applicable', 'reachable', 'unreachable')),
  last_health_check_at     timestamptz,
  last_success_at          timestamptz,
  last_failure_code        text,
  last_failure_reason_th   text,
  updated_at                timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ai_connection_status IS
  'Singleton (enforced by singleton_key boolean PK, DEFAULT true, CHECK (singleton_key)) — status cache for the one system AI Connection. Never holds a credential, never a raw error/stack — last_failure_reason_th is a human sentence, last_failure_code is a short machine code (AUTH_INVALID | DB_ERROR | READ_PROBE_FAILED | WRITE_GATE_REGRESSION | ...).';

ALTER TABLE public.ai_connection_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only" ON public.ai_connection_status
  USING (false); -- deny all; bypassed by service role, same posture as api_tokens

-- ── 3. Vault access wrapper functions ──
-- vault schema is deliberately NOT exposed to PostgREST (confirmed live —
-- see header). These SECURITY DEFINER functions in `public` are the real,
-- verified-working path application code uses instead — same pattern
-- proven in the live capability test, made permanent. Schema-level
-- plumbing only; Stage 1 does not call these to create a real credential.
--
-- Hardening (owner security review, 2026-08-04):
--   - SET search_path = '' on every function — with an empty search path,
--     ANY unqualified identifier fails to resolve at all, so every object
--     reference below is fully schema-qualified (vault.create_secret,
--     vault.decrypted_secrets, vault.secrets) not by convention but because
--     the function would simply error otherwise. This closes the classic
--     SECURITY DEFINER search_path hijack (a malicious object shadowing an
--     unqualified name earlier in a caller-controlled search_path).
--   - Each function returns the minimum value its caller actually needs:
--     write returns only the new secret's id (never the plaintext back);
--     read returns only the decrypted text for exactly one id (LIMIT 1
--     added as defense-in-depth on top of the PK-guaranteed uniqueness);
--     delete returns void.
--   - No function here can list or enumerate secrets — each requires a
--     specific p_id/p_secret argument; there is no "select all" path.
--   - REVOKE/GRANT statements are explicit per-role (not batched into one
--     statement) so each is independently auditable, then verified below
--     via has_function_privilege() against pg_proc — the migration itself
--     fails loudly if the grant table doesn't end up exactly as intended.

CREATE OR REPLACE FUNCTION public.ai_connection_vault_write(p_secret text, p_name text, p_description text DEFAULT NULL)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT vault.create_secret(p_secret, p_name, p_description);
$$;

REVOKE ALL ON FUNCTION public.ai_connection_vault_write(text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ai_connection_vault_write(text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ai_connection_vault_write(text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ai_connection_vault_write(text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.ai_connection_vault_read(p_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = p_id LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.ai_connection_vault_read(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ai_connection_vault_read(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ai_connection_vault_read(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ai_connection_vault_read(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.ai_connection_vault_delete(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  DELETE FROM vault.secrets WHERE id = p_id;
$$;

REVOKE ALL ON FUNCTION public.ai_connection_vault_delete(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ai_connection_vault_delete(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ai_connection_vault_delete(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ai_connection_vault_delete(uuid) TO service_role;

-- ── 4. Post-migration permission verification ──
-- Fails the entire migration transaction (nothing above is committed) if
-- the grant table doesn't end up exactly as intended — not a hope, a check.
DO $$
DECLARE
  fn text;
  fn_signature text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['ai_connection_vault_write(text,text,text)', 'ai_connection_vault_read(uuid)', 'ai_connection_vault_delete(uuid)']
  LOOP
    fn_signature := 'public.' || fn;

    IF has_function_privilege('anon', fn_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'Security check failed: anon has EXECUTE on %', fn_signature;
    END IF;

    IF has_function_privilege('authenticated', fn_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'Security check failed: authenticated has EXECUTE on %', fn_signature;
    END IF;

    IF has_function_privilege('public', fn_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'Security check failed: PUBLIC has EXECUTE on %', fn_signature;
    END IF;

    IF NOT has_function_privilege('service_role', fn_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'Security check failed: service_role is MISSING EXECUTE on %', fn_signature;
    END IF;
  END LOOP;

  RAISE NOTICE 'AI Connection Vault RPC permission verification passed: anon/authenticated/public denied, service_role granted, for all 3 functions.';
END $$;
