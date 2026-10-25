-- Add interest_penalty_received to debt_events.event_type (owner, 2026-08-03)
-- Real gap found live: the fix in 20260803000001 (splitting principal vs
-- interest/penalty on payment confirmation) inserts event_type
-- 'interest_penalty_received', but debt_events_event_type_check never
-- allowed that value — every insert would fail the check constraint. Caught
-- immediately while backfilling a real missed case (คุณเท่ห์/เทย่า ขอนแก่น,
-- 2,833.14 THB), before it could silently break in production.
alter table public.debt_events
  drop constraint if exists debt_events_event_type_check;

alter table public.debt_events
  add constraint debt_events_event_type_check
  check (event_type = any (array[
    'debt_started', 'receipt_received', 'promise_to_pay', 'collection_paused',
    'collection_resumed', 'interest_waived', 'penalty_waived', 'manual_adjustment',
    'debt_closed', 'interest_penalty_received'
  ]));
