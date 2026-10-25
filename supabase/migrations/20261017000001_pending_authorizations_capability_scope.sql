-- PHASE 4 — extend pending_authorizations to a general capability authorization
-- request (owner-approved 2026-10-17). ADDITIVE ONLY: every existing LINE column
-- is untouched; the LINE webhook keeps writing exactly its own columns, so its
-- behaviour is unchanged.
--
-- DEPENDENCY: 20260926000001_tool_scope_and_commands.sql (creates public.scoped_grants)
-- MUST be applied BEFORE this file, because the decide RPC below inserts a grant
-- into public.scoped_grants.

ALTER TABLE public.pending_authorizations
  ADD COLUMN IF NOT EXISTS capability      text,
  ADD COLUMN IF NOT EXISTS resource        text,
  ADD COLUMN IF NOT EXISTS subject_type    text CHECK (subject_type IS NULL OR subject_type IN ('account','device','tool')),
  ADD COLUMN IF NOT EXISTS subject_id      text,
  ADD COLUMN IF NOT EXISTS scope           jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS job_id          uuid,
  ADD COLUMN IF NOT EXISTS expires_at      timestamptz,
  ADD COLUMN IF NOT EXISTS granted_by      uuid,
  ADD COLUMN IF NOT EXISTS grant_id        uuid,
  ADD COLUMN IF NOT EXISTS decided_at      timestamptz;

CREATE INDEX IF NOT EXISTS pending_authorizations_job_idx
  ON public.pending_authorizations (job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pending_authorizations_capability_status_idx
  ON public.pending_authorizations (capability, status) WHERE capability IS NOT NULL;

-- One request issues at most ONE grant (prevents duplicate grant from one request).
CREATE UNIQUE INDEX IF NOT EXISTS pending_authorizations_grant_uidx
  ON public.pending_authorizations (grant_id) WHERE grant_id IS NOT NULL;

-- Atomic decide + grant: approve sets status AND inserts scoped_grants in ONE
-- transaction. A row lock serializes concurrent decides on the same request; the
-- second one sees status != 'pending' and refuses — so there is never an
-- "approved but no grant" state and never a duplicate grant from one request.
CREATE OR REPLACE FUNCTION public.decide_capability_authorization(
  p_request_id uuid,
  p_decision text,          -- 'approve' | 'deny'
  p_actor uuid,
  p_expires_at timestamptz default null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.pending_authorizations%ROWTYPE;
  v_grant_id uuid;
BEGIN
  IF p_decision NOT IN ('approve','deny') THEN
    RAISE EXCEPTION 'decision_invalid';
  END IF;

  SELECT * INTO v_req FROM public.pending_authorizations
    WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'already_decided';
  END IF;
  IF v_req.expires_at IS NOT NULL AND v_req.expires_at <= now() THEN
    UPDATE public.pending_authorizations
       SET status = 'expired', decided_at = now()
     WHERE id = p_request_id;
    RETURN jsonb_build_object('decision','expired','request_id', p_request_id);
  END IF;

  IF p_decision = 'deny' THEN
    UPDATE public.pending_authorizations
       SET status = 'denied', decided_at = now(), granted_by = p_actor
     WHERE id = p_request_id;
    RETURN jsonb_build_object('decision','denied','request_id', p_request_id);
  END IF;

  -- approve only a real capability request (LINE-only rows carry no subject).
  IF v_req.capability IS NULL OR v_req.subject_type IS NULL OR v_req.subject_id IS NULL THEN
    RAISE EXCEPTION 'not_a_capability_request';
  END IF;

  INSERT INTO public.scoped_grants
    (subject_type, subject_id, action, resource, job_id, granted_by, expires_at)
  VALUES
    (v_req.subject_type, v_req.subject_id, 'run', v_req.resource, v_req.job_id, p_actor, p_expires_at)
  RETURNING id INTO v_grant_id;

  UPDATE public.pending_authorizations
     SET status = 'approved', decided_at = now(), granted_by = p_actor, grant_id = v_grant_id
   WHERE id = p_request_id;

  RETURN jsonb_build_object('decision','approved','request_id', p_request_id, 'grant_id', v_grant_id);
END;
$$;

REVOKE ALL ON FUNCTION public.decide_capability_authorization(uuid,text,uuid,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decide_capability_authorization(uuid,text,uuid,timestamptz) TO service_role;
