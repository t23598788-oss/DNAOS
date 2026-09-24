-- Tool Scope + Device Command Protocol (2026-09-26) — policy/commands base
-- BEFORE any new command kinds (owner directive step7). METADATA ONLY.
--   scoped_grants      = owner-granted permissions bound to account|device|tool
--                        + action class (read/write/delete/run/install/send/secret)
--                        + resource + optional job + expiry + revoke — DENY by
--                        default: no matching live grant = refused.
--   device_commands    = command_id lifecycle (dispatched→running→succeeded|
--                        failed|cancelled|revoked) with expiry, idempotency_key
--                        (UNIQUE = duplicate submit no-ops), attempts/retry,
--                        ack+result hooks; heartbeat is NEVER success.
--   device_pair_code() = ATOMIC one-time code exchange (single-statement CAS:
--                        UPDATE ... WHERE unconsumed/unexpired, then token set;
--                        concurrent calls → exactly one winner — proven by the
--                        parallel local test in scripts/tool-scope-test.ts).
-- RLS deny-all; every grant is created by an authenticated ADMIN_TIER session
-- (granted_by) — no AI message or document can create one (no such route).
BEGIN;

CREATE TABLE IF NOT EXISTS public.scoped_grants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type  text NOT NULL CHECK (subject_type IN ('account','device','tool')),
  subject_id    text NOT NULL,
  action        text NOT NULL CHECK (action IN ('read','write','delete','run','install','send','secret')),
  resource      text NOT NULL,               -- exact id, 'tool:*' prefix, or path prefix
  job_id        uuid,                        -- per-task grant (e.g. brokered secret) → expires with job
  granted_by    uuid NOT NULL,               -- admin/owner account id (never an AI identity)
  expires_at    timestamptz,                 -- NULL = no expiry (explicit, rare)
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scoped_grants_subject ON scoped_grants(subject_type, subject_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.device_commands (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id       uuid NOT NULL REFERENCES public.device_registry(id) ON DELETE CASCADE,
  command_kind    text NOT NULL CHECK (command_kind IN ('managed.run')),  -- closed set; expand only with owner approval
  payload         jsonb NOT NULL DEFAULT '{}',
  idempotency_key text NOT NULL UNIQUE,       -- duplicate submit returns the SAME command
  status          text NOT NULL DEFAULT 'dispatched'
                  CHECK (status IN ('dispatched','running','succeeded','failed','cancelled','revoked')),
  attempts        int NOT NULL DEFAULT 1,
  max_attempts    int NOT NULL DEFAULT 3,
  expires_at      timestamptz NOT NULL,       -- pull refuses expired; stale dispatch cannot run
  result          jsonb,
  error           text,
  dispatched_at   timestamptz NOT NULL DEFAULT now(),
  acked_at        timestamptz,
  finished_at     timestamptz,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_device_commands_device ON device_commands(device_id, status, expires_at);

ALTER TABLE public.scoped_grants ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "service_role_only" ON public.scoped_grants USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE public.device_commands ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "service_role_only" ON public.device_commands USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ATOMIC one-time pairing: consume the code (single UPDATE CAS) and bind the
-- device token hash in ONE function call. Two concurrent calls with the same
-- code → row lock serializes → second sees consumed → raises (no race window
-- between read and write as in select-then-update).
CREATE OR REPLACE FUNCTION public.device_pair_code(p_code_hash text, p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code record;
  v_device record;
BEGIN
  UPDATE device_pairing_codes
     SET consumed_at = now()
   WHERE code_hash = p_code_hash
     AND consumed_at IS NULL
     AND expires_at > now()
     AND attempts < 5
  RETURNING * INTO v_code;

  -- FOUND, not v_code.id: on zero rows the INTO record is UNASSIGNED and
  -- v_code.id itself raises "record has no field id" (live-proof bug 2026-09-26).
  IF NOT FOUND THEN
    PERFORM 1 FROM device_pairing_codes WHERE code_hash = p_code_hash;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_CODE';
    END IF;
    RAISE EXCEPTION 'CODE_UNUSABLE';  -- consumed | expired | attempts
  END IF;

  UPDATE device_registry
     SET device_token_hash = p_token_hash,
         status = 'paired',
         last_seen_at = now(),
         updated_at = now()
   WHERE id = v_code.device_id
     AND status <> 'revoked'
  RETURNING * INTO v_device;

  IF NOT FOUND THEN RAISE EXCEPTION 'DEVICE_REVOKED';
  END IF;

  RETURN jsonb_build_object(
    'device_id', v_device.id,
    'device_name', v_device.device_name,
    'grants', to_jsonb(v_device.grants)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.device_pair_code(text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.device_pair_code(text, text) TO service_role;

COMMENT ON TABLE public.scoped_grants IS
  'Owner-granted, expiring, revocable permissions (subject × action × resource). Deny-by-default: evaluated by core/policy/scope.ts; AI/text documents are never a grant source.';
COMMENT ON TABLE public.device_commands IS
  'Device command lifecycle with expiry + idempotency + retry. Success = terminal status written from a real result ack — never from heartbeat or dispatch.';
COMMIT;
