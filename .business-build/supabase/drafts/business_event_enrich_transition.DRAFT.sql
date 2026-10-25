-- DRAFT — NOT APPLIED. Do not move into supabase/migrations/ until approved.
-- Purpose: the build-event merge path currently runs enrich (UPDATE) and then
-- transition (UPDATE) as two separate client calls. If the second fails, the first
-- is already committed. This function runs both inside ONE plpgsql call. A plpgsql
-- function body is one transaction: any RAISE rolls back every statement in it.
--
-- Authority: this only changes the existing business_events row. It is not a new
-- canonical writer and it does not touch financial tables.
--
-- SECURITY INVOKER keeps the caller's RLS in force. It is not SECURITY DEFINER.

CREATE OR REPLACE FUNCTION public.dna_enrich_and_transition_event(
  p_event_id   uuid,
  p_fields     jsonb,
  p_to_status  text,
  p_allowed_to text[],
  p_trace_id   text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_row  public.business_events%ROWTYPE;
BEGIN
  IF p_trace_id IS NULL OR btrim(p_trace_id) = '' THEN
    RAISE EXCEPTION 'TRACE_ID_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF NOT (p_to_status = ANY (p_allowed_to)) THEN
    RAISE EXCEPTION 'EVENT_UNKNOWN_STATE:%', p_to_status USING ERRCODE = 'P0001';
  END IF;

  -- Lock the row so a concurrent writer cannot interleave between the two steps.
  SELECT * INTO v_row FROM public.business_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EVENT_NOT_FOUND:%', p_event_id USING ERRCODE = 'P0002';
  END IF;

  -- Step 1: enrich (allow-listed columns are set by the caller's field map).
  UPDATE public.business_events
     SET title = COALESCE(p_fields->>'title', title),
         description = COALESCE(p_fields->>'description', description),
         updated_at = now()
   WHERE id = p_event_id;

  -- Step 2: transition. Any failure here rolls back step 1 as well.
  UPDATE public.business_events
     SET status = p_to_status,
         updated_at = now()
   WHERE id = p_event_id;

  RETURN jsonb_build_object('ok', true, 'event_id', p_event_id, 'status', p_to_status);
END;
$$;
