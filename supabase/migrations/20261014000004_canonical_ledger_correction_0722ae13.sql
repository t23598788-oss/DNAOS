-- BOM-070 FINAL EXECUTION GATE — Canonical Ledger Correction for receipt 0722ae13
-- (owner approved design 2026-10-14 · SINGLE atomic DO block · NOT applied yet)
--
-- Fixes the pre-existing double-count from the OLD confirm_payment_allocation RPC: the
-- anchor receipt_received (591e2eae) was booked as the SUM (10,000 = 5,500 principal +
-- 4,500 penalty) instead of principal-only (5,500), so the penalty was booked twice.
--
-- Canonical authority only: reallocate_payment_allocation RPC (the canonical re-point),
-- the canonical ledger projection (same SQL as refreshDebtSnapshotFromLedger), and the
-- canonical audit_logs owner. No new financial writer, no formula change, no Document
-- Engine, no DELETE (append-only: the +4500 correction is reversed with a new -4500
-- manual_adjustment).
--
-- Idempotency: re-running fails the pre-condition guard (anchor is no longer 10000).
-- ROLLBACK (separate migration): reverse each step (see header at end of file).
DO $bom070_correct_0722ae13$
DECLARE
  v_anchor_amount         numeric;
  v_penalty_target        uuid;
  v_penalty_amount        numeric;
  v_principal_target      uuid;
  v_principal_amount      numeric;
  v_manual_amount         numeric;
  v_penalty_event_amount  numeric;
  v_ledger                numeric;
  v_new_event_id          uuid;
BEGIN
  -- ── STEP 0: pre-condition validation (fail-fast → whole DO block rolls back) ──
  SELECT amount INTO v_anchor_amount
    FROM public.debt_events WHERE id = '591e2eae-3227-4775-9a94-04488be876d0';
  IF v_anchor_amount IS NULL OR v_anchor_amount <> 10000 THEN
    RAISE EXCEPTION 'BOM070_PRECONDITION_FAIL: anchor receipt_received expected 10000, got %', v_anchor_amount;
  END IF;

  SELECT debt_event_id, amount INTO v_penalty_target, v_penalty_amount
    FROM public.payment_allocations WHERE id = '245c8d6a-c976-449a-afe5-90c986f5a05b';
  IF v_penalty_target IS DISTINCT FROM '591e2eae-3227-4775-9a94-04488be876d0'::uuid OR v_penalty_amount <> 4500 THEN
    RAISE EXCEPTION 'BOM070_PRECONDITION_FAIL: penalty allocation expected (anchor,4500), got (%,%)', v_penalty_target, v_penalty_amount;
  END IF;

  SELECT debt_event_id, amount INTO v_principal_target, v_principal_amount
    FROM public.payment_allocations WHERE id = '8633558e-6c39-4b5e-b061-802b0d5a0b8e';
  IF v_principal_target IS DISTINCT FROM '591e2eae-3227-4775-9a94-04488be876d0'::uuid OR v_principal_amount <> 5500 THEN
    RAISE EXCEPTION 'BOM070_PRECONDITION_FAIL: principal allocation expected (anchor,5500), got (%,%)', v_principal_target, v_principal_amount;
  END IF;

  SELECT amount INTO v_manual_amount
    FROM public.debt_events WHERE id = 'e22b2986-b222-4285-b605-6e1d5cc4f5ab';
  IF v_manual_amount IS DISTINCT FROM 4500 THEN
    RAISE EXCEPTION 'BOM070_PRECONDITION_FAIL: manual_adjustment expected 4500, got %', v_manual_amount;
  END IF;

  SELECT amount INTO v_penalty_event_amount
    FROM public.debt_events WHERE id = 'cc962e98-a127-45fc-8c13-80e1bbdf8ff5';
  IF v_penalty_event_amount IS NULL OR v_penalty_event_amount <> 4500 THEN
    RAISE EXCEPTION 'BOM070_PRECONDITION_FAIL: interest_penalty_received expected 4500, got %', v_penalty_event_amount;
  END IF;

  -- ── STEP 1: anchor receipt_received 10,000 → 5,500 (principal-only) ──
  UPDATE public.debt_events
     SET amount = 5500
   WHERE id = '591e2eae-3227-4775-9a94-04488be876d0'
     AND event_type = 'receipt_received'
     AND amount = 10000;

  -- ── STEP 2: re-point penalty allocation → interest_penalty_received (canonical RPC) ──
  PERFORM public.reallocate_payment_allocation(
    '245c8d6a-c976-449a-afe5-90c986f5a05b',  -- p_allocation_id
    'debt_event',                            -- p_target_kind
    'cc962e98-a127-45fc-8c13-80e1bbdf8ff5',  -- p_target_id
    4500,                                    -- p_amount
    'system:bom070',                         -- p_actor
    'BOM-070: re-point penalty to its interest_penalty_received event'  -- p_reason
  );

  -- ── STEP 3: reverse the redundant +4500 correction (append-only, no DELETE) ──
  INSERT INTO public.debt_events
    (customer_company_id, event_type, amount, occurred_at, note, source, created_by)
  VALUES
    ('8650e308-de18-4824-a449-82317b793893', 'manual_adjustment', -4500, current_date,
     'BOM-070 reverse of BATCH35_ANCHOR_DOUBLE_COUNT_CORRECTION (anchor corrected to principal-only)',
     'payment_confirmation', 'system:bom070')
  RETURNING id INTO v_new_event_id;

  -- ── STEP 4: refresh snapshot from the ledger (canonical projection; net stays -4500) ──
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
    RAISE EXCEPTION 'BOM070_INVARIANT_FAIL: corrected ledger expected -4500, got %', v_ledger;
  END IF;

  UPDATE public.debt_snapshots
     SET total_outstanding = round(v_ledger, 2),
         collection_state = (CASE WHEN v_ledger <= 0 THEN 'CLOSED' ELSE 'CURRENT' END)::public."CollectionState",
         updated_at = now()
   WHERE customer_company_id = '8650e308-de18-4824-a449-82317b793893';

  -- ── STEP 5: canonical audit (old/new) — the RPC also writes its own payment.reallocated ──
  INSERT INTO public.audit_logs
    (actor_user_id, company_id, entity_type, entity_id, action, field, old_value, new_value, created_at)
  VALUES
    (null, '8650e308-de18-4824-a449-82317b793893', 'debt_event', '591e2eae-3227-4775-9a94-04488be876d0',
     'debt.event_updated', 'amount', '10000',
     jsonb_build_object('value', 5500, 'evidence', jsonb_build_object('reason','BOM-070 anchor principal-only backfill'))::text, now()),
    (null, '8650e308-de18-4824-a449-82317b793893', 'payment_allocation', '245c8d6a-c976-449a-afe5-90c986f5a05b',
     'payment.reallocated', 'debt_event_id', '591e2eae-3227-4775-9a94-04488be876d0',
     jsonb_build_object('value','cc962e98-a127-45fc-8c13-80e1bbdf8ff5','evidence',jsonb_build_object('reason','BOM-070 re-point penalty to interest_penalty_received'))::text, now()),
    (null, '8650e308-de18-4824-a449-82317b793893', 'debt_event', v_new_event_id::text,
     'debt.event_created', 'amount', null,
     jsonb_build_object('value', -4500, 'evidence', jsonb_build_object('reason','BOM-070 reverse double-count correction'))::text, now());
END
$bom070_correct_0722ae13$;

