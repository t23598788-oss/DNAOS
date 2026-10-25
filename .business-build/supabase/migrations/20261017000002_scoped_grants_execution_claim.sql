-- Phase 8 — persistent execution claim on scoped_grants (owner-approved).
--
-- WHY scoped_grants (not device_commands): device_commands is device-scoped
-- (device_id NOT NULL REFERENCES device_registry) and models device command
-- delivery, NOT general capability execution. scoped_grants is the capability
-- lease (subject+action+resource+job+expiry) — the natural execution authority
-- for a command that was approved and must run EXACTLY once.
--
-- A grant, once claimed (executed), can never be claimed again → a duplicate
-- resume / retry / callback cannot re-execute the same command, even across a
-- runtime restart (state lives in Postgres, not in memory).

ALTER TABLE public.scoped_grants
  ADD COLUMN IF NOT EXISTS consumed_at        timestamptz,
  ADD COLUMN IF NOT EXISTS execution_result   jsonb,
  ADD COLUMN IF NOT EXISTS execution_error    text;

-- Atomic claim: one UPDATE, guarded by consumed_at IS NULL. Concurrent claimers
-- serialize on the row lock; exactly one wins. Retry/crash-safe (Postgres row).
CREATE OR REPLACE FUNCTION public.claim_scoped_grant(
  p_grant_id uuid,
  p_job_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grant public.scoped_grants%ROWTYPE;
BEGIN
  UPDATE public.scoped_grants
     SET consumed_at = now()
   WHERE id = p_grant_id
     AND consumed_at IS NULL
     AND revoked_at IS NULL
     AND (expires_at IS NULL OR expires_at > now())
     AND (job_id IS NULL OR job_id = p_job_id)
  RETURNING * INTO v_grant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'grant_not_claimable';
  END IF;

  RETURN jsonb_build_object('claimed', true, 'grant_id', v_grant.id, 'resource', v_grant.resource, 'job_id', v_grant.job_id);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_scoped_grant(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_scoped_grant(uuid, uuid) TO service_role;
