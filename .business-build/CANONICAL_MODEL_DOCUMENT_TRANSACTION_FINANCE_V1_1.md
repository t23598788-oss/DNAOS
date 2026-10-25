# CANONICAL MODEL — Document / Transaction / Finance — v1.1 (ARCHITECTURE CONTRACT)

> Status: **APPROVED as architecture contract** (Owner, 2026-09-22) · Phase C in progress
> Scope of this document: the canonical model ONLY. It is not a migration plan and
> not a UI plan. Where it disagrees with the live schema, the live schema wins and the
> disagreement must be reported (Phase C1/C2 static review) — the model is never
> silently bent to fit.
> Provenance: Phase A Reality Audit (live DB + real code, 2026-09-22) → Phase B design →
> Phase B.1 consistency patch → v1.1 (this file).
> File location note: kept at repository root (not `docs/`) because `docs/` is not a
> declared top-level directory in `registry/architecture.json`; creating it would add an
> architecture drift. Root-level design documents are this repo's existing convention.

---

## 1. OWNERSHIP (one owner per fact)

| Entity | Owner (single source of truth) | Identity | Not owner (derived / compat only) |
|---|---|---|---|
| Company | `companies` | `id` | — |
| Site | `customer_sites` | `id` | — |
| Project | `projects` | `id` | `document_groups.project_no` (copy) |
| DocumentGroup | `document_groups` | `id` | `root_order_no` (copy) |
| Transaction | `customer_orders` | `id` | `title`/`net_amount`/`vat_amount` do not exist as columns — never re-added |
| BusinessEvent | `business_events` | `id` | `event_type` Thai free text (display/business data); canonical code lives in `event_type_code` |
| **InboundSourceRecord** | `receipt_documents` (**table name unchanged**, semantic name changed) | `id` | `media_path` (+ `media_sha256/size/mime` columns) = ORIGINAL owner |
| GeneratedDocument | `invoices` ∪ `standalone_documents` | `(invoices.id \| standalone_documents.id)` | — |
| DocumentVersion | `document_versions` (new) | `id` | `standalone_documents.superseded_by_document_id` = legacy compat, read-only |
| Invoice | `invoices` | `id` | a *kind* of GeneratedDocument |
| Payment / Receipt | `receipt_documents` (the money) + `payment_allocations` (the allocation) | `id` | `invoices.paid_amount` / `invoice_status` = cached projection |
| Debt | `debt_events` (ledger) → `debt_snapshots` (cached projection) | `id` / `customer_company_id` | `services/supabase/queries.ts#getOpenDebts/getAllDebts` (derives from invoices, hardcodes interest 0) — must stop being a source |
| Audit / Evidence | `audit_logs` (actions) + `document_versions.snapshot` (state at issue) + `document_artifacts` (files/checksums) + `business_events.context/metadata` | `id` | bare storage paths |

**Forbidden**: a `documents` master table (never existed in the live DB); renaming/removing
`receipt_documents`; storing the same fact in two owners.

---

## 2. ENTITY DIAGRAM (every edge = a real FK in §3)

```
companies ──┬─► customer_sites ──► projects ──► document_groups ──┐
            │            │            │              ▲  root_order_id (＋FK)
            │            │            └─► customer_orders ◄──────┘
            │            └───────────────► customer_orders
            ├─► business_events (partner_id)          ▲ transaction_id (＋FK)
            ├─► receipt_documents (customer_company_id)   │
            ├─► debt_events / debt_snapshots              │
            └─► audit_logs (company_id)                   │
                                                          │
customer_orders ──(customer_order_id FK, EXISTING)──► invoices ─► invoice_items
                 └─(customer_order_id FK, EXISTING)──► standalone_documents ─► standalone_document_items

invoices | standalone_documents ──(exclusive arc FK)──► document_versions
                                                          │ previous_version_id (new → old, append-only)
                                                          └─► document_artifacts (GENERATED files only, FK→version)

receipt_documents (InboundSourceRecord)
   ├─ role A media        : media_path (+ media_sha256/size/mime on the SAME row — no new document)
   ├─ role B extraction   : raw_ocr_text, amount, sender_*, transaction_datetime, confidence, verification_level
   ├─ role C payment evidence : status(ai_read→confirmed|rejected), payment_verified, confirmed_by
   │      ⚠ only document_type ∈ {transfer_slip, payment_advice} is payment evidence
   ├─ matched_debt_event_id (FK, EXISTING) = LEGACY COMPAT (read-only)
   └─ matched by bank_statement_transactions.matched_receipt_document_id (FK, EXISTING) = canonical bank↔slip direction

payment_allocations { receipt_document_id (FK, NOT NULL) → invoice_id | standalone_document_id | debt_event_id (arc) , kind , amount }
        └─► debt_events (ledger) ─► debt_snapshots (cached projection)

inbound_source_links { receipt_document_id | business_event_id (arc) → invoice_id | standalone_document_id (arc) }  -- SOURCE
document_references  { invoice | standalone (arc) → invoice | standalone (arc) }  -- document↔document ONLY (PARENT/GENERATED_FROM)
```

---

## 3. FK MAP (complete — matches §2 edge-for-edge; no unbacked edge)

| # | FK (owning column) | → Target | State |
|---|---|---|---|
| 1 | `customer_sites/projects/customer_orders/document_groups/invoices/standalone_documents/receipt_documents/debt_events/debt_snapshots.customer_company_id`, `audit_logs.company_id` | `companies.id` | existing |
| 2 | `projects.customer_site_id`, `customer_orders.customer_site_id` | `customer_sites.id` | existing |
| 3 | `customer_orders.project_id`, `document_groups.project_id` | `projects.id` | existing |
| 4 | `customer_orders.document_group_id` | `document_groups.id` | existing |
| 5 | `document_groups.root_order_id` | `customer_orders.id` | **add** |
| 6 | `invoices.customer_order_id`, `standalone_documents.customer_order_id` | `customer_orders.id` | existing = **canonical transaction↔document linkage** |
| 7 | `business_events.transaction_id` | `customer_orders.id` | **add** |
| 8 | `business_events.partner_id` | `companies.id` | existing |
| 9 | `invoice_items.invoice_id`, `standalone_document_items.document_id` | 2 doc tables | existing |
| 10 | `document_versions` arc (`invoice_id` \| `standalone_document_id`, `num_nonnulls(...) = 1`) | 2 doc tables | **add** |
| 11 | `document_versions.previous_version_id` | `document_versions.id` | **add** (new → old) |
| 12 | `document_artifacts.document_version_id` (NOT NULL) | `document_versions.id` | **add** |
| 13 | `payment_allocations.receipt_document_id` (NOT NULL, RESTRICT) | `receipt_documents.id` | **add** |
| 14 | `payment_allocations` arc (`invoice_id` \| `standalone_document_id` \| `debt_event_id`, `= 1`) | those 3 tables | **add** |
| 15 | `inbound_source_links` left arc (`receipt_document_id` \| `business_event_id`) × right arc (`invoice_id` \| `standalone_document_id`) | 4 tables | **add** |
| 16 | `document_references` left/right arc (each `invoice_id` \| `standalone_document_id`, `= 1`) | 2 doc tables | **add** |
| 17 | `bank_statement_transactions.matched_receipt_document_id` | `receipt_documents.id` | existing = **canonical bank↔slip direction** (no reverse column) |
| 18 | `receipt_documents.matched_debt_event_id` | `debt_events.id` | existing, **legacy compat (read-only)** |
| 19 | `debt_events.linked_document_id` | `standalone_documents.id` | existing |
| 20 | `debt_events.linked_invoice_id` | `invoices.id` | **add** |
| 21 | `standalone_documents.superseded_by_document_id` | `standalone_documents.id` | existing, legacy compat (read-only) |
| 22 | `partner_payable_requests.partner_company_id` / `.business_event_id` | `companies` / `business_events` | existing |

---

## 4. FINANCIAL SEMANTICS (one column, one meaning)
```
subtotal        = Σ(qty × unit_price)
discount_amount = discount
taxable_base    = subtotal − discount_amount
vat_rate        = rate frozen at issue time
vat_mode        = exclusive | inclusive
vat_amount      = exclusive: base × vat_rate | inclusive: base × vat_rate/(1+vat_rate)
gross_amount    = taxable_base + vat_amount          ← `total_amount` (compat) must always equal this
wht_rate        = withholding % (0 = none)
wht_amount      = taxable_base × wht_rate
net_payable     = gross_amount − wht_amount
paid_amount     = Σ payment_allocations.amount (kind = principal)      ← derived, never typed by hand
outstanding     = net_payable − paid_amount
invoice_status  = VOID | DRAFT | SENT | PARTIALLY_PAID | PAID           ← derived
```
Legacy rows where `total_amount = round(subtotal + vat_amount, 2)` hold the GROSS figure;
`wht_rate/wht_amount/net_payable` stay **NULL** and `data_completeness = 'LEGACY_PARTIAL'`.
Read model uses `coalesce(net_payable, gross_amount)` as the receivable basis and reports the
basis explicitly — it never invents a WHT value.

## 5. PAYMENT SEMANTICS
```
bank_statement_transactions ──(FK#17)──► receipt_documents ──payment_allocations──┬─► invoices        (PAID_BY)
        (money in/out)                    (payment evidence)                       ├─► standalone_documents
                                                                                   └─► debt_events      (SETTLED_BY)
                                              debt_events (ledger) ──► debt_snapshots (projection)
```
- `payment_allocations` is the ONLY source of truth for "how much of a payment went to which claim".
- Supports partial payment (several rows per invoice), one payment → many claims, many payments → one claim.
- `allocation_kind` reuses the real ledger vocabulary: `principal | interest | penalty | other`
  (matches `debt_events.event_type` values `receipt_received`, `interest_penalty_received`).
- Every allocation keeps `receipt_document_id` → the payment is always reachable backwards.

## 6. VERSION / ARTIFACT SEMANTICS
- **Version chain (append-only)**: a new version records its predecessor
  (`document_versions.previous_version_id`, new → old). Nothing is ever written back onto an
  older row. Inverse direction is a VIEW (`document_versions_next`), never a column.
- `document_versions.snapshot` (jsonb) holds the issued state: totals ladder + line items +
  identifiers + `data_completeness`. Opening an old document reads the snapshot — **never** a
  reconstruction from `total_amount`.
- `status ∈ active | superseded | void`; void is a version status, never a row delete.
- **`document_artifacts` = generated files only** (pdf/image), FK → `document_versions` (NOT NULL).
  It carries `storage_bucket/path`, `sha256`, `size_bytes`, `mime_type`, `produced_by`.
- **Original inbound files never enter `document_artifacts`.** Their owner stays
  `receipt_documents.media_path`, and their integrity facts live on the same row
  (`media_sha256`, `media_size_bytes`, `media_mime_type`, `media_captured_at`).
- Unknown values are `NULL` + `LEGACY_PARTIAL` — never guessed.

---

## 7. INVARIANTS (enforceable)
1. Every lineage edge has a real FK. No polymorphic `(table, id)` without FK.
2. `total_amount` means GROSS only; net/WHT/outstanding have their own columns/views.
3. `payment_allocations` is the only truth for allocation; `invoices.paid_amount` / `debt_snapshots.*` are cached projections (refreshed by trigger), never hand-written.
4. Opening a document reads `document_versions.snapshot`; no reconstruction from `total_amount`.
5. Void = version status; documents are never hard-deleted (legacy DELETE route is retired in Phase G).
6. Every generated file has a `document_artifacts` row (``sha256`` + path + `produced_by`).
7. Original inbound files never appear in `document_artifacts`; their owner is `receipt_documents.media_path`.
8. `document_references` is document↔document only; `CHILD` is never persisted; transaction↔document linkage is the existing `customer_order_id` FK only.
9. Only `transfer_slip` / `payment_advice` inbound sources are payment evidence.
10. Rates (VAT/WHT) and totals are frozen at issue time inside the version snapshot.

## 8. MIGRATION ORDER (additive only · no drop / no rename in round 1)
| Step | Work | Depends on |
|---|---|---|
| 1 | add columns (documents totals ladder + `vat_mode`/`data_completeness`, `customer_orders.tx_type`, `business_events.event_type_code`, `receipt_documents.media_*`, `payment_allocations`-adjacent `allocation_state`) | — |
| 2 | `document_versions` (+ arc FK, `previous_version_id`) + indexes | 1 |
| 3 | `document_artifacts` (FK → `document_versions`, NOT NULL) | 2 |
| 4 | `payment_allocations` (FK → receipt/invoices/standalone/debt_events) | 1 |
| 5 | `document_references` (doc↔doc arc; CHECK forbids CHILD) | 2 |
| 6 | `inbound_source_links` (arc × arc) | 2 |
| 7 | missing FKs (`document_groups.root_order_id`, `business_events.transaction_id`, `debt_events.linked_invoice_id`) after orphan pre-check | 1 |
| 8 | canonical views (`document_canonical`, `invoice_payment_summary`, `company_debt_current`, `document_references_inverse`, `document_versions_next`, `receipt_documents_bank_line`) | 2–7 |
| 9 | trigger(s) for cached projections (`invoices.paid_amount`/`invoice_status`, `debt_snapshots`) | 4, 8 |
| 10 | backfill + reconciliation (evidence only; unknown = NULL + LEGACY_PARTIAL) | 1–9 |
| 11 | switch consumers one by one (Phase C7/C) | 8–10 |
| 12 | retire legacy last (Phase G): `gateway/actions.ts` (tables that do not exist + FCR-019), observer `invoice_debts` metadata, `getOpenDebts/getAllDebts`, `"QT"` guard, duplicated debt calculators | 11 |

## 9. LEGACY COMPATIBILITY (what stays, and how)
| Legacy thing | Status | Rule |
|---|---|---|
| `receipt_documents` table name | unchanged | semantic alias only (InboundSourceRecord) |
| `invoices.total_amount` | kept | now means GROSS; older rows that stored net are flagged `LEGACY_PARTIAL` |
| `standalone_documents.status/void_reason/voided_at` | kept & **should be used** | code that claims "no status column" and hard-deletes is wrong (fix in Phase G) |
| `standalone_documents.superseded_by_document_id` | kept | read-only compat; version chain is the truth |
| `receipt_documents.matched_debt_event_id` | kept | read-only compat; `payment_allocations` is the truth |
| `invoice_items` with 18 legacy rows | kept | no backfill invention for the 7 standalone docs (items table is empty) |
| `gateway/actions.ts` + `observer` `invoice_debts` metadata | kept, dead | retire in Phase G only |
| 29 declared-but-ownerless enums | kept | reserved vocabulary for later phases; never dropped |
| 4 keyset `document_*` reads inside routes (`documents/[id]`, `documents/[id]/confirm`) | unchanged in Phase C7 read switch until the read model is proven | no UI edit in this phase |

## 10. CONSISTENCY CHECK RECORD (v1.1)
- FK map ↔ diagram: every diagram edge exists in §3; no §3 FK lacks a diagram edge.
- No duplicate source-of-truth: transaction↔document = FK #6; group↔document = derived via FK #4/#6; source→document = `inbound_source_links`; payment→claim = `payment_allocations`; bank↔slip = FK #17 (single direction); version chain = `previous_version_id`; originals = `receipt_documents.media_path`.
- Migration order respects ownership: nothing creates a second owner; every backfill target is an existing table/column with a real FK.
- Every planned backfill has a real FK-able target; batches with no evidence stay at 0 rows (never invented).

## 11. PHASE C EXECUTION RECORD (2026-09-22)
Scope executed: C0 contract (this file) · C1 pre-migration proof · C2 additive migration · C3 apply+verify ·
C4 safe backfill · C5 canonical views · C6 read model · C7 API switch (backend only) · C8 regression.
No UI change, no legacy removal, no commit at the time of writing.

| Step | Artifact | Result |
|---|---|---|
| C1 | `/tmp/phaseC-before.json` | orphans 0 on every planned FK · duplicates 0 · gross proven 6/6 invoices + 7/7 standalone · storage 85 objects (size+mime 85/85, eTag only ⇒ sha256 stays NULL) |
| C2 | `supabase/migrations/20260922000001_canonical_foundation_v1_1.sql` | 22 columns · 5 tables · 4 unique indexes · 24 indexes · 3 FKs · pure DDL (0 destructive statements) |
| C3 | verification vs BEFORE | every row count identical · totals/VAT identical · 0 orphans · new tables empty |
| C4 | `supabase/migrations/20260922000002_canonical_backfill_v1_1.sql` | 13 version v1 snapshots (6 invoices + 7 standalone, 18 snapshot items, 1 void preserved) · 2 allocations (39,257.80, evidence = matched_debt_event_id on confirmed slips) · 68 media size/mime · legacy totals untouched |
| C5 | `supabase/migrations/20260922000003_canonical_views_v1_1.sql` | 6 views (`document_canonical`, `invoice_payment_summary`, `company_debt_current`, `document_references_inverse`, `document_versions_next`, `receipt_documents_bank_line`) |
| C6 | `services/canonical/{read-model,payments,transaction-detail,document-detail,transaction-list,document-list}.ts` | TransactionDetail + DocumentDetail read models over the canonical tables/views |
| C7 | 4 endpoints | GET transactions (list + detail), GET documents (list + detail) now return canonical values + a `canonical` block; legacy keys preserved; no UI file touched |
| C8 | `scripts/canonical-phase-c-acceptance-test.ts` (`npm run canonical:test`) | 50 checks passed / 0 failed against the live DB |

Gates at the C checkpoint: `tsc --noEmit` 0 · imports no new edges · drift 926 = 926 registered (2 pre-existing
drifts only) · knip unused files = `core/i18n.ts` only · connect-core 95/0 · github 22/22 · line-credential 4/4 ·
railway 28/28 · owner-verification 19/0 · governance 65/100 (the 3 failures are the pre-existing Rule 94 / knip /
drift items, none pointing at Phase C files).

Findings recorded during C: `receipt_documents.media_path` carries **three** reference schemes
(68 storage objects `line-media/*`, 349 `local_backfill:<abs path>`, 78 `local_drive:<abs path>`);
only storage objects have verifiable bytes, so local references keep NULL size/mime/hash (never guessed),
and the harness reports their reachability instead of asserting it.
## 12. PHASE D EXECUTION RECORD (2026-09-22) — canonical WRITE model
## 13. PHASE E EXECUTION RECORD (2026-09-22) — finance/tax integrity
E1–E4 were read-only audits; E5 switched the readers that produced contradicting numbers.
No UI change, no legacy deletion (legacy calculators are marked `@deprecated` instead), no commit.

**E1/E2 findings that were proven with real numbers** (before the fix):
legacy finance-summary revenue **175,755.79–179,126.83** vs canonical **89,283.01**
(overstatement = VOID documents + the quotation, because the `"QT"` guard could never match the real
enum value `quotation`); VAT input read from `amount` (50,072.95) instead of
`amount_pre_vat`+`vat_amount` (8,411.21 + 588.79); payments read from the `payment_verified` flag;
partner outstanding = Σ`total_amount` − `paid_amount` (which is always 0); debt recomputed per consumer
with the legacy interest/penalty calculator, so one company showed two different debts.

**E5 changes (readers only)**
| Area | Before | After |
|---|---|---|
| `finance-summary` revenue | Σ`invoices.total_amount` + standalone (VOID included, `"QT"` guard) | `document_canonical`, VOID + `quotation` excluded, gross/net/VAT/WHT per v1.1 |
| `finance-summary` payments | `receipt_documents.payment_verified` flag | Σ`payment_allocations.amount` (flag kept only as evidence/warning) |
| `finance-summary` expenses | `company_expenses.amount` | `amount_pre_vat` + `totals.vat_input` (= `vat_amount`) |
| `finance-summary` debt | Σ`debt_snapshots.total_outstanding` | Σ`company_debt_current.ledger_outstanding` |
| partner credit | `invoice_status='PAID'` as "received" + legacy interest/penalty | receivables from `document_canonical`, received from allocations, debt from the ledger |
| line-customers (list/detail/send-debt) | `calcDebtTrackingSummary` per row | `company_debt_current` (ledger), overdue days from the snapshot projection |
| relationships (list/detail) | `calcDebtTrackingSummary` / `getCurrentDebt` | `company_debt_current` (ledger) |
| `getOpenDebts` / `getAllDebts` | derived from `invoices.total_amount` | `invoice_payment_summary` (persisted receivable + allocation-derived paid) |
| `getPartnersWithDocumentSummary` | Σ`total_amount` − Σ`paid_amount` | `invoice_payment_summary` + allocations |
| `relationships/[relationshipId]` revenue summary | Σ`total_amount` over non-PAID invoices + **all** standalone docs (VOID + quotation counted) | VOID/void + `quotation` excluded, persisted gross with `total_amount` fallback |
| `partners/[id]/chain` financial summary | Σ`total_amount` of invoices (VOID included) + `receipt` documents as "received" | Σ gross of non-VOID invoices + Σ `payment_allocations` for "received" |
| quotation guard | `document_type === "QT"` (dead) | canonical `document_type` = `quotation` |

**E5.5 deprecations (not deletions)**: `engines/business.ts#calculateTax` (no consumer left),
`engines/debt/{engine,calculator,tracking-calculator,tracking}.ts` — marked `@deprecated` with the note
that finance/credit/reminder paths must read the ledger projection. Regression proof: the finance
harness asserts that none of the eight financial paths import `engines/debt/*` or `calculateTax`.

**E5.6 reconciliation after the fix (real data, `npm run canonical:finance:test` 48/0)**:
revenue legacy 179,126.83 → canonical **89,283.01**, delta **89,843.82** = VOID **86,633.82** +
quotation **3,210.00** (fully explained); VAT input **pre-VAT 8,411.21 + VAT 588.79**;
payments **39,257.80** (allocations); debt **ledger = snapshot 1,583,657.01**;
เทย่า ขอนแก่น stays **−2,833.14** (over-paid, never clamped).
The harness also re-runs the switched routes' own view queries to prove the selected columns exist and
reproduce the canonical revenue exactly.

Gates at the E checkpoint: `tsc --noEmit` 0 · imports 1,287 imports / no new edges · drift 933 = 933
(2 pre-existing) · knip unused files = `core/i18n.ts` only · canonical read 50/0 · write 54/0 ·
finance 48/0 · governance 65/100 (the same 3 pre-existing failures).

Executed D1 inventory → D9 writer switch → D10 real-data regression. No UI change, no legacy
removal, no schema drop/rename, no document master table, no commit at the time of writing.

**Canonical write services (new, `engines/canonical/`)** — all money/identity rules reuse what
already exists (`calculateDocumentTotals` is the only ladder implementation):
| service | owns |
|---|---|
| `audit.ts` | the audit vocabulary + actor/time/entity/evidence for every canonical write |
| `document-write.ts` | create · update draft · issue · void · version chain · real line items |
| `transaction-write.ts` | full-chain creation + validated document linking (no half chains) |
| `payment-write.ts` | allocations (truth) + projection refresh (paid_amount/invoice_status/receipt state) |
| `debt-write.ts` | ledger writes + snapshot projection recomputed from the ledger only |
| `inbound-write.ts` | inbound normalisation with real provenance (media facts, extraction, evidence) |
| `artifact-write.ts` | generated files: version → storage → sha256/size/mime → audit, with rollback |

**Writers switched (D9)** — documents POST/PATCH/DELETE/confirm · transactions POST ·
receipt-documents confirm · debt-trackings events · receipt-documents POST (inbound ingest) ·
LINE document artifacts (version-owned).
Removed: the half-chain auto-create of `customer_orders` (company+status only) and the hard
delete of `standalone_documents`.

**Real-data proof (`npm run canonical:write:test`, 54 checks)**: a real invoice was created on a
real transaction (company/site/project/group), with real line items, a v1 snapshot, a generated
artifact (sha256 + signed URL), then issued (v2) and voided (v3) — never deleted. The payment
path was proven against the real confirmed slip (idempotency guard + allocation target + ledger
agreement, no double counting) and the half-chain refusal was proven to write nothing. All 11
companies' debt snapshots now equal their ledger (1 repaired: a company that had a ledger but no
snapshot).

**Gates at the D checkpoint**: `tsc --noEmit` 0 · imports 914 files / 1293 imports / no new edges ·
drift 933 = 933 registered (only the 2 pre-existing drifts) · knip unused files = `core/i18n.ts`
only · connect-core 95/0 · github 22/22 · line-credential 4/4 · railway 28/28 · owner-verification
19/0 · canonical read 50/0 · governance 65/100 (the same 3 pre-existing failures: Rule 94 in
`material-source-discovery.ts`, knip `core/i18n.ts`, drift `locales/` + 3 unregistered modules of
other work).

**Additive schema delta in D**: `receipt_documents.source_channel` (+ guarded CHECK + index) —
migration `20260922000004_inbound_source_channel_v1_1.sql`; the contract requires the inbound
channel but the table had no column for it.

**Behaviour decisions recorded**: `invoices.paid_amount`/`invoice_status` are now projections of
`payment_allocations`; a debt ledger whose balance reaches zero (or contains `debt_closed`) closes
the projection, and a negative balance is left visible (customer over-paid) instead of the old
clamp-at-zero. Legacy pointers (`receipt_documents.matched_debt_event_id`,
`standalone_documents.superseded_by_document_id`) remain read-only compatibility.

**Known remaining gap (reported, not hidden)**: the LINE webhook family
(`supabase/functions/line-webhook-v2/{engines/process-classified-image,payment-claim,event-followup}.ts`)
and the local-runtime helpers still write `receipt_documents` / `debt_events` / the order chain
directly, because they execute in a Deno/edge or standalone-node runtime that cannot import Next
services. `event-followup.ts` already builds the full chain (site+project+group+order), so it
satisfies D3 structurally; the others need the same routing as a follow-up change.

Scope executed: C0 contract (this file) · C1 pre-migration proof · C2 additive migration ·
C3 apply+verify · C4 safe backfill · C5 canonical views · C6 read model · C7 API switch (backend only) · C8 regression.
No UI change, no legacy removal, no commit at the time of writing.

| Step | Artifact | Result |
|---|---|---|
| C1 | `/tmp/phaseC-before.json` | orphans 0 on every planned FK · duplicates 0 · gross proven 6/6 invoices + 7/7 standalone · storage 85 objects (size+mime 85/85, eTag only ⇒ sha256 stays NULL) |
| C2 | `supabase/migrations/20260922000001_canonical_foundation_v1_1.sql` | 22 columns · 5 tables · 4 unique indexes · 24 indexes · 3 FKs · pure DDL (0 destructive statements) |
| C3 | verification vs BEFORE | every row count identical · totals/VAT identical · 0 orphans · new tables empty |
| C4 | `supabase/migrations/20260922000002_canonical_backfill_v1_1.sql` | 13 version v1 snapshots (6 invoices + 7 standalone, 18 snapshot items, 1 void preserved) · 2 allocations (39,257.80, evidence = matched_debt_event_id on confirmed slips) · 68 media size/mime · legacy totals untouched |
| C5 | `supabase/migrations/20260922000003_canonical_views_v1_1.sql` | 6 views (`document_canonical`, `invoice_payment_summary`, `company_debt_current`, `document_references_inverse`, `document_versions_next`, `receipt_documents_bank_line`) |
| C6 | `services/canonical/{read-model,payments,transaction-detail,document-detail,transaction-list,document-list}.ts` | TransactionDetail + DocumentDetail read models over the canonical tables/views |
| C7 | 4 endpoints | GET transactions (list + detail), GET documents (list + detail) now return canonical values + a `canonical` block; legacy keys preserved; no UI file touched |
| C8 | `scripts/canonical-phase-c-acceptance-test.ts` (`npm run canonical:test`) | 45 checks passed / 0 failed against the live DB |

Gates at the C checkpoint: `tsc --noEmit` 0 · imports 907 files / 1268 imports / no new edges ·
drift 926 = 926 registered (2 pre-existing drifts only: `locales/`, 3 unregistered modules of other work) ·
knip unused files = `core/i18n.ts` only · connect-core 95/0 · github 22/22 · line-credential 4/4 ·
railway-adapter 28/28 · owner-verification 19/0 · governance 65/100 (5/8; the 3 failures are the
pre-existing Rule 94 / knip / drift items, none pointing at Phase C files).

Findings recorded during C: `receipt_documents.media_path` carries **three** reference schemes
(68 storage objects `line-media/*`, 349 `local_backfill:<abs path>`, 78 `local_drive:<abs path>`);
only storage objects have verifiable bytes, so local references keep NULL size/mime/hash (never guessed),
and the harness reports their reachability instead of asserting it.

- FK map ↔ diagram: every diagram edge exists in §3; no §3 FK lacks a diagram edge.
- No duplicate source-of-truth: transaction↔document = FK #6; group↔document = derived via FK #4/#6; source→document = `inbound_source_links`; payment→claim = `payment_allocations`; bank↔slip = FK #17 (single direction); version chain = `previous_version_id`; originals = `receipt_documents.media_path`.
- Migration order respects ownership: nothing creates a second owner; every backfill target is an existing table/column with a real FK.
- Every planned backfill has a real FK-able target; batches with no evidence stay at 0 rows (never invented).


