# DATA_FLOW_AND_FINANCE.md

**Basis:** Source code inspection (canonical engines, transaction state machine, connect routes) + existing audit reports in repo.

## Core Flow (as implemented)
User/Organization → Product (catalog) → Order/Transaction → Document (Invoice/Receipt/Quote) → Delivery/Dispatch → Payment Evidence (Provider/Connect) → Canonical Finance (transaction/document/payment writes) → Accounting/Receipt/Audit

## Key Paths (evidence)
| Stage | Implementation | Status | Notes |
|---|---|---|---|
| Auth/Identity/Tenant | core/auth/*, core/authority/*, middleware.ts | VERIFIED (code paths present) | Authority separation model documented in reports |
| Orders/Transactions | engines/transactions/*, app/api/admin/transactions/* | VERIFIED (code) | State machine in engines/transactions/state-machine.ts; workflows in workflows.ts |
| Documents/Invoices | engines/canonical/document-write.ts, app/api/admin/documents/* | VERIFIED (code) | Canonical writer with versioning/audit; atomic paths exist |
| Payments/Connect | app/api/internal/connect/*, supabase/functions/line-webhook-v2/*, engines/canonical/payment-write.ts | PARTIAL/UNVERIFIED end-to-end | Connect endpoints exist; payment provider for real transactions not fully verified per prior reports |
| Reconciliation | supabase/functions/bank-statement-reconcile/* | IMPLEMENTED UNVERIFIED | Function present |
| Finance/Accounting surfaces | app/api/admin/finance-summary/*, reports/* | PARTIAL | Surfaces exist; full E2E not confirmed complete |

## Safety Notes
- Unsafe invoice auto-create path was rolled back (documented in historical memory) - no zero-value invoice auto-create path active.
- Canonical writers are the authority for finance writes.
- Cross-tenant boundaries enforced via authority/scope resolution.

## Evidence Files
engines/canonical/*.ts, engines/transactions/*.ts, app/api/internal/connect/*.ts, supabase/functions/*, app/api/admin/transactions/*.ts
