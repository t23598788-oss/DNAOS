-- Revoke EXECUTE of the legacy reconcile_receipt_payment from service_role
-- (BOM-070 FINAL HARDENING · owner approved 2026-10-14).
--
-- WHY: reconcile_receipt_payment is a SECURITY DEFINER legacy payment authority that
-- writes receipt_documents + debt_events + debt_snapshots WITHOUT payment_allocations
-- (the canonical single source of truth for "how much of a payment went where").
-- The canonical confirm path (confirm_payment_allocation, migration
-- 20260923000001_canonical_payment_allocation_atomic_v1_1) fully replaces it, and
-- the receipt-confirm-flow census enforces 0 callers. Keeping EXECUTE on service_role
-- is a latent divergent write path if the service role key ever leaks.
--
-- This is a REVOKE, NOT a DROP — the function body stays so a rollback is a single
-- GRANT. Guarded idempotently: skips when the function or role is absent (local
-- bootstrap, matching the guarded DO pattern used by 20260923000001).
do $revoke_reconcile_receipt_payment$
begin
  if to_regprocedure('public.reconcile_receipt_payment(uuid, text)') is not null
     and exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke execute on function public.reconcile_receipt_payment(uuid, text) from service_role;
  end if;
end
$revoke_reconcile_receipt_payment$;
