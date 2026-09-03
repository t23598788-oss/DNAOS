# ACCOUNTING_CANONICAL_TRUTH

Owner architecture decision, locked 2026-09-02
(TASK: LOCK_ACCOUNTING_TRUTH_REGISTER_VERIFIED_MODULES_AND_CONTINUE_PRELIVE).

## DECISION
When the DNA OS Accounting Kernel is promoted to LIVE, the **GL / AR–AP subledger is the
single canonical accounting truth**. Accounting status is DERIVED from the ledger, never
read from a legacy status word.

## SUPERSEDES
Using `debt_snapshots`, `invoices.paid_amount`, or `invoice_status` as accounting truth.

## LEGACY ROLES (after promotion)
- `debt_events` → **FEEDER** (historical financial-event source into `financial_events`).
- `debt_snapshots` → **PROJECTION / cache only** (recomputed from the ledger, never authoritative).
- `invoices.paid_amount`, `invoice_status` → **LEGACY OPERATIONAL** compatibility fields;
  the paid/unpaid/partial state derives from the ledger + payment allocations.
- `payment_status` → DERIVED from ledger / allocation.
- VAT / WHT reports → DERIVED from the ledger.
- `tax_submission_packages` → DERIVED from the ledger.

## HARD CONSTRAINTS
- No second accounting-truth store. Legacy balances and the GL must **not** be co-owners of
  "how much is owed / paid / owed in tax."
- Legacy tables are **not modified** in the current round (additive only).
- This decision changes ownership of truth on promotion; it does not itself promote anything.
  The kernel remains VERIFIED_ISOLATED until a separate, Owner-approved LIVE promotion step.

## REASON
Prevent duplicate accounting universes and balance divergence. The census (2026-09-02) found
that `invoices.paid_amount` / `debt_snapshots` carry paid/owed state with **no ledger behind
them** (STATUS_ONLY_WITHOUT_LEDGER), and that a live `payments` table + `debt_snapshots` +
`invoices.paid_amount` already hold parallel balances that can diverge.

## EVIDENCE
- Isolated proof: `tests/__sandbox__/accounting-kernel/` — acceptance **23/23 ALL PASS**
  (`EVIDENCE-acceptance-reverify.txt`), real Postgres 18.4, not Supabase LIVE.
- Registered kernel modules: `software/capability-registrar/candidates/accounting-backend-modules.ts`.

## STATUS OF DEPENDENT WORK (do not regress to UNKNOWN)
- LIVE read-only census / real-data replay / backfill dry-run = **BLOCKED_LIVE_DATA**: no
  registered read-only capability exists for the deadboard business DB, and
  `connections/supabase/` explicitly forbids reading deadboard business data. Requires an
  Owner-provided read-only path before Phases 3–5 can run.
- Actual RD / e-Tax submission = **NOT_PROVEN_EXTERNAL**.
