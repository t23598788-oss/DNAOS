/**
 * หน้าที่: บันทึกว่า capability ที่สร้างรอบก่อนถูกแทนที่โดย canonical runtime แล้ว
 * Owner, 2026-09-05 — Phase 3: "ห้ามลบทันที ให้ preserve lineage/evidence ก่อน"
 *
 * ทะเบียนไม่มี mutation_type SUPERSEDE (มีแค่ ADD_EVIDENCE / ADD_VERSION /
 * ADD_RELATIONSHIP / REMOVE_RELATIONSHIP / RETIRE) จึงใช้ ADD_EVIDENCE บันทึก
 * การจัดชั้นและสายเลือดไว้บน record เดิม ไม่ RETIRE และไม่ลบ
 *
 * Input: ไม่มี  Output: ผลการ mutate ที่อ่านกลับได้จากทะเบียน
 * สิ่งที่ห้ามแตะ: ห้ามลบ record ห้ามเปลี่ยน identity
 */

import { readFileSync } from "node:fs";
import { createPersistentFileStore } from "../registry-database/adapters/persistent-file-store";
import { findCapability } from "../registry-database/contract";
import { applyMutation } from "../../control/registration-update/mutation";

const ARTIFACT = "../DNA-OS-บัญชีการเงิน/evidence/EVIDENCE-consolidated-20260905T110755Z.json";
const LINKS = "software/registry-database/data/canonical/resource_capabilities.jsonl";

const SUPERSEDED: readonly { name: string; parts: string; by: string }[] = [
  { name: "accounting-capability-boundary",
    parts: "control/accounting-capability/kernel-gateway.ts + capability.ts adapters + types.ts + tests A-J",
    by: "accounting-tax-document-api" },
  { name: "accounting-document-calculation",
    parts: "control/accounting-capability/calculation.ts",
    by: "accounting-tax-document-api (พอร์ตแล้วเป็น src/calculation/calculation.mjs)" },
];

function linkOf(capabilityId: string): string {
  for (const line of readFileSync(LINKS, "utf8").split("\n")) {
    const t = line.trim(); if (!t) continue;
    try {
      const l = JSON.parse(t) as { resource_id: string; capability_id: string };
      if (l.capability_id === capabilityId) return l.resource_id;
    } catch { /* ข้ามบรรทัดเสีย */ }
  }
  return "";
}

function main(): number {
  const store = createPersistentFileStore();
  let ok = 0;
  for (const s of SUPERSEDED) {
    const cap = findCapability({ canonical_name: s.name }, store) as unknown as
      { capability_id: string; version: readonly string[] } | null;
    if (cap === null) { console.log(`  ไม่พบ ${s.name}`); continue; }
    const res = applyMutation({
      resource_id: linkOf(cap.capability_id),
      capability_id: cap.capability_id,
      expected_current_version: cap.version[0],
      mutation_type: "ADD_EVIDENCE",
      // payload รับ evidence_ref เดี่ยว (control/registration-update/mutation.ts:83)
      // ส่วนที่เหลือส่งผ่าน evidence_refs ของคำขอ ซึ่งถูกบันทึกเช่นกัน (บรรทัด 98-100)
      mutation_payload: { evidence_ref: "lifecycle_classification:SUPERSEDED_BY_CANONICAL_RUNTIME" },
      evidence_refs: [
        `superseded_by:${s.by}`,
        `superseded_parts:${s.parts}`,
        "canonical_runtime:repository://t23598788-oss/DNA-OS-FINANCIAL-DOCUMENTS-LOCAL-RECOVERY-2026-09-03",
        `verification:${ARTIFACT}`,
        "owner_decision:2026-09-05 NEW_ACCOUNTING_CAPABILITY = DO_NOT_KEEP_AS_SEPARATE_CANONICAL",
        "source_preserved_at:DNA-OS-INFRASTRUCTURE/control/accounting-capability (ไม่ลบ)",
      ],
      correlation_id: "accounting-consolidation-2026-09-05",
    }, store);
    console.log(`  ${s.name}: ${res.status}${res.status === "APPLIED" ? "" : " " + JSON.stringify(res)}`);
    if (res.status === "APPLIED") ok++;
  }
  return ok === SUPERSEDED.length ? 0 : 1;
}

process.exit(main());
