-- Payout Approval Gate — extend CustomerOrderStatus enum
-- with the approval lifecycle states used by the payout worker:
--   PAYOUT_PENDING_APPROVAL — order is PAID but awaiting human approval
--   PAYOUT_APPROVED          — human approved; ready to execute payout
--   PAYOUT_REJECTED          — human rejected; never pay out
--
-- KEEP: SETTLED (payout issued), PAYOUT_FAILED (payout API rejected)
--
-- The customer_orders.status column is typed as public."CustomerOrderStatus".
-- Existing values are DRAFT..PAID, SETTLED, PAYOUT_FAILED (Phase 3).
-- Postgres only allows ADD VALUE (without AT POSITION) at the end of the
-- enum, so we append these three at the end.

do $$
begin
  -- PAYOUT_PENDING_APPROVAL
  alter type public."CustomerOrderStatus" add value if not exists 'PAYOUT_PENDING_APPROVAL' after 'PAID';
  -- PAYOUT_APPROVED
  alter type public."CustomerOrderStatus" add value if not exists 'PAYOUT_APPROVED' after 'PAYOUT_PENDING_APPROVAL';
  -- PAYOUT_REJECTED
  alter type public."CustomerOrderStatus" add value if not exists 'PAYOUT_REJECTED' after 'PAYOUT_APPROVED';
exception when others then
  if sqlstate <> '42710' then
    raise;
  end if;
end
$$;

comment on type public."CustomerOrderStatus" is
  'CustomerOrderStatus enum — sale domain. ADDED payout approval lifecycle: PAYOUT_PENDING_APPROVAL -> PAYOUT_APPROVED -> PAYOUT_REJECTED alongside SETTLED / PAYOUT_FAILED.';
