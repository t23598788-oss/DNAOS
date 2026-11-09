-- CustomerOrderStatus is missing every value the payout worker writes.
-- payout-worker.ts sets status to PAYOUT_PENDING_APPROVAL / PAYOUT_APPROVED /
-- PAYOUT_FAILED / PAYOUT_REJECTED; the cancellation worker sets
-- CANCELLED_REFUNDED / CANCELLED_PARTIAL_REFUND. None of these exist on the
-- enum, so every payout attempt fails with 22P02.
--
-- ADD VALUE IF NOT EXISTS is non-destructive and idempotent.
ALTER TYPE "CustomerOrderStatus" ADD VALUE IF NOT EXISTS 'PAYOUT_PENDING_APPROVAL';
ALTER TYPE "CustomerOrderStatus" ADD VALUE IF NOT EXISTS 'PAYOUT_APPROVED';
ALTER TYPE "CustomerOrderStatus" ADD VALUE IF NOT EXISTS 'PAYOUT_FAILED';
ALTER TYPE "CustomerOrderStatus" ADD VALUE IF NOT EXISTS 'PAYOUT_REJECTED';
ALTER TYPE "CustomerOrderStatus" ADD VALUE IF NOT EXISTS 'SETTLED';
ALTER TYPE "CustomerOrderStatus" ADD VALUE IF NOT EXISTS 'CANCELLED_REFUNDED';
ALTER TYPE "CustomerOrderStatus" ADD VALUE IF NOT EXISTS 'CANCELLED_PARTIAL_REFUND';
