-- Manual interest corrections are append-only events, consistent with the
-- existing debt_events audit trail. Positive amount adds interest; negative
-- amount reduces it.
alter table public.debt_events drop constraint if exists debt_events_event_type_check;

alter table public.debt_events add constraint debt_events_event_type_check
  check (event_type in (
    'debt_started', 'receipt_received', 'promise_to_pay',
    'collection_paused', 'collection_resumed',
    'interest_waived', 'penalty_waived',
    'manual_adjustment', 'manual_interest_adjustment', 'debt_closed'
  ));
