-- BOM-070 — MANUAL ROLLBACK for 20261014000003_canonical_ledger_correction_0722ae13
-- Apply ONLY via psql if the correction must be reverted. Do NOT run via `supabase db push`.
--
-- Reverses the correction while preserving ledger history (append-only — no DELETE):
--   1. anchor receipt_received 5,500 → 10,000 (back to the pre-correction sum)
--   2. penalty allocation cc962e98 → 591e2eae (back to the anchor)
--   3. append manual_adjustment +4,500 (cancels the correction's -4,500)
--   4. refresh snapshot (net stays -4,500)
-- Every step is guarded: if the current state is NOT the corrected state, it RAISEs and
-- rolls back the whole block (no partial revert).
DO $bom070_rollback_0722ae13$
DECLARE
  v_anchor_amount  numeric;
  v_penalty_target uuid;
  v_reverse_exists numeric;
  v_ledger         numeric;
  v_new_event_id   uuid;
BEGIN
  -- guard 1: anchor must be the CORRECTED value (5,500)
  SELECT amount INTO v_anchor_amount FROM public.debt_events WHERE id = '591e2eae-3227-4775-9a94-04488be876d0';
  IF v_anchor_amount IS NULL OR v_anchor_amount <> 5500 THEN
    RAISE EXCEPTION 'BOM070_ROLLBACK_PRECONDITION_FAIL: anchor expected 5500, got %', v_anchor_amount;
  END IF;

  -- guard 2: penalty must point at cc962e98 (corrected)
  SELECT debt_event_id INTO v_penalty_target FROM public.payment_allocations WHERE id = '245c8d6a-c976-449a-afe5-90c986f5a05b';
  IF v_penalty_target IS DISTINCT FROM 'cc962e98-a127-45fc-8c13-80e1bbdf8ff5'::uuid THEN
    RAISE EXCEPTION 'BOM070_ROLLBACK_PRECONDITION_FAIL: penalty expected cc962e98, got %', v_penalty_target;
  END IF;

  -- guard 3: the correction's -4,500 reverse event must exist
  SELECT amount INTO v_reverse_exists FROM public.debt_events
   WHERE customer_company_id = '8650e308-de18-4824-a449-82317b793893'
     AND event_type = 'manual_adjustment' AND amount = -4500
     AND note LIKE 'BOM-070 reverse of BATCH35%';
  IF v_reverse_exists IS NULL THEN
    RAISE EXCEPTION 'BOM070_ROLLBACK_PRECONDITION_FAIL: correction reverse event (-4500) not found';
  END IF;

  -- reverse 1: anchor back to 10,000
  UPDATE public.debt_events SET amount = 10000
   WHERE id = '591e2eae-3227-4775-9a94-04488be876d0' AND event_type = 'receipt_received';

  -- reverse 2: penalty back to anchor (canonical RPC)
  PERFORM public.reallocate_payment_allocation(
    '245c8d6a-c976-449a-afe5-90c986f5a05b', 'debt_event',
    '591e2eae-3227-4775-9a94-04488be876d0', 4500,
    'system:bom070-rollback', 'BOM-070 rollback: re-point penalty back to anchor');

  -- reverse 3: append +4,500 (cancels the correction's -4,500)
  INSERT INTO public.debt_events
    (customer_company_id, event_type, amount, occurred_at, note, source, created_by)
  VALUES
    ('8650e308-de18-4824-a449-82317b793893', 'manual_adjustment', 4500, current_date,
     'BOM-070 rollback: reverse the double-count correction (restore pre-correction ledger)',
     'payment_confirmation', 'system:bom070-rollback')
  RETURNING id INTO v_new_event_id;

  -- reverse 4: refresh snapshot (net stays -4,500)
  SELECT coalesce(sum(CASE de.event_type
             WHEN 'debt_started'                THEN coalesce(de.amount, 0)
             WHEN 'manual_adjustment'           THEN coalesce(de.amount, 0)
             WHEN 'manual_interest_adjustment'  THEN coalesce(de.amount, 0)
             WHEN 'receipt_received'            THEN -coalesce(de.amount, 0)
             WHEN 'interest_penalty_received'   THEN -coalesce(de.amount, 0)
             ELSE 0 END), 0)
    INTO v_ledger
    FROM public.debt_events de
   WHERE de.customer_company_id = '8650e308-de18-4824-a449-82317b793893';

  IF v_ledger <> -4500 THEN
    RAISE EXCEPTION 'BOM070_ROLLBACK_INVARIANT_FAIL: rolled-back ledger expected -4500, got %', v_ledger;
  END IF;

  UPDATE public.debt_snapshots
     SET total_outstanding = round(v_ledger, 2),
         collection_state = (CASE WHEN v_ledger <= 0 THEN 'CLOSED' ELSE 'CURRENT' END)::public."CollectionState",
         updated_at = now()
   WHERE customer_company_id = '8650e308-de18-4824-a449-82317b793893';

  -- audit (old/new) — append-only, no DELETE
  INSERT INTO public.audit_logs
    (actor_user_id, company_id, entity_type, entity_id, action, field, old_value, new_value, created_at)
  VALUES
    (null, '8650e308-de18-4824-a449-82317b793893', 'debt_event', '591e2eae-3227-4775-9a94-04488be876d0',
     'debt.event_updated', 'amount', '5500',
     jsonb_build_object('value', 10000, 'evidence', jsonb_build_object('reason','BOM-070 rollback anchor to pre-correction sum'))::text, now()),
    (null, '8650e308-de18-4824-a449-82317b793893', 'payment_allocation', '245c8d6a-c976-449a-afe5-90c986f5a05b',
     'payment.reallocated', 'debt_event_id', 'cc962e98-a127-45fc-8c13-80e1bbdf8ff5',
     jsonb_build_object('value','591e2eae-3227-4775-9a94-04488be876d0','evidence',jsonb_build_object('reason','BOM-070 rollback penalty to anchor'))::text, now()),
    (null, '8650e308-de18-4824-a449-82317b793893', 'debt_event', v_new_event_id::text,
     'debt.event_created', 'amount', null,
     jsonb_build_object('value', 4500, 'evidence', jsonb_build_object('reason','BOM-070 rollback reverse correction'))::text, now());
END
$bom070_rollback_0722ae13$;

