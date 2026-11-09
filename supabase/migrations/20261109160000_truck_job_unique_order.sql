-- One active truck job per order (2026-11-09).
--
-- Business model: 1 order = 1 dedicated truck, dispatched immediately after
-- payment. Two in-flight jobs for the same order would mean two trucks driving
-- to the same customer, and the tracking stream (one unbroken 7-stage sequence
-- per job) would stop being authoritative.
--
-- The index is PARTIAL — `WHERE current_status <> 'DELIVERED'` — on purpose:
--   * in-flight jobs (BROADCASTED ... AT_SITE) are unique per order, so a
--     duplicate dispatch is rejected by the database itself, not only by the
--     order-dispatcher's "already dispatched" check;
--   * a DELIVERED job drops out of the predicate, so re-dispatch after delivery
--     still works (re-delivery, replacement, or a corrected dispatch) and the
--     delivered row stays as history;
--   * CANCELLED-style terminal states do not exist in truck_jobs today — the
--     status vocabulary is the 7 tracking stages in
--     20261109150000_truck_tracking.sql, and DELIVERED is the only terminal one.
--
-- Partial is also what keeps this safe to add to a live table: existing rows are
-- only checked against each other while they are still in flight.

CREATE UNIQUE INDEX IF NOT EXISTS truck_jobs_one_active_per_order
  ON public.truck_jobs(order_id)
  WHERE current_status <> 'DELIVERED';
