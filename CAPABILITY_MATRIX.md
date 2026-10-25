# CAPABILITY_MATRIX.md

**Basis:** Source inspection + prior reports (production web verified per reports, order state flow tested on staging per reports). 
**Note:** Treats "production web verified" as reported; not re-tested live in this read-only audit.

| Capability | Status | Evidence | Notes |
|---|---|---|---|
| Auth/Identity/RBAC/Tenant Isolation | VERIFIED LIVE (code+reports) | core/auth/*, core/authority/*, registry/permissions.json | Authority separation in place |
| Orders/Transactions/State Machine | VERIFIED TEST (reported) | engines/transactions/*, reports/*staging* | Order state flow passed on staging per reports |
| Documents (Invoice/Quote) Engine | IMPLEMENTED UNVERIFIED (E2E) | engines/canonical/document-write.ts, app/api/admin/documents/* | Canonical writer with versioning; full E2E not confirmed complete |
| Payments/Connect/Provider | IMPLEMENTED UNVERIFIED | app/api/internal/connect/*, supabase/functions/line-webhook-v2/* | Payment provider for real transactions not fully verified; connect paths exist |
| Reconciliation (Bank) | IMPLEMENTED UNVERIFIED | supabase/functions/bank-statement-reconcile/* | Function present, not fully verified end-to-end |
| LINE OA Integration | IMPLEMENTED UNVERIFIED | supabase/functions/line-webhook-v2/* | Complex webhook logic present |
| Public Catalog | IMPLEMENTED UNVERIFIED | app/products/*, app/api/public/*, core/public-catalog/* | Publication controlled via registry/migrations |
| Admin Workspace/Operations | IMPLEMENTED UNVERIFIED | app/admin/*, app/api/admin/* | Large surface area |
| AI Gateway/Workers/Intelligence | IMPLEMENTED UNVERIFIED | core/runtime/*, scripts/*, local-runtime/* | Governance/tooling present |
| Database/Migrations/Audit | IMPLEMENTED UNVERIFIED | supabase/migrations/*, engines/canonical/audit.ts | Extensive migrations; audit logging present |
| Finance Summary/Accounting surfaces | IMPLEMENTED UNVERIFIED | app/api/admin/finance-summary/* | Surfaces exist, E2E incomplete |

**Constraints:** Production web reported verified; unsafe invoice auto-create rolled back; payment provider connectivity unverified.
