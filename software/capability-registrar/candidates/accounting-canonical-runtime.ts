/**
 * หน้าที่: ลงทะเบียน canonical accounting runtime จากของที่รันจริง
 * Owner, 2026-09-05 — TASK: CONSOLIDATE_ACCOUNTING_INTO_EXISTING_CANONICAL_RUNTIME (Phase 4)
 *
 * source_location เป็น relative path ล้วน คั่นด้วย " + " เท่านั้น
 * ห้ามมีวงเล็บ ห้ามมีคำบรรยาย ห้ามใช้ absolute path
 * เพราะ governance/boundary-definition/source-evidence.ts resolveSources()
 * split ด้วย "+" แล้ว existsSync ทีละชิ้น — พิสูจน์แล้วว่ารูปแบบนี้ resolve ได้จริง
 *
 * record เก่า 24 ตัวยังคง RETIRED ตามคำสั่งเจ้าของ 2026-09-04 ไม่ REACTIVATE
 *
 * Input: ไม่มี (ค่าคงที่)  Output: ACCOUNTING_CANONICAL_CANDIDATES
 * สิ่งที่ห้ามแตะ: ห้ามใส่ evidence ที่ยังไม่ได้วัด ห้ามเปลี่ยนสถานะเป็น LIVE
 */

import type { RegistrationCandidate } from "../../../control/event-pipeline/registration-contract";

const REPO = "../DNA-OS-บัญชีการเงิน";

const COMMON = {
  kind: "capability" as const,
  version: "1.0.0",
  domain: "SOFTWARE_CONTROL_PLANE" as const,
  resource_type: "CAPABILITY" as const,
  data_classification: "INTERNAL",
  source_system: "dna-os-financial-documents",
  origin: {
    origin_kind: "PROVEN_RUNNING_RUNTIME",
    origin_reference: "TASK:CONSOLIDATE_ACCOUNTING_INTO_EXISTING_CANONICAL_RUNTIME",
    introduced_by: "software/capability-registrar/register-accounting-canonical-runtime.ts",
  },
};

const EVIDENCE = [
  "repository://t23598788-oss/DNA-OS-FINANCIAL-DOCUMENTS-LOCAL-RECOVERY-2026-09-03",
  "commit 148b8d7fe9c9d1a1d465b9020bddfc933cea637c",
  "${REPO}/evidence/EVIDENCE-consolidated-20260905T110755Z.json",
  "KERNEL 23/23 · HTTP 33/33 · MERGE 25/25 · STRESS 35/35 · PAYMENT 21/21 · failures 0",
  "isolated pg18.4 port 55470 db fin_consol — NOT production",
  "lifecycle_verdict:VERIFIED_ISOLATED, not_on_live:true",
];

export const ACCOUNTING_CANONICAL_CANDIDATES: readonly RegistrationCandidate[] = [
  {
    ...COMMON,
    candidate_id: "candidate-accounting-api-canonical-v1",
    name: "accounting-tax-document-api",
    owner: "DNA-OS-FINANCIAL-DOCUMENTS/src/api",
    scope: "accounting/http-boundary",
    source_location: `${REPO}/src/api/server.mjs + ${REPO}/src/api/db.mjs + ${REPO}/src/api/documents.mjs + ${REPO}/src/calculation/calculation.mjs + ${REPO}/src/write-intent/write-intent.mjs`,
    input: [
      "POST /financial-events", "POST /documents/invoices", "POST /documents/receipts",
      "POST /documents/payment-vouchers", "POST /documents/tax-invoices", "POST /documents/wht-certificates",
      "POST /payments/receive", "POST /payments/pay", "POST /payments/refund",
      "POST /reconciliation/match", "POST /periods/close", "POST /reversals",
      "GET /journals/:id /ar/:id /ap/:id /invariants /health",
      "GET /reports/trial-balance /reports/profit-loss /reports/balance-sheet",
      "GET /tax/vat /tax/wht /tax/package /documents/:id /documents/:id/file",
    ],
    output: [
      "envelope request_id status financial_event_id journal_entry_id evidence_refs tax_effect error_code error_detail",
    ],
    side_effects: [
      "เขียนผ่าน adapters.sql เข้า kernel เท่านั้น ไม่มี consumer ใดเขียน SQL ตรง",
      "ทุก write route สร้าง WriteIntent และผ่าน write gate ก่อนเสมอ",
    ],
    dependencies: ["accounting-kernel-canonical (schemas + adapters)", "pg"],
    behavior:
      "ทางเข้าเดียวของงานบัญชีทั้งระบบ บริการ accounting-tax-document-api พอร์ต 7900. ยอดเอกสารถูกยืนยันที่ชั้น calculation ก่อนเข้ามา API ปฏิเสธยอดที่ประกอบกันเองไม่ได้ด้วย AMOUNTS_INCONSISTENT และ kernel ไม่คำนวณ VAT ใหม่. ใบกำกับภาษีเป็นเอกสารที่ออกจาก issue_invoice เดิม ไม่ใช่ financial event (คำสั่งเจ้าของ 2026-09-05). STATUS: VERIFIED_ISOLATED. KNOWN_LIMITATIONS: ยังไม่ deploy production; consumer ฝั่ง deadboard ยังไม่ต่อเข้ามา.",
    evidence_refs: EVIDENCE,
    relationships: [
      { to_type: "DEPENDENCY", to_id: "accounting-kernel-canonical", relationship_kind: "CAPABILITY_TO_DEPENDENCY" },
    ],
  },
  {
    ...COMMON,
    candidate_id: "candidate-accounting-kernel-canonical-v1",
    name: "accounting-kernel-canonical",
    owner: "DNA-OS-FINANCIAL-DOCUMENTS/schemas",
    scope: "accounting/kernel",
    source_location: `${REPO}/schemas/acct-schema.sql + ${REPO}/schemas/acct-v2.sql + ${REPO}/schemas/acct-v2-fix.sql + ${REPO}/src/adapters/adapters.sql + ${REPO}/schemas/acct-v3-contract.sql`,
    input: ["financial_events + financial_event_evidence + payment_allocations ผ่าน adapters เท่านั้น"],
    output: [
      "journal entries และ journal lines", "AR และ AP รายเอกสาร", "VAT ขาออกและขาเข้า",
      "WHT รับและจ่าย", "trial balance", "profit and loss", "balance sheet", "tax submission package",
    ],
    side_effects: ["เขียนลงฐาน kernel ที่แยกไว้ ไม่เคยแตะฐานธุรกิจของ deadboard"],
    dependencies: ["postgresql 18"],
    behavior:
      "แกนบัญชีคู่แบบ event-sourced: event -> posting rule -> journal -> GL -> AR/AP -> VAT/WHT -> รายงาน -> ชุดยื่นภาษี. ledger ห้ามแก้ ต้องกลับรายการแทน. งวดที่ปิดแล้วโพสต์ไม่ได้. ชนิดเหตุการณ์มีหกชนิดที่มี handler จริงเท่านั้น บังคับด้วย FK ไปยัง event_type_registry จึงไม่มีชนิดที่ประกาศไว้แต่โพสต์ไม่ได้ และไม่มี handler ที่ constraint ปฏิเสธ. หลักฐานผูกได้สองแบบ: FK แข็งของเอกสารในแกน และ generic pointer ที่ชี้กลับระบบธุรกิจต้นทาง. STATUS: VERIFIED_ISOLATED.",
    evidence_refs: EVIDENCE,
    relationships: [],
  },
];
