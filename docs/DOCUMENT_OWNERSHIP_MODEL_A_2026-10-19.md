# DOCUMENT OWNERSHIP — MODEL A DECISION RECORD (2026-10-19)

Status: **Model A APPROVED by owner (2026-10-19), including the `receipt_documents`
read-permission change.** Migrations are still not applied; production untouched;
nothing backfilled.

## Decision

Model **A — ISSUER-BOUND** was selected because it is the only model that satisfies
all four access criteria in simulation and RLS rehearsal:

| Model | Criterion 1 (seller reads own) | 2 (buyer reads only granted) | 3 (buyer sees no internal ledger) | 4 (seller isolation) | Verdict |
|---|---|---|---|---|---|
| A issuer-bound + grants | met | met | met | met | **VIABLE** |
| B organization-bound | met | **not met** (no recipient concept) | met | met | incomplete |
| C recipient-grants only | **not met** (no issuer concept) | met | met | met | incomplete |

Evidence: `npm run doc-ownership:simulate` (6 PASS / 0 FAIL, model findings printed
as `NOT MET`, not swallowed).

## Concept separation (no conflation)

| Concept | Where it lives |
|---|---|
| ISSUER / SELLER | `invoices.issuer_company_id`, `standalone_documents.issuer_company_id` |
| DOCUMENT OWNER | the organization owning the issuer company (`companies.organization_id`) |
| BUYER / COUNTERPARTY | `customer_company_id` / `partner_company_id` — unchanged, never treated as owner |
| AUTHORIZED RECIPIENT | `document_recipient_grants` (explicit, per document + company) |
| INBOUND EVIDENCE | `receipt_documents.customer_company_id` (receiving company's org) |
| EXPENSE | reached via `receipt_document_id` → the same helper |

`customer_company_id` is never treated as the document's organization. Buyer companies
stay in their own organizations; nothing is merged into the seller's tenant.

## Artifacts

| File | Purpose |
|---|---|
| `supabase/migrations/20261019000002_document_issuer_ownership_proposal.sql` | additive columns + indexes, zero backfill |
| `supabase/migrations/20261019000003_document_ownership_model_a.sql` | grants table, issuer/recipient policies, inbound-evidence helper |
| `supabase/rollback/20261019000003_document_ownership_model_a_rollback.sql` | restores V2 policy shape |
| `scripts/document-ownership-rls-rehearsal.ts` | real RLS + simulated JWTs, 31 checks |
| `scripts/document-ownership-simulation-test.ts` | model comparison on synthetic rows |

## Rehearsal result (`npm run doc-ownership:rls`)

31 PASS / 0 FAIL on a disposable local database:

- pre-change: seller sees **0** of its own invoices (the ORG_UNMAPPED state)
- seller owner + admin read exactly its own 2 invoices, its standalone doc
- seller A cannot read seller B's invoice; seller B cannot read A's
- legacy invoice with no issuer is invisible to seller **and** buyer
- buyer X reads exactly 1 granted invoice + 1 granted standalone doc; not D2/D3
- buyer X reads 0 `company_expenses` and 0 `receipt_documents`
- buyer cannot mint a grant; issuer can grant only its own documents
- anon: no access to invoices, no access to the grants table at all
- rollback: grants table + helpers gone, V2 policy restored, 4 invoice rows intact

## Owner sign-off — recorded

1. **Model A** — approved.
2. **`receipt_documents` read change** — approved (LINE-identity scope → organization of
   the receiving company).
3. **Write-time stamping via the canonical writer** — approved and implemented (below).

## Write-time stamping (implemented in `engines/canonical/document-write.ts`)

- `issuer_company_id` and `organization_id` are stamped by the **same** canonical writer,
  in the same audit entry (`issuer_resolution` records how it was decided).
- Resolution rule (pure `pickIssuerCompanyId`):
  - an explicit `issuer_company_id` is accepted **only** if the company belongs to the
    writing organization — otherwise `ISSUER_NOT_IN_ORGANIZATION` (fail-closed);
  - no explicit issuer + organization owns exactly one company → that company is
    unambiguous and is stamped;
  - several companies → **NULL**, never guessed;
  - no tenant scope → nothing is stamped.
- Safety probe: if the ownership columns are not deployed yet, the writer skips stamping
  (`columns_not_deployed`) instead of sending unknown columns and breaking document
  creation. Applying the migrations is a prerequisite for stamping, not for writing.

## Still open

1. **Apply order** — `20261019000002` → `20261019000003` → deploy the writer change.
   (The writer guard makes the reverse order safe, but stamping only starts after both.)
2. **Legacy 682 documents** — remain `OWNERSHIP_UNKNOWN` (readable by nobody) until an
   issuer is known. No backfill is included.
3. `company_expenses` rows without `receipt_document_id` remain unattributed.
4. **Wallet of recipients** — grants are empty until the operator explicitly shares a
   document; buyer access is expected to be 0 right after apply.
