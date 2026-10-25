# NEW_CTO_HANDOVER.md

## Quick Start
1. Restore from GitHub: `git clone https://github.com/t23598788-oss/---------------DNA-OS.git` then checkout needed `backup/*` refs or use specific backup branch/tag.
2. Read governance: `README.md`, `registry/README.md`, `registry/CURRENT_STATE.json`, `registry/TASK_QUEUE.json` (AI execution protocol).
3. Understand authority: see `core/authority/*`, `engines/authority/*`, `DNA_OS_AUTHORITY_BOUNDARY_MATRIX.md`.
4. Understand canonical writes: `engines/canonical/*` - all finance/document writes go through canonical paths.
5. Check environment: `12-environments.json`, `.env.local.example` files (never commit real .env).

## Key Docs in Repo
- Architecture: `ARCHITECTURE.md`, `SYSTEM_ARCHITECTURE.md` (this package)
- Reports: `reports/` contains audits (authority separation, revenue, staging, etc.)
- Migrations: `supabase/migrations/` - schema history
- Functions: `supabase/functions/` - edge functions/webhooks

## Critical Rules (from repo)
- Follow registry protocol strictly; don't start new work if current_task pending.
- Canonical writers are authority for finance/documents/transactions.
- Authority separation enforced; respect tenant isolation.
- Unsafe patterns (e.g. auto-creating zero-value invoices) must not be reintroduced.

## Immediate Priorities for New CTO
1. Verify payment provider connectivity for real transactions (HIGH)
2. Complete documents/payments/accounting E2E verification (HIGH)
3. Run full backup hash verification across all sources (HIGH)
4. Review secrets management and DR/monitoring (CRITICAL/HIGH)
5. Understand LINE webhook paths before modifying (MEDIUM)

## Handover Package Location
All audit documents in: /tmp/dna-os-audit/reports/ (SOURCE_BACKUP_MANIFEST, RESTORE_VERIFICATION, SYSTEM_ARCHITECTURE, DATA_FLOW_AND_FINANCE, RUNTIME_RESOURCE_MAP, CAPABILITY_MATRIX, ENGINEERING_RISK_REGISTER, NEW_CTO_HANDOVER)
