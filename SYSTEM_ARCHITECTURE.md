# SYSTEM_ARCHITECTURE.md

**Source (verified):** /tmp/dna-os-audit/restore/test-clone (checked out from backup/release-wt/release/20261025)  
**Stack:** Next.js (app router), TypeScript, Supabase (Postgres/Auth/Storage/Edge Functions), pnpm/workspaces, Vercel/Railway deployment patterns

## High-Level Modules
| Module | Source Paths | Purpose | Notes |
|---|---|---|---|
| App Router / API Routes | app/, pages/ (minimal) | HTTP endpoints, admin/user/partner/public APIs | Heavy use of route handlers under app/api/* |
| Core Auth/Identity/Authority | core/auth/*, core/identity/*, core/authority/*, engines/authority/*, services/authority/* | Session/auth, role/permission resolution, data scope, tenant isolation | Central authority model with scope enforcement |
| Canonical Engines (Writers) | engines/canonical/* | Transaction/document/payment/expense/material-price writes with audit | Canonical write paths; recent hardening around authority/separation |
| Transaction/Workflow State Machine | engines/transactions/* | State transitions, workflows | Governs order/transaction lifecycle |
| Documents/Tax | engines/documents/*, engines/tax.ts | Document generation, templates, tax logic | Document engine |
| Connect Bus / Integrations | app/api/internal/connect/*, supabase/functions/* | Internal/external integration endpoints, LINE/webhooks | Connect routes for payment/material-price/expense etc. |
| LINE OA | supabase/functions/line-webhook-v2/*, app/api/*/line/* | LINE webhook processing, commands, auto-confirmation | Complex webhook handlers |
| Supabase | supabase/migrations/*, supabase/functions/*, services/supabase/* | Schema, RLS/migrations, edge functions | DB is central source of truth |
| Public Catalog | app/products/*, app/api/public/*, services/public-catalog/*, core/public-catalog/* | Public product catalog | Publication controlled via registry/migrations |
| Admin UI/API | app/admin/*, app/api/admin/* | Backoffice operations | Broad admin surface area |
| AI/Intelligence | core/runtime/*, scripts/*intelligence*, local-runtime/* | Self-awareness/intelligence tooling, workers | Governance/observability tooling present |
| Registry/Governance | registry/*, scripts/governance* | Source of truth for state/tasks/permissions | AI execution protocol enforced via registry |

## Database
- Migrations in supabase/migrations/*.sql (extensive). Schema includes documents/invoices/transactions/orders/partners/companies/users/profiles/roles etc.
- RLS/policies implied by authority model; enforcement via services/core/engines.

## Security Boundaries (from codebase patterns)
- Authority resolution (core/authority/resolve.ts) and admin-read-scope
- Canonical writers enforce invariants; some paths require specific scopes
- Connect endpoints for internal/integration use

Evidence: package.json, app/, engines/, core/, services/, supabase/, registry/ all present in restored checkout.
