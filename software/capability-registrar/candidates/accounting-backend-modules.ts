/**
 * หน้าที่: ให้ DNA OS Accounting Kernel ที่ "พิสูจน์แล้วใน isolated (23/23)" มีตัวตน
 * ในทะเบียน canonical เป็นครั้งแรก (Owner, 2026-09-02 — LOCK_ACCOUNTING_TRUTH).
 *
 * ทุกตัวถูก "พิสูจน์" ไม่ใช่แค่ "สร้าง". lifecycle verdict = VERIFIED_ISOLATED
 * (proven in an isolated real Postgres, NOT on Supabase LIVE). registry ไม่มี status
 * ค่านี้ (legal: REGISTERED/VERIFIED/SUPERSEDED/RETIRED) — verdict จึงถูกพก
 * ไว้ใน evidence_refs (lifecycle_verdict:VERIFIED_ISOLATED, not_on_live:true) และใน
 * governance/architecture-rules/ACCOUNTING_CANONICAL_TRUTH.md ห้ามตีความเป็น LIVE/PRODUCTION.
 *
 * source_location ทุกตัวชี้ไป tests/__sandbox__/accounting-kernel/ (proof artifacts จริง
 * + EVIDENCE 23/23). ไม่มีการแตะ Supabase LIVE, ไม่มี legacy table ถูกแก้.
 *
 * canonical truth: GL/AR-AP ledger (ดู ACCOUNTING_CANONICAL_TRUTH.md).
 *
 * Input: none (ค่าคงที่). Output: ACCOUNTING_BACKEND_CANDIDATES.
 * สิ่งที่ห้ามแตะ: ห้ามอ้าง evidence ที่ยังไม่ได้วัด, ห้ามใส่ credential, ห้ามเปลี่ยน verdict เป็น LIVE.
 */

import type { RegistrationCandidate } from "../../../control/event-pipeline/registration-contract";

const PROOF = "tests/__sandbox__/accounting-kernel";

const COMMON = {
  kind: "capability" as const,
  version: "1.0.0",
  domain: "SOFTWARE_CONTROL_PLANE" as const,
  resource_type: "CAPABILITY" as const,
  data_classification: "INTERNAL",
  source_system: "dna-os-infrastructure",
  origin: {
    origin_kind: "PROVEN_ISOLATED_KERNEL",
    origin_reference: "TASK:LOCK_ACCOUNTING_TRUTH_REGISTER_VERIFIED_MODULES_AND_CONTINUE_PRELIVE",
    introduced_by: "software/capability-registrar/register-accounting-backend-modules.ts",
  },
};

export const ACCOUNTING_BACKEND_CANDIDATES: readonly RegistrationCandidate[] = [
  {
    ...COMMON,
    candidate_id: "candidate-accounting-accounting-kernel-v1",
    name: "accounting-accounting-kernel",
    owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/accounting-backend-modules.ts",
    source_location: `${PROOF}/ (acct-schema.sql + acct-v2.sql + acct-v2-fix.sql; verified by acct-accept2.sql) — MODULE ACCOUNTING_KERNEL`,
    input: [
      "Financial Event + evidence (source documents/bank/receipt) for ACCOUNTING_KERNEL"
    ],
    output: [
      "accounting effect for ACCOUNTING_KERNEL derived by the kernel (see behavior)"
    ],
    side_effects: [
      "writes only to the isolated proof DB (acct_reverify); NEVER Supabase LIVE"
    ],
    dependencies: [
      "proven in isolated Postgres 18.4; depends on kernel modules: none (root)"
    ],
    behavior:
      "Event-sourced double-entry accounting core (event→posting→journal→GL→AR/AP→VAT/WHT→reports→tax package). BOUNDARY: Owns accounting effect; reads legacy only as source/evidence; never trusts module status words. CANONICAL_TRUTH: YES — composite canonical accounting engine. STATUS: VERIFIED_ISOLATED (isolated proof, not on LIVE). KNOWN_LIMITATIONS: Isolated only; not on LIVE Supabase; source stubs simulate legacy tables.",
    evidence_refs: [
      "isolated pg18.4 127.0.0.1:55432 db=acct_reverify (NOT Supabase LIVE)",
      "acceptance acct-accept2.sql = 23/23 ALL PASS (evidence sha256:372912703192b15b)",
      "lifecycle_verdict:VERIFIED_ISOLATED",
      "not_on_live:true",
      "artifact_sha256_16 acct-schema.sql:8fb4958a39fde049",
      "artifact_sha256_16 acct-v2.sql:5c43a9d4b0df0b75",
      "artifact_sha256_16 acct-v2-fix.sql:71fc5b72d962d53d",
      "artifact_sha256_16 acct-accept2.sql:de140a684bd33bce",
      "known_limitation:Isolated only; not on LIVE Supabase; source stubs simulate legacy tables"
    ],
    scope: "accounting/accounting-kernel",
  },
  {
    ...COMMON,
    candidate_id: "candidate-accounting-financial-event-model-v1",
    name: "accounting-financial-event-model",
    owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/accounting-backend-modules.ts",
    source_location: `${PROOF}/ (acct-schema.sql + acct-v2.sql + acct-v2-fix.sql; verified by acct-accept2.sql) — MODULE FINANCIAL_EVENT_MODEL`,
    input: [
      "Financial Event + evidence (source documents/bank/receipt) for FINANCIAL_EVENT_MODEL"
    ],
    output: [
      "accounting effect for FINANCIAL_EVENT_MODEL derived by the kernel (see behavior)"
    ],
    side_effects: [
      "writes only to the isolated proof DB (acct_reverify); NEVER Supabase LIVE"
    ],
    dependencies: [
      "proven in isolated Postgres 18.4; depends on kernel modules: ACCOUNTING_PERIODS"
    ],
    behavior:
      "Canonical financial_events store; accounting derives effect from event+evidence. BOUNDARY: Single event superset (sale/issue_invoice/receive_payment/pay/expense/wht/vat/refund/adjustment). CANONICAL_TRUTH: YES — event is the entry point to truth. STATUS: VERIFIED_ISOLATED (isolated proof, not on LIVE). KNOWN_LIMITATIONS: debt_events is FEEDER into this, not co-owner.",
    evidence_refs: [
      "isolated pg18.4 127.0.0.1:55432 db=acct_reverify (NOT Supabase LIVE)",
      "acceptance acct-accept2.sql = 23/23 ALL PASS (evidence sha256:372912703192b15b)",
      "lifecycle_verdict:VERIFIED_ISOLATED",
      "not_on_live:true",
      "artifact_sha256_16 acct-schema.sql:8fb4958a39fde049",
      "artifact_sha256_16 acct-v2.sql:5c43a9d4b0df0b75",
      "artifact_sha256_16 acct-v2-fix.sql:71fc5b72d962d53d",
      "artifact_sha256_16 acct-accept2.sql:de140a684bd33bce",
      "known_limitation:debt_events is FEEDER into this, not co-owner"
    ],
    scope: "accounting/financial-event-model",
  },
  {
    ...COMMON,
    candidate_id: "candidate-accounting-financial-event-evidence-v1",
    name: "accounting-financial-event-evidence",
    owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/accounting-backend-modules.ts",
    source_location: `${PROOF}/ (acct-schema.sql + acct-v2.sql + acct-v2-fix.sql; verified by acct-accept2.sql) — MODULE FINANCIAL_EVENT_EVIDENCE`,
    input: [
      "Financial Event + evidence (source documents/bank/receipt) for FINANCIAL_EVENT_EVIDENCE"
    ],
    output: [
      "accounting effect for FINANCIAL_EVENT_EVIDENCE derived by the kernel (see behavior)"
    ],
    side_effects: [
      "writes only to the isolated proof DB (acct_reverify); NEVER Supabase LIVE"
    ],
    dependencies: [
      "proven in isolated Postgres 18.4; depends on kernel modules: FINANCIAL_EVENT_MODEL"
    ],
    behavior:
      "Lineage link event→source without polymorphic FK (real per-source nullable FK + CHECK num_nonnulls=1). BOUNDARY: Evidence/source only; extend by ADD COLUMN+FK. CANONICAL_TRUTH: NO — evidence/source layer, not truth. STATUS: VERIFIED_ISOLATED (isolated proof, not on LIVE). KNOWN_LIMITATIONS: LIVE payments/document_references not yet wired as real FK targets (BLOCKED_LIVE_DATA).",
    evidence_refs: [
      "isolated pg18.4 127.0.0.1:55432 db=acct_reverify (NOT Supabase LIVE)",
      "acceptance acct-accept2.sql = 23/23 ALL PASS (evidence sha256:372912703192b15b)",
      "lifecycle_verdict:VERIFIED_ISOLATED",
      "not_on_live:true",
      "artifact_sha256_16 acct-schema.sql:8fb4958a39fde049",
      "artifact_sha256_16 acct-v2.sql:5c43a9d4b0df0b75",
      "artifact_sha256_16 acct-v2-fix.sql:71fc5b72d962d53d",
      "artifact_sha256_16 acct-accept2.sql:de140a684bd33bce",
      "known_limitation:LIVE payments/document_references not yet wired as real FK targets (BLOCKED_LIVE_DATA)"
    ],
    scope: "accounting/financial-event-evidence",
  },
  {
    ...COMMON,
    candidate_id: "candidate-accounting-chart-of-accounts-v1",
    name: "accounting-chart-of-accounts",
    owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/accounting-backend-modules.ts",
    source_location: `${PROOF}/ (acct-schema.sql + acct-v2.sql + acct-v2-fix.sql; verified by acct-accept2.sql) — MODULE CHART_OF_ACCOUNTS`,
    input: [
      "Financial Event + evidence (source documents/bank/receipt) for CHART_OF_ACCOUNTS"
    ],
    output: [
      "accounting effect for CHART_OF_ACCOUNTS derived by the kernel (see behavior)"
    ],
    side_effects: [
      "writes only to the isolated proof DB (acct_reverify); NEVER Supabase LIVE"
    ],
    dependencies: [
      "proven in isolated Postgres 18.4; depends on kernel modules: none (root)"
    ],
    behavior:
      "Account master (ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE, normal side). BOUNDARY: Canonical account dimension. CANONICAL_TRUTH: YES. STATUS: VERIFIED_ISOLATED (isolated proof, not on LIVE). KNOWN_LIMITATIONS: Seed CoA minimal; full Thai CoA mapping pending.",
    evidence_refs: [
      "isolated pg18.4 127.0.0.1:55432 db=acct_reverify (NOT Supabase LIVE)",
      "acceptance acct-accept2.sql = 23/23 ALL PASS (evidence sha256:372912703192b15b)",
      "lifecycle_verdict:VERIFIED_ISOLATED",
      "not_on_live:true",
      "artifact_sha256_16 acct-schema.sql:8fb4958a39fde049",
      "artifact_sha256_16 acct-v2.sql:5c43a9d4b0df0b75",
      "artifact_sha256_16 acct-v2-fix.sql:71fc5b72d962d53d",
      "artifact_sha256_16 acct-accept2.sql:de140a684bd33bce",
      "known_limitation:Seed CoA minimal; full Thai CoA mapping pending"
    ],
    scope: "accounting/chart-of-accounts",
  },
  {
    ...COMMON,
    candidate_id: "candidate-accounting-accounting-periods-v1",
    name: "accounting-accounting-periods",
    owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/accounting-backend-modules.ts",
    source_location: `${PROOF}/ (acct-schema.sql + acct-v2.sql + acct-v2-fix.sql; verified by acct-accept2.sql) — MODULE ACCOUNTING_PERIODS`,
    input: [
      "Financial Event + evidence (source documents/bank/receipt) for ACCOUNTING_PERIODS"
    ],
    output: [
      "accounting effect for ACCOUNTING_PERIODS derived by the kernel (see behavior)"
    ],
    side_effects: [
      "writes only to the isolated proof DB (acct_reverify); NEVER Supabase LIVE"
    ],
    dependencies: [
      "proven in isolated Postgres 18.4; depends on kernel modules: none (root)"
    ],
    behavior:
      "Period open/close control. BOUNDARY: Rejects posting into CLOSED period. CANONICAL_TRUTH: YES — period authority. STATUS: VERIFIED_ISOLATED (isolated proof, not on LIVE). KNOWN_LIMITATIONS: Manual open/close; no auto period roll.",
    evidence_refs: [
      "isolated pg18.4 127.0.0.1:55432 db=acct_reverify (NOT Supabase LIVE)",
      "acceptance acct-accept2.sql = 23/23 ALL PASS (evidence sha256:372912703192b15b)",
      "lifecycle_verdict:VERIFIED_ISOLATED",
      "not_on_live:true",
      "artifact_sha256_16 acct-schema.sql:8fb4958a39fde049",
      "artifact_sha256_16 acct-v2.sql:5c43a9d4b0df0b75",
      "artifact_sha256_16 acct-v2-fix.sql:71fc5b72d962d53d",
      "artifact_sha256_16 acct-accept2.sql:de140a684bd33bce",
      "known_limitation:Manual open/close; no auto period roll"
    ],
    scope: "accounting/accounting-periods",
  },
  {
    ...COMMON,
    candidate_id: "candidate-accounting-journal-entries-v1",
    name: "accounting-journal-entries",
    owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/accounting-backend-modules.ts",
    source_location: `${PROOF}/ (acct-schema.sql + acct-v2.sql + acct-v2-fix.sql; verified by acct-accept2.sql) — MODULE JOURNAL_ENTRIES`,
    input: [
      "Financial Event + evidence (source documents/bank/receipt) for JOURNAL_ENTRIES"
    ],
    output: [
      "accounting effect for JOURNAL_ENTRIES derived by the kernel (see behavior)"
    ],
    side_effects: [
      "writes only to the isolated proof DB (acct_reverify); NEVER Supabase LIVE"
    ],
    dependencies: [
      "proven in isolated Postgres 18.4; depends on kernel modules: ACCOUNTING_PERIODS, FINANCIAL_EVENT_MODEL"
    ],
    behavior:
      "Balanced journal entry header. BOUNDARY: Canonical GL entry; reversal-linked. CANONICAL_TRUTH: YES. STATUS: VERIFIED_ISOLATED (isolated proof, not on LIVE). KNOWN_LIMITATIONS: —.",
    evidence_refs: [
      "isolated pg18.4 127.0.0.1:55432 db=acct_reverify (NOT Supabase LIVE)",
      "acceptance acct-accept2.sql = 23/23 ALL PASS (evidence sha256:372912703192b15b)",
      "lifecycle_verdict:VERIFIED_ISOLATED",
      "not_on_live:true",
      "artifact_sha256_16 acct-schema.sql:8fb4958a39fde049",
      "artifact_sha256_16 acct-v2.sql:5c43a9d4b0df0b75",
      "artifact_sha256_16 acct-v2-fix.sql:71fc5b72d962d53d",
      "artifact_sha256_16 acct-accept2.sql:de140a684bd33bce",
      "known_limitation:—"
    ],
    scope: "accounting/journal-entries",
  },
  {
    ...COMMON,
    candidate_id: "candidate-accounting-journal-lines-v1",
    name: "accounting-journal-lines",
    owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/accounting-backend-modules.ts",
    source_location: `${PROOF}/ (acct-schema.sql + acct-v2.sql + acct-v2-fix.sql; verified by acct-accept2.sql) — MODULE JOURNAL_LINES`,
    input: [
      "Financial Event + evidence (source documents/bank/receipt) for JOURNAL_LINES"
    ],
    output: [
      "accounting effect for JOURNAL_LINES derived by the kernel (see behavior)"
    ],
    side_effects: [
      "writes only to the isolated proof DB (acct_reverify); NEVER Supabase LIVE"
    ],
    dependencies: [
      "proven in isolated Postgres 18.4; depends on kernel modules: JOURNAL_ENTRIES, CHART_OF_ACCOUNTS"
    ],
    behavior:
      "Debit/credit posting lines, per-document, per-party. BOUNDARY: Canonical GL line; one_side_only CHECK. CANONICAL_TRUTH: YES. STATUS: VERIFIED_ISOLATED (isolated proof, not on LIVE). KNOWN_LIMITATIONS: Distinct from commercial invoice_items (not conflated).",
    evidence_refs: [
      "isolated pg18.4 127.0.0.1:55432 db=acct_reverify (NOT Supabase LIVE)",
      "acceptance acct-accept2.sql = 23/23 ALL PASS (evidence sha256:372912703192b15b)",
      "lifecycle_verdict:VERIFIED_ISOLATED",
      "not_on_live:true",
      "artifact_sha256_16 acct-schema.sql:8fb4958a39fde049",
      "artifact_sha256_16 acct-v2.sql:5c43a9d4b0df0b75",
      "artifact_sha256_16 acct-v2-fix.sql:71fc5b72d962d53d",
      "artifact_sha256_16 acct-accept2.sql:de140a684bd33bce",
      "known_limitation:Distinct from commercial invoice_items (not conflated)"
    ],
    scope: "accounting/journal-lines",
  },
  {
    ...COMMON,
    candidate_id: "candidate-accounting-double-entry-enforcement-v1",
    name: "accounting-double-entry-enforcement",
    owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/accounting-backend-modules.ts",
    source_location: `${PROOF}/ (acct-schema.sql + acct-v2.sql + acct-v2-fix.sql; verified by acct-accept2.sql) — MODULE DOUBLE_ENTRY_ENFORCEMENT`,
    input: [
      "Financial Event + evidence (source documents/bank/receipt) for DOUBLE_ENTRY_ENFORCEMENT"
    ],
    output: [
      "accounting effect for DOUBLE_ENTRY_ENFORCEMENT derived by the kernel (see behavior)"
    ],
    side_effects: [
      "writes only to the isolated proof DB (acct_reverify); NEVER Supabase LIVE"
    ],
    dependencies: [
      "proven in isolated Postgres 18.4; depends on kernel modules: JOURNAL_LINES"
    ],
    behavior:
      "DB deferred constraint trigger Σdebit=Σcredit per entry. BOUNDARY: Structural guarantee at commit. CANONICAL_TRUTH: YES — integrity. STATUS: VERIFIED_ISOLATED (isolated proof, not on LIVE). KNOWN_LIMITATIONS: Proven: trial balance 56,935=56,935.",
    evidence_refs: [
      "isolated pg18.4 127.0.0.1:55432 db=acct_reverify (NOT Supabase LIVE)",
      "acceptance acct-accept2.sql = 23/23 ALL PASS (evidence sha256:372912703192b15b)",
      "lifecycle_verdict:VERIFIED_ISOLATED",
      "not_on_live:true",
      "artifact_sha256_16 acct-schema.sql:8fb4958a39fde049",
      "artifact_sha256_16 acct-v2.sql:5c43a9d4b0df0b75",
      "artifact_sha256_16 acct-v2-fix.sql:71fc5b72d962d53d",
      "artifact_sha256_16 acct-accept2.sql:de140a684bd33bce",
      "known_limitation:Proven: trial balance 56,935=56,935"
    ],
    scope: "accounting/double-entry-enforcement",
  },
  {
    ...COMMON,
    candidate_id: "candidate-accounting-immutable-posting-v1",
    name: "accounting-immutable-posting",
    owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/accounting-backend-modules.ts",
    source_location: `${PROOF}/ (acct-schema.sql + acct-v2.sql + acct-v2-fix.sql; verified by acct-accept2.sql) — MODULE IMMUTABLE_POSTING`,
    input: [
      "Financial Event + evidence (source documents/bank/receipt) for IMMUTABLE_POSTING"
    ],
    output: [
      "accounting effect for IMMUTABLE_POSTING derived by the kernel (see behavior)"
    ],
    side_effects: [
      "writes only to the isolated proof DB (acct_reverify); NEVER Supabase LIVE"
    ],
    dependencies: [
      "proven in isolated Postgres 18.4; depends on kernel modules: JOURNAL_ENTRIES, JOURNAL_LINES"
    ],
    behavior:
      "Reject UPDATE/DELETE on entries/lines. BOUNDARY: Corrections only via reversal. CANONICAL_TRUTH: YES. STATUS: VERIFIED_ISOLATED (isolated proof, not on LIVE). KNOWN_LIMITATIONS: Proven: IMMUTABLE_LEDGER rejection.",
    evidence_refs: [
      "isolated pg18.4 127.0.0.1:55432 db=acct_reverify (NOT Supabase LIVE)",
      "acceptance acct-accept2.sql = 23/23 ALL PASS (evidence sha256:372912703192b15b)",
      "lifecycle_verdict:VERIFIED_ISOLATED",
      "not_on_live:true",
      "artifact_sha256_16 acct-schema.sql:8fb4958a39fde049",
      "artifact_sha256_16 acct-v2.sql:5c43a9d4b0df0b75",
      "artifact_sha256_16 acct-v2-fix.sql:71fc5b72d962d53d",
      "artifact_sha256_16 acct-accept2.sql:de140a684bd33bce",
      "known_limitation:Proven: IMMUTABLE_LEDGER rejection"
    ],
    scope: "accounting/immutable-posting",
  },
  {
    ...COMMON,
    candidate_id: "candidate-accounting-reversal-v1",
    name: "accounting-reversal",
    owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/accounting-backend-modules.ts",
    source_location: `${PROOF}/ (acct-schema.sql + acct-v2.sql + acct-v2-fix.sql; verified by acct-accept2.sql) — MODULE REVERSAL`,
    input: [
      "Financial Event + evidence (source documents/bank/receipt) for REVERSAL"
    ],
    output: [
      "accounting effect for REVERSAL derived by the kernel (see behavior)"
    ],
    side_effects: [
      "writes only to the isolated proof DB (acct_reverify); NEVER Supabase LIVE"
    ],
    dependencies: [
      "proven in isolated Postgres 18.4; depends on kernel modules: IMMUTABLE_POSTING"
    ],
    behavior:
      "Mirror-entry reversal preserving doc_kind/party. BOUNDARY: Immutable-safe correction. CANONICAL_TRUTH: YES. STATUS: VERIFIED_ISOLATED (isolated proof, not on LIVE). KNOWN_LIMITATIONS: Proven: AR C/D restored on reversal, still balanced.",
    evidence_refs: [
      "isolated pg18.4 127.0.0.1:55432 db=acct_reverify (NOT Supabase LIVE)",
      "acceptance acct-accept2.sql = 23/23 ALL PASS (evidence sha256:372912703192b15b)",
      "lifecycle_verdict:VERIFIED_ISOLATED",
      "not_on_live:true",
      "artifact_sha256_16 acct-schema.sql:8fb4958a39fde049",
      "artifact_sha256_16 acct-v2.sql:5c43a9d4b0df0b75",
      "artifact_sha256_16 acct-v2-fix.sql:71fc5b72d962d53d",
      "artifact_sha256_16 acct-accept2.sql:de140a684bd33bce",
      "known_limitation:Proven: AR C/D restored on reversal, still balanced"
    ],
    scope: "accounting/reversal",
  },
  {
    ...COMMON,
    candidate_id: "candidate-accounting-idempotent-posting-v1",
    name: "accounting-idempotent-posting",
    owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/accounting-backend-modules.ts",
    source_location: `${PROOF}/ (acct-schema.sql + acct-v2.sql + acct-v2-fix.sql; verified by acct-accept2.sql) — MODULE IDEMPOTENT_POSTING`,
    input: [
      "Financial Event + evidence (source documents/bank/receipt) for IDEMPOTENT_POSTING"
    ],
    output: [
      "accounting effect for IDEMPOTENT_POSTING derived by the kernel (see behavior)"
    ],
    side_effects: [
      "writes only to the isolated proof DB (acct_reverify); NEVER Supabase LIVE"
    ],
    dependencies: [
      "proven in isolated Postgres 18.4; depends on kernel modules: FINANCIAL_EVENT_MODEL"
    ],
    behavior:
      "Unique idempotency_key; re-post returns same entry, no new lines. BOUNDARY: Prevents double-posting. CANONICAL_TRUTH: YES. STATUS: VERIFIED_ISOLATED (isolated proof, not on LIVE). KNOWN_LIMITATIONS: Proven: dup event rejected + re-post no new lines.",
    evidence_refs: [
      "isolated pg18.4 127.0.0.1:55432 db=acct_reverify (NOT Supabase LIVE)",
      "acceptance acct-accept2.sql = 23/23 ALL PASS (evidence sha256:372912703192b15b)",
      "lifecycle_verdict:VERIFIED_ISOLATED",
      "not_on_live:true",
      "artifact_sha256_16 acct-schema.sql:8fb4958a39fde049",
      "artifact_sha256_16 acct-v2.sql:5c43a9d4b0df0b75",
      "artifact_sha256_16 acct-v2-fix.sql:71fc5b72d962d53d",
      "artifact_sha256_16 acct-accept2.sql:de140a684bd33bce",
      "known_limitation:Proven: dup event rejected + re-post no new lines"
    ],
    scope: "accounting/idempotent-posting",
  },
  {
    ...COMMON,
    candidate_id: "candidate-accounting-ar-per-document-v1",
    name: "accounting-ar-per-document",
    owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/accounting-backend-modules.ts",
    source_location: `${PROOF}/ (acct-schema.sql + acct-v2.sql + acct-v2-fix.sql; verified by acct-accept2.sql) — MODULE AR_PER_DOCUMENT`,
    input: [
      "Financial Event + evidence (source documents/bank/receipt) for AR_PER_DOCUMENT"
    ],
    output: [
      "accounting effect for AR_PER_DOCUMENT derived by the kernel (see behavior)"
    ],
    side_effects: [
      "writes only to the isolated proof DB (acct_reverify); NEVER Supabase LIVE"
    ],
    dependencies: [
      "proven in isolated Postgres 18.4; depends on kernel modules: JOURNAL_LINES"
    ],
    behavior:
      "Accounts-receivable balance per invoice (not company-level). BOUNDARY: Derived from ledger view. CANONICAL_TRUTH: YES — replaces debt_snapshots as AR truth. STATUS: VERIFIED_ISOLATED (isolated proof, not on LIVE). KNOWN_LIMITATIONS: debt_snapshots becomes PROJECTION.",
    evidence_refs: [
      "isolated pg18.4 127.0.0.1:55432 db=acct_reverify (NOT Supabase LIVE)",
      "acceptance acct-accept2.sql = 23/23 ALL PASS (evidence sha256:372912703192b15b)",
      "lifecycle_verdict:VERIFIED_ISOLATED",
      "not_on_live:true",
      "artifact_sha256_16 acct-schema.sql:8fb4958a39fde049",
      "artifact_sha256_16 acct-v2.sql:5c43a9d4b0df0b75",
      "artifact_sha256_16 acct-v2-fix.sql:71fc5b72d962d53d",
      "artifact_sha256_16 acct-accept2.sql:de140a684bd33bce",
      "known_limitation:debt_snapshots becomes PROJECTION"
    ],
    scope: "accounting/ar-per-document",
  },
  {
    ...COMMON,
    candidate_id: "candidate-accounting-ap-per-document-v1",
    name: "accounting-ap-per-document",
    owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/accounting-backend-modules.ts",
    source_location: `${PROOF}/ (acct-schema.sql + acct-v2.sql + acct-v2-fix.sql; verified by acct-accept2.sql) — MODULE AP_PER_DOCUMENT`,
    input: [
      "Financial Event + evidence (source documents/bank/receipt) for AP_PER_DOCUMENT"
    ],
    output: [
      "accounting effect for AP_PER_DOCUMENT derived by the kernel (see behavior)"
    ],
    side_effects: [
      "writes only to the isolated proof DB (acct_reverify); NEVER Supabase LIVE"
    ],
    dependencies: [
      "proven in isolated Postgres 18.4; depends on kernel modules: JOURNAL_LINES"
    ],
    behavior:
      "Accounts-payable balance per supplier document. BOUNDARY: Derived from ledger view. CANONICAL_TRUTH: YES. STATUS: VERIFIED_ISOLATED (isolated proof, not on LIVE). KNOWN_LIMITATIONS: Proven: AP supplier F=0 after pay.",
    evidence_refs: [
      "isolated pg18.4 127.0.0.1:55432 db=acct_reverify (NOT Supabase LIVE)",
      "acceptance acct-accept2.sql = 23/23 ALL PASS (evidence sha256:372912703192b15b)",
      "lifecycle_verdict:VERIFIED_ISOLATED",
      "not_on_live:true",
      "artifact_sha256_16 acct-schema.sql:8fb4958a39fde049",
      "artifact_sha256_16 acct-v2.sql:5c43a9d4b0df0b75",
      "artifact_sha256_16 acct-v2-fix.sql:71fc5b72d962d53d",
      "artifact_sha256_16 acct-accept2.sql:de140a684bd33bce",
      "known_limitation:Proven: AP supplier F=0 after pay"
    ],
    scope: "accounting/ap-per-document",
  },
  {
    ...COMMON,
    candidate_id: "candidate-accounting-payment-allocations-v1",
    name: "accounting-payment-allocations",
    owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/accounting-backend-modules.ts",
    source_location: `${PROOF}/ (acct-schema.sql + acct-v2.sql + acct-v2-fix.sql; verified by acct-accept2.sql) — MODULE PAYMENT_ALLOCATIONS`,
    input: [
      "Financial Event + evidence (source documents/bank/receipt) for PAYMENT_ALLOCATIONS"
    ],
    output: [
      "accounting effect for PAYMENT_ALLOCATIONS derived by the kernel (see behavior)"
    ],
    side_effects: [
      "writes only to the isolated proof DB (acct_reverify); NEVER Supabase LIVE"
    ],
    dependencies: [
      "proven in isolated Postgres 18.4; depends on kernel modules: AR_PER_DOCUMENT"
    ],
    behavior:
      "Allocate a payment across invoices (partial/multi). BOUNDARY: Row-level 'receipt X applied Y to invoice Z'. CANONICAL_TRUTH: YES — replaces destructive paid_amount decrement. STATUS: VERIFIED_ISOLATED (isolated proof, not on LIVE). KNOWN_LIMITATIONS: Proven: AR B=570 PARTIAL, C+D=0 multi; LIVE `payments` overlap must be reconciled (BLOCKED_LIVE_DATA).",
    evidence_refs: [
      "isolated pg18.4 127.0.0.1:55432 db=acct_reverify (NOT Supabase LIVE)",
      "acceptance acct-accept2.sql = 23/23 ALL PASS (evidence sha256:372912703192b15b)",
      "lifecycle_verdict:VERIFIED_ISOLATED",
      "not_on_live:true",
      "artifact_sha256_16 acct-schema.sql:8fb4958a39fde049",
      "artifact_sha256_16 acct-v2.sql:5c43a9d4b0df0b75",
      "artifact_sha256_16 acct-v2-fix.sql:71fc5b72d962d53d",
      "artifact_sha256_16 acct-accept2.sql:de140a684bd33bce",
      "known_limitation:Proven: AR B=570 PARTIAL, C+D=0 multi; LIVE `payments` overlap must be reconciled (BLOCKED_LIVE_DATA)"
    ],
    scope: "accounting/payment-allocations",
  },
  {
    ...COMMON,
    candidate_id: "candidate-accounting-reconciliation-matches-v1",
    name: "accounting-reconciliation-matches",
    owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/accounting-backend-modules.ts",
    source_location: `${PROOF}/ (acct-schema.sql + acct-v2.sql + acct-v2-fix.sql; verified by acct-accept2.sql) — MODULE RECONCILIATION_MATCHES`,
    input: [
      "Financial Event + evidence (source documents/bank/receipt) for RECONCILIATION_MATCHES"
    ],
    output: [
      "accounting effect for RECONCILIATION_MATCHES derived by the kernel (see behavior)"
    ],
    side_effects: [
      "writes only to the isolated proof DB (acct_reverify); NEVER Supabase LIVE"
    ],
    dependencies: [
      "proven in isolated Postgres 18.4; depends on kernel modules: FINANCIAL_EVENT_EVIDENCE"
    ],
    behavior:
      "Persist bank-row ↔ document ↔ event match. BOUNDARY: First-class match ledger (vs legacy scalar matched_* FK). CANONICAL_TRUTH: NO — matching/evidence layer. STATUS: VERIFIED_ISOLATED (isolated proof, not on LIVE). KNOWN_LIMITATIONS: Auto-matcher algorithm not built; test supplies matches; must absorb legacy matched_* columns (MAP).",
    evidence_refs: [
      "isolated pg18.4 127.0.0.1:55432 db=acct_reverify (NOT Supabase LIVE)",
      "acceptance acct-accept2.sql = 23/23 ALL PASS (evidence sha256:372912703192b15b)",
      "lifecycle_verdict:VERIFIED_ISOLATED",
      "not_on_live:true",
      "artifact_sha256_16 acct-schema.sql:8fb4958a39fde049",
      "artifact_sha256_16 acct-v2.sql:5c43a9d4b0df0b75",
      "artifact_sha256_16 acct-v2-fix.sql:71fc5b72d962d53d",
      "artifact_sha256_16 acct-accept2.sql:de140a684bd33bce",
      "known_limitation:Auto-matcher algorithm not built; test supplies matches; must absorb legacy matched_* columns (MAP)"
    ],
    scope: "accounting/reconciliation-matches",
  },
  {
    ...COMMON,
    candidate_id: "candidate-accounting-vat-ledger-v1",
    name: "accounting-vat-ledger",
    owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/accounting-backend-modules.ts",
    source_location: `${PROOF}/ (acct-schema.sql + acct-v2.sql + acct-v2-fix.sql; verified by acct-accept2.sql) — MODULE VAT_LEDGER`,
    input: [
      "Financial Event + evidence (source documents/bank/receipt) for VAT_LEDGER"
    ],
    output: [
      "accounting effect for VAT_LEDGER derived by the kernel (see behavior)"
    ],
    side_effects: [
      "writes only to the isolated proof DB (acct_reverify); NEVER Supabase LIVE"
    ],
    dependencies: [
      "proven in isolated Postgres 18.4; depends on kernel modules: JOURNAL_LINES"
    ],
    behavior:
      "Output/Input VAT posting accounts. BOUNDARY: Canonical VAT position from ledger. CANONICAL_TRUTH: YES — replaces flat vat_amount columns as VAT truth. STATUS: VERIFIED_ISOLATED (isolated proof, not on LIVE). KNOWN_LIMITATIONS: legacy invoices.vat_amount = source only.",
    evidence_refs: [
      "isolated pg18.4 127.0.0.1:55432 db=acct_reverify (NOT Supabase LIVE)",
      "acceptance acct-accept2.sql = 23/23 ALL PASS (evidence sha256:372912703192b15b)",
      "lifecycle_verdict:VERIFIED_ISOLATED",
      "not_on_live:true",
      "artifact_sha256_16 acct-schema.sql:8fb4958a39fde049",
      "artifact_sha256_16 acct-v2.sql:5c43a9d4b0df0b75",
      "artifact_sha256_16 acct-v2-fix.sql:71fc5b72d962d53d",
      "artifact_sha256_16 acct-accept2.sql:de140a684bd33bce",
      "known_limitation:legacy invoices.vat_amount = source only"
    ],
    scope: "accounting/vat-ledger",
  },
  {
    ...COMMON,
    candidate_id: "candidate-accounting-wht-ledger-v1",
    name: "accounting-wht-ledger",
    owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/accounting-backend-modules.ts",
    source_location: `${PROOF}/ (acct-schema.sql + acct-v2.sql + acct-v2-fix.sql; verified by acct-accept2.sql) — MODULE WHT_LEDGER`,
    input: [
      "Financial Event + evidence (source documents/bank/receipt) for WHT_LEDGER"
    ],
    output: [
      "accounting effect for WHT_LEDGER derived by the kernel (see behavior)"
    ],
    side_effects: [
      "writes only to the isolated proof DB (acct_reverify); NEVER Supabase LIVE"
    ],
    dependencies: [
      "proven in isolated Postgres 18.4; depends on kernel modules: JOURNAL_LINES"
    ],
    behavior:
      "WHT receivable (customer withheld) + WHT payable (we withheld supplier). BOUNDARY: Canonical WHT position. CANONICAL_TRUTH: YES. STATUS: VERIFIED_ISOLATED (isolated proof, not on LIVE). KNOWN_LIMITATIONS: Proven: WHT recv=300, payable=30; no WHT structure existed in legacy.",
    evidence_refs: [
      "isolated pg18.4 127.0.0.1:55432 db=acct_reverify (NOT Supabase LIVE)",
      "acceptance acct-accept2.sql = 23/23 ALL PASS (evidence sha256:372912703192b15b)",
      "lifecycle_verdict:VERIFIED_ISOLATED",
      "not_on_live:true",
      "artifact_sha256_16 acct-schema.sql:8fb4958a39fde049",
      "artifact_sha256_16 acct-v2.sql:5c43a9d4b0df0b75",
      "artifact_sha256_16 acct-v2-fix.sql:71fc5b72d962d53d",
      "artifact_sha256_16 acct-accept2.sql:de140a684bd33bce",
      "known_limitation:Proven: WHT recv=300, payable=30; no WHT structure existed in legacy"
    ],
    scope: "accounting/wht-ledger",
  },
  {
    ...COMMON,
    candidate_id: "candidate-accounting-trial-balance-v1",
    name: "accounting-trial-balance",
    owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/accounting-backend-modules.ts",
    source_location: `${PROOF}/ (acct-schema.sql + acct-v2.sql + acct-v2-fix.sql; verified by acct-accept2.sql) — MODULE TRIAL_BALANCE`,
    input: [
      "Financial Event + evidence (source documents/bank/receipt) for TRIAL_BALANCE"
    ],
    output: [
      "accounting effect for TRIAL_BALANCE derived by the kernel (see behavior)"
    ],
    side_effects: [
      "writes only to the isolated proof DB (acct_reverify); NEVER Supabase LIVE"
    ],
    dependencies: [
      "proven in isolated Postgres 18.4; depends on kernel modules: JOURNAL_LINES"
    ],
    behavior:
      "Σdebit=Σcredit report + signed-balance-sums-to-0. BOUNDARY: Derived report. CANONICAL_TRUTH: DERIVED. STATUS: VERIFIED_ISOLATED (isolated proof, not on LIVE). KNOWN_LIMITATIONS: —.",
    evidence_refs: [
      "isolated pg18.4 127.0.0.1:55432 db=acct_reverify (NOT Supabase LIVE)",
      "acceptance acct-accept2.sql = 23/23 ALL PASS (evidence sha256:372912703192b15b)",
      "lifecycle_verdict:VERIFIED_ISOLATED",
      "not_on_live:true",
      "artifact_sha256_16 acct-schema.sql:8fb4958a39fde049",
      "artifact_sha256_16 acct-v2.sql:5c43a9d4b0df0b75",
      "artifact_sha256_16 acct-v2-fix.sql:71fc5b72d962d53d",
      "artifact_sha256_16 acct-accept2.sql:de140a684bd33bce",
      "known_limitation:—"
    ],
    scope: "accounting/trial-balance",
  },
  {
    ...COMMON,
    candidate_id: "candidate-accounting-profit-and-loss-v1",
    name: "accounting-profit-and-loss",
    owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/accounting-backend-modules.ts",
    source_location: `${PROOF}/ (acct-schema.sql + acct-v2.sql + acct-v2-fix.sql; verified by acct-accept2.sql) — MODULE PROFIT_AND_LOSS`,
    input: [
      "Financial Event + evidence (source documents/bank/receipt) for PROFIT_AND_LOSS"
    ],
    output: [
      "accounting effect for PROFIT_AND_LOSS derived by the kernel (see behavior)"
    ],
    side_effects: [
      "writes only to the isolated proof DB (acct_reverify); NEVER Supabase LIVE"
    ],
    dependencies: [
      "proven in isolated Postgres 18.4; depends on kernel modules: JOURNAL_LINES, CHART_OF_ACCOUNTS"
    ],
    behavior:
      "P&L from revenue/expense accounts. BOUNDARY: Derived report. CANONICAL_TRUTH: DERIVED. STATUS: VERIFIED_ISOLATED (isolated proof, not on LIVE). KNOWN_LIMITATIONS: Revenue/Expense only; accruals/depreciation not modeled.",
    evidence_refs: [
      "isolated pg18.4 127.0.0.1:55432 db=acct_reverify (NOT Supabase LIVE)",
      "acceptance acct-accept2.sql = 23/23 ALL PASS (evidence sha256:372912703192b15b)",
      "lifecycle_verdict:VERIFIED_ISOLATED",
      "not_on_live:true",
      "artifact_sha256_16 acct-schema.sql:8fb4958a39fde049",
      "artifact_sha256_16 acct-v2.sql:5c43a9d4b0df0b75",
      "artifact_sha256_16 acct-v2-fix.sql:71fc5b72d962d53d",
      "artifact_sha256_16 acct-accept2.sql:de140a684bd33bce",
      "known_limitation:Revenue/Expense only; accruals/depreciation not modeled"
    ],
    scope: "accounting/profit-and-loss",
  },
  {
    ...COMMON,
    candidate_id: "candidate-accounting-balance-sheet-v1",
    name: "accounting-balance-sheet",
    owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/accounting-backend-modules.ts",
    source_location: `${PROOF}/ (acct-schema.sql + acct-v2.sql + acct-v2-fix.sql; verified by acct-accept2.sql) — MODULE BALANCE_SHEET`,
    input: [
      "Financial Event + evidence (source documents/bank/receipt) for BALANCE_SHEET"
    ],
    output: [
      "accounting effect for BALANCE_SHEET derived by the kernel (see behavior)"
    ],
    side_effects: [
      "writes only to the isolated proof DB (acct_reverify); NEVER Supabase LIVE"
    ],
    dependencies: [
      "proven in isolated Postgres 18.4; depends on kernel modules: JOURNAL_LINES, CHART_OF_ACCOUNTS"
    ],
    behavior:
      "Assets=Liabilities+Equity from ledger. BOUNDARY: Derived report. CANONICAL_TRUTH: DERIVED. STATUS: VERIFIED_ISOLATED (isolated proof, not on LIVE). KNOWN_LIMITATIONS: Retained earnings seed only.",
    evidence_refs: [
      "isolated pg18.4 127.0.0.1:55432 db=acct_reverify (NOT Supabase LIVE)",
      "acceptance acct-accept2.sql = 23/23 ALL PASS (evidence sha256:372912703192b15b)",
      "lifecycle_verdict:VERIFIED_ISOLATED",
      "not_on_live:true",
      "artifact_sha256_16 acct-schema.sql:8fb4958a39fde049",
      "artifact_sha256_16 acct-v2.sql:5c43a9d4b0df0b75",
      "artifact_sha256_16 acct-v2-fix.sql:71fc5b72d962d53d",
      "artifact_sha256_16 acct-accept2.sql:de140a684bd33bce",
      "known_limitation:Retained earnings seed only"
    ],
    scope: "accounting/balance-sheet",
  },
  {
    ...COMMON,
    candidate_id: "candidate-accounting-vat-report-v1",
    name: "accounting-vat-report",
    owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/accounting-backend-modules.ts",
    source_location: `${PROOF}/ (acct-schema.sql + acct-v2.sql + acct-v2-fix.sql; verified by acct-accept2.sql) — MODULE VAT_REPORT`,
    input: [
      "Financial Event + evidence (source documents/bank/receipt) for VAT_REPORT"
    ],
    output: [
      "accounting effect for VAT_REPORT derived by the kernel (see behavior)"
    ],
    side_effects: [
      "writes only to the isolated proof DB (acct_reverify); NEVER Supabase LIVE"
    ],
    dependencies: [
      "proven in isolated Postgres 18.4; depends on kernel modules: VAT_LEDGER, ACCOUNTING_PERIODS"
    ],
    behavior:
      "PP30-shaped output/input/net VAT for period. BOUNDARY: Derived from VAT_LEDGER. CANONICAL_TRUTH: DERIVED. STATUS: VERIFIED_ISOLATED (isolated proof, not on LIVE). KNOWN_LIMITATIONS: Proven: out 1715 / in 70 / net 1645.",
    evidence_refs: [
      "isolated pg18.4 127.0.0.1:55432 db=acct_reverify (NOT Supabase LIVE)",
      "acceptance acct-accept2.sql = 23/23 ALL PASS (evidence sha256:372912703192b15b)",
      "lifecycle_verdict:VERIFIED_ISOLATED",
      "not_on_live:true",
      "artifact_sha256_16 acct-schema.sql:8fb4958a39fde049",
      "artifact_sha256_16 acct-v2.sql:5c43a9d4b0df0b75",
      "artifact_sha256_16 acct-v2-fix.sql:71fc5b72d962d53d",
      "artifact_sha256_16 acct-accept2.sql:de140a684bd33bce",
      "known_limitation:Proven: out 1715 / in 70 / net 1645"
    ],
    scope: "accounting/vat-report",
  },
  {
    ...COMMON,
    candidate_id: "candidate-accounting-wht-report-v1",
    name: "accounting-wht-report",
    owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/accounting-backend-modules.ts",
    source_location: `${PROOF}/ (acct-schema.sql + acct-v2.sql + acct-v2-fix.sql; verified by acct-accept2.sql) — MODULE WHT_REPORT`,
    input: [
      "Financial Event + evidence (source documents/bank/receipt) for WHT_REPORT"
    ],
    output: [
      "accounting effect for WHT_REPORT derived by the kernel (see behavior)"
    ],
    side_effects: [
      "writes only to the isolated proof DB (acct_reverify); NEVER Supabase LIVE"
    ],
    dependencies: [
      "proven in isolated Postgres 18.4; depends on kernel modules: WHT_LEDGER, ACCOUNTING_PERIODS"
    ],
    behavior:
      "PND-shaped WHT recv/payable for period. BOUNDARY: Derived from WHT_LEDGER. CANONICAL_TRUTH: DERIVED. STATUS: VERIFIED_ISOLATED (isolated proof, not on LIVE). KNOWN_LIMITATIONS: Form-field mapping to PND1/3/53 not finalized.",
    evidence_refs: [
      "isolated pg18.4 127.0.0.1:55432 db=acct_reverify (NOT Supabase LIVE)",
      "acceptance acct-accept2.sql = 23/23 ALL PASS (evidence sha256:372912703192b15b)",
      "lifecycle_verdict:VERIFIED_ISOLATED",
      "not_on_live:true",
      "artifact_sha256_16 acct-schema.sql:8fb4958a39fde049",
      "artifact_sha256_16 acct-v2.sql:5c43a9d4b0df0b75",
      "artifact_sha256_16 acct-v2-fix.sql:71fc5b72d962d53d",
      "artifact_sha256_16 acct-accept2.sql:de140a684bd33bce",
      "known_limitation:Form-field mapping to PND1/3/53 not finalized"
    ],
    scope: "accounting/wht-report",
  },
  {
    ...COMMON,
    candidate_id: "candidate-accounting-tax-submission-package-builder-v1",
    name: "accounting-tax-submission-package-builder",
    owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/accounting-backend-modules.ts",
    source_location: `${PROOF}/ (acct-schema.sql + acct-v2.sql + acct-v2-fix.sql; verified by acct-accept2.sql) — MODULE TAX_SUBMISSION_PACKAGE_BUILDER`,
    input: [
      "Financial Event + evidence (source documents/bank/receipt) for TAX_SUBMISSION_PACKAGE_BUILDER"
    ],
    output: [
      "accounting effect for TAX_SUBMISSION_PACKAGE_BUILDER derived by the kernel (see behavior)"
    ],
    side_effects: [
      "writes only to the isolated proof DB (acct_reverify); NEVER Supabase LIVE"
    ],
    dependencies: [
      "proven in isolated Postgres 18.4; depends on kernel modules: VAT_REPORT, WHT_REPORT"
    ],
    behavior:
      "Build PP30/PND package from ledger (status DRAFT/BUILT/...). BOUNDARY: Builds package; does NOT submit. CANONICAL_TRUTH: DERIVED from ledger. STATUS: VERIFIED_ISOLATED (isolated proof, not on LIVE). KNOWN_LIMITATIONS: Build proven (status BUILT). ACTUAL RD/e-Tax SUBMISSION = NOT_PROVEN_EXTERNAL (no registration/auth/interface proven).",
    evidence_refs: [
      "isolated pg18.4 127.0.0.1:55432 db=acct_reverify (NOT Supabase LIVE)",
      "acceptance acct-accept2.sql = 23/23 ALL PASS (evidence sha256:372912703192b15b)",
      "lifecycle_verdict:VERIFIED_ISOLATED",
      "not_on_live:true",
      "artifact_sha256_16 acct-schema.sql:8fb4958a39fde049",
      "artifact_sha256_16 acct-v2.sql:5c43a9d4b0df0b75",
      "artifact_sha256_16 acct-v2-fix.sql:71fc5b72d962d53d",
      "artifact_sha256_16 acct-accept2.sql:de140a684bd33bce",
      "known_limitation:Build proven (status BUILT). ACTUAL RD/e-Tax SUBMISSION = NOT_PROVEN_EXTERNAL (no registration/auth/interface proven)"
    ],
    scope: "accounting/tax-submission-package-builder",
  }
];
