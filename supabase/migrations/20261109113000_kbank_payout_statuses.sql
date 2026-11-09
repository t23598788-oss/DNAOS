-- KBank Payout Engine (Phase 3) — extend the CustomerOrderStatus enum
-- with the payout lifecycle states used by the payout worker:
--   SETTLED    — the order has been fully paid out to the partner via KBank
--   PAYOUT_FAILED — the payout API call failed and the order needs retry
--
-- The customer_orders.status column is typed as public."CustomerOrderStatus".
-- Existing values are DRAFT..PAID (see 20260729 or full_schema.sql). Since
-- the enum is a Postgres type, ADD VALUE must run in a transaction with a
-- short lock to avoid blocking on a heavy table. Idempotent: re-running the
-- migration cannot create duplicate enum values.
--

-- Extend the enum: first add a spare value, then rearrange — Postgres only
-- allows ADD VALUE (without AT POSITION) at the end of the enum. To add
-- SETTLED/PAYOUT_FAILED in the correct lifecycle order, append them at the
-- end and let the application treat them as the terminal payout states.
do $$
begin
  -- SETTLED: new terminal state after a successful KBank payout.
  alter type public."CustomerOrderStatus" add value if not exists 'SETTLED' after 'PAID';
  -- PAYOUT_FAILED: new terminal state after a failed payout attempt.
  alter type public."CustomerOrderStatus" add value if not exists 'PAYOUT_FAILED' after 'SETTLED';
exception when others then
  -- Duplicate key / concurrent alter: swallow — the enum already carries
  -- these values (idempotent re-run) or another session is mid-alter.
  if sqlstate <> '42710' then
    raise;
  end if;
end
$$;

comment on type public."CustomerOrderStatus" is
  'CustomerOrderStatus enum — sale domain. ADDED: SETTLED (payout issued), PAYOUT_FAILED (payout API rejected).';
