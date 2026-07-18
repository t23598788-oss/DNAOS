-- Debt Collection Freeze Window — urgent minimal fix (owner, 2026-07-18)
--
-- Real incident: a customer (เทย่า ขอนแก่น) transferred a partial payment
-- 2026-07-05, and the admin promised in the real LINE chat to stop
-- interest/penalty accrual from that date until a new payment date
-- (~2026-07-15). Nothing in this codebase recorded that promise —
-- debt_start_at stayed unchanged, so calcDebtTrackingSummary kept accruing
-- penalty/interest continuously through today, overcharging this real
-- customer (~฿1,000 in penalty alone, confirmed by direct calculation
-- against the live debt_snapshots row).
--
-- Scope: minimal fields to stop the bleeding NOW. This is NOT the full
-- Partial Payment / Freeze Collection / Promise To Pay event-sourced Debt
-- Engine the owner described (that remains a separate, larger design task —
-- Phase B). This is two nullable columns + a formula change that respects
-- them, nothing else.

alter table public.debt_snapshots
  add column if not exists freeze_from timestamp without time zone,
  add column if not exists freeze_until timestamp without time zone;

comment on column public.debt_snapshots.freeze_from is 'Interest/penalty accrual pauses starting this date (e.g. a confirmed partial payment or negotiated pause). Null = no freeze.';
comment on column public.debt_snapshots.freeze_until is 'Freeze ends this date (accrual resumes, NOT retroactively — see engines/debt/tracking.ts). Null + freeze_from set = freeze still open-ended (ongoing).';
