-- DRAFT — NOT APPLIED. Do not move into supabase/migrations/ until approved.
-- Requires: supabase/drafts/business_events_tenant_scope.DRAFT.sql applied first.
--
-- Atomicity: a plpgsql function body is one transaction. Any RAISE rolls back every
-- statement in it, so enrich and transition succeed or fail together.
--
-- Tenant authority (decided in the database, not in the app):
--   1. p_actor_user_id must be given. The caller passes the user id from the server
--      session (requireAuth). It is never read from a request body or an AI output.
--   2. The event must have an organization_id (NULL = denied, fail-closed).
--   3. p_actor_user_id must have a row in org_members for THAT organization_id.
--   4. Roles 'owner', 'admin' and 'member' may write. Any other value is denied.
--
-- Execute is granted to service_role only. anon and authenticated cannot call it.
--
-- SECURITY INVOKER: the caller's privileges apply. Only service_role can execute it.

CREATE OR REPLACE FUNCTION public.dna_enrich_and_transition_event(
  p_actor_user_id uuid,
  p_event_id      uuid,
  p_fields        jsonb,
  p_to_status     text,
  p_allowed_to    text[],
  p_trace_id      text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_row    public.business_events%ROWTYPE;
  v_member boolean;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'ACTOR_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF p_trace_id IS NULL OR btrim(p_trace_id) = '' THEN
    RAISE EXCEPTION 'TRACE_ID_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF NOT (p_to_status = ANY (p_allowed_to)) THEN
    RAISE EXCEPTION 'EVENT_UNKNOWN_STATE:%', p_to_status USING ERRCODE = 'P0001';
  END IF;

  -- Lock the row: concurrent writers on the same event are serialized.
  SELECT * INTO v_row FROM public.business_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EVENT_NOT_FOUND:%', p_event_id USING ERRCODE = 'P0002';
  END IF;

  IF v_row.organization_id IS NULL THEN
    RAISE EXCEPTION 'TENANT_UNSCOPED_EVENT' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.org_members m
     WHERE m.user_id = p_actor_user_id
       AND m.organization_id = v_row.organization_id
       AND m.role IN ('owner', 'admin', 'member')
  ) INTO v_member;
  IF NOT v_member THEN
    RAISE EXCEPTION 'TENANT_DENIED' USING ERRCODE = '42501';
  END IF;

  -- Duplicate request: the same trace was already applied to this event. No write.
  IF v_row.context->>'last_trace_id' = p_trace_id THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'event_id', p_event_id, 'status', v_row.status);
  END IF;

  -- Step 1: enrich (allow-listed columns only).
  UPDATE public.business_events
     SET title = COALESCE(p_fields->>'title', title),
         description = COALESCE(p_fields->>'description', description),
         updated_at = now()
   WHERE id = p_event_id;

  -- Step 2: transition + record the trace that produced it. A failure here rolls back step 1.
  UPDATE public.business_events
     SET status = p_to_status,
         context = COALESCE(context, '{}'::jsonb) || jsonb_build_object('last_trace_id', p_trace_id),
         updated_at = now()
   WHERE id = p_event_id;

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'event_id', p_event_id, 'status', p_to_status);
END;
$$;

-- Membership-scoped trace lookup. Returns only events the actor's organizations own.
CREATE OR REPLACE FUNCTION public.dna_find_events_by_trace(
  p_actor_user_id uuid,
  p_trace_id      text
) RETURNS TABLE (id uuid, status text, organization_id uuid)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT b.id, b.status, b.organization_id
    FROM public.business_events b
   WHERE p_actor_user_id IS NOT NULL
     AND p_trace_id IS NOT NULL AND btrim(p_trace_id) <> ''
     AND b.context->>'trace_id' = p_trace_id
     AND b.organization_id IN (
           SELECT m.organization_id FROM public.org_members m WHERE m.user_id = p_actor_user_id
         );
$$;

REVOKE ALL ON FUNCTION public.dna_enrich_and_transition_event(uuid, uuid, jsonb, text, text[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dna_enrich_and_transition_event(uuid, uuid, jsonb, text, text[], text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dna_enrich_and_transition_event(uuid, uuid, jsonb, text, text[], text) TO service_role;

REVOKE ALL ON FUNCTION public.dna_find_events_by_trace(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dna_find_events_by_trace(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.dna_find_events_by_trace(uuid, text) TO service_role, authenticated;
