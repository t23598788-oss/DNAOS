/**
 * หน้าที่: ให้ ACCOUNTING_CAPABILITY (ขอบสาธารณะเดียวของงานบัญชี) มีตัวตนในทะเบียน
 * canonical — Owner, 2026-09-05, TASK: CONSOLIDATE_ACCOUNTING_INTO_SINGLE_REGISTERED_CAPABILITY
 *
 * ไม่ใช่ core ใหม่ และไม่แทนที่ accounting-accounting-kernel ที่ลงทะเบียนไว้แล้ว
 * เป็น "ขอบ" ที่ห่อ kernel เดิมไว้ ระบบอื่นค้นเจอตัวนี้ตัวเดียว แล้วไม่ต้องรู้ข้างใน
 *
 * ทุกตัวมีหลักฐานรันจริงจากฐานข้อมูล ไม่ใช่คำยืนยันของ agent:
 *   EVIDENCE-capability-acceptance.txt — capability 17/17 + kernel regression 23/23
 *
 * Input: none (ค่าคงที่)  Output: ACCOUNTING_CAPABILITY_CANDIDATES
 * สิ่งที่ห้ามแตะ: ห้ามอ้าง evidence ที่ยังไม่ได้วัด ห้ามเปลี่ยน verdict เป็น LIVE
 */

import type { RegistrationCandidate } from "../../../control/event-pipeline/registration-contract";

const SRC = "control/accounting-capability";
const PROOF = "tests/__sandbox__/accounting-kernel";

const COMMON = {
  kind: "capability" as const,
  version: "1.0.0",
  domain: "SOFTWARE_CONTROL_PLANE" as const,
  resource_type: "CAPABILITY" as const,
  data_classification: "INTERNAL",
  source_system: "dna-os-infrastructure",
  origin: {
    origin_kind: "PROVEN_ISOLATED_BOUNDARY",
    origin_reference: "TASK:CONSOLIDATE_ACCOUNTING_INTO_SINGLE_REGISTERED_CAPABILITY",
    introduced_by: "software/capability-registrar/register-accounting-capability-boundary.ts",
  },
};

const EVIDENCE = [
  `${PROOF}/EVIDENCE-capability-acceptance.txt (capability 17/17 ALL PASS + kernel regression 23/23 ALL PASS)`,
  `${PROOF}/run-capability-acceptance.sh (สร้างฐานใหม่ทุกครั้ง รันซ้ำได้ผลเดิม)`,
  "isolated pg18.4 127.0.0.1:55432 (NOT Supabase LIVE)",
  "lifecycle_verdict:VERIFIED_ISOLATED, not_on_live:true",
];

export const ACCOUNTING_CAPABILITY_CANDIDATES: readonly RegistrationCandidate[] = [
  {
    ...COMMON,
    candidate_id: "candidate-accounting-boundary-v1",
    name: "accounting-capability-boundary",
    owner: "DNA-OS-INFRASTRUCTURE/control/accounting-capability",
    scope: "accounting/capability-boundary",
    source_location: `${SRC}/contract.ts (ขอบสาธารณะ) · ${SRC}/capability.ts (entrypoint + adapters) · ${SRC}/types.ts (สัญญา)`,
    input: [
      "BUSINESS_EVENT", "SALES_DOCUMENT", "PURCHASE_DOCUMENT", "PAYMENT",
      "BANK_TRANSACTION", "CREDIT_NOTE", "ADJUSTMENT", "ACCOUNTING_QUERY",
      "ทุก input มี source_type, source_id, occurred_at, company_id, evidence[], idempotency_key, payload",
    ],
    output: [
      "POSTING_RESULT", "JOURNAL_ENTRY", "AR_STATUS", "AP_STATUS",
      "PAYMENT_ALLOCATION", "OUTSTANDING", "VAT_RESULT", "WHT_RESULT",
      "TRIAL_BALANCE", "PNL", "BALANCE_SHEET", "TAX_PACKAGE",
      "ACCOUNTING_EVIDENCE", "ERROR_RESULT",
    ],
    side_effects: [
      "เขียนเฉพาะฐาน kernel ที่แยกไว้ ไม่เคยแตะ Supabase LIVE",
      "ทุกการเขียนสร้าง WriteIntent และต้องผ่านผู้อนุญาตภายนอกก่อน ปฏิเสธเป็นค่าตั้งต้น",
    ],
    dependencies: [
      "accounting-accounting-kernel (candidate-accounting-accounting-kernel-v1) — core ที่ห่อไว้",
      "contracts/write-intent/write-intent.ts — สัญญา write boundary ของ DNA OS",
      "pg (ผู้เชื่อมต่อฐานข้อมูล)",
    ],
    behavior:
      "ขอบสาธารณะเดียวของงานบัญชี: validate -> write intent -> idempotency -> adapter -> kernel -> ตรวจสมดุล -> evidence -> ผลลัพธ์มาตรฐาน. BOUNDARY: ไม่มีชื่อตาราง SQL หรือรหัสผังบัญชีของ kernel ปรากฏในสัญญาสาธารณะ. adapter บาง ไม่คำนวณ debit/credit, VAT หรือ outstanding เอง. ชนิดที่ไม่มี handler ถูกปฏิเสธก่อนแตะ kernel (fail closed). STATUS: VERIFIED_ISOLATED. KNOWN_LIMITATIONS: ยังไม่อยู่บน LIVE; สูตร VAT ใน deadboard ยังเหลือสามจุดที่คำนวณเอง.",
    evidence_refs: EVIDENCE,
    relationships: [
      { to_type: "DEPENDENCY", to_id: "accounting-accounting-kernel", relationship_kind: "CAPABILITY_TO_DEPENDENCY" },
    ],
  },
  {
    ...COMMON,
    candidate_id: "candidate-accounting-document-calculation-v1",
    name: "accounting-document-calculation",
    owner: "DNA-OS-INFRASTRUCTURE/control/accounting-capability",
    scope: "accounting/document-calculation",
    source_location: `${SRC}/calculation.ts`,
    input: ["subtotal, discount, vat_rate, vat_mode (inclusive/exclusive), withholding_rate"],
    output: ["subtotal, discount, tax_base, vat_rate, vat_amount, total_amount, withholding_rate, withholding_amount"],
    side_effects: ["ไม่มี — ฟังก์ชันบริสุทธิ์ ไม่รู้จักฐานข้อมูล"],
    dependencies: ["ไม่มี"],
    behavior:
      "ชั้นคำนวณเอกสารจุดเดียวก่อนเข้าบัญชี สูตรยกมาจาก engines/tax.ts (deadboard) และเพิ่ม discount ที่ของเดิมไม่มี. BOUNDARY: kernel ไม่คำนวณ VAT เอง รับค่าที่ชั้นนี้ยืนยันแล้ว และ capability ปฏิเสธยอดที่ประกอบกันเองไม่ได้ (AMOUNTS_INCONSISTENT). ห้ามฝังอัตราภาษีเป็นเลขในไฟล์นี้. KNOWN_LIMITATIONS: ยังไม่ได้แทนที่สูตรซ้ำสามจุดในโค้ด production ของ deadboard.",
    evidence_refs: [
      `${PROOF}/EVIDENCE-capability-acceptance.txt — สี่ข้อแรกพิสูจน์ว่าให้ผลตรงกับ engines/tax.ts เมื่อ discount = 0`,
      ...EVIDENCE.slice(2),
    ],
    relationships: [
      { to_type: "DEPENDENCY", to_id: "accounting-capability-boundary", relationship_kind: "CAPABILITY_TO_DEPENDENCY" },
    ],
  },
];
