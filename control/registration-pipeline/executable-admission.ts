/**
 * หน้าที่: ADMISSION CHECK — `EXECUTABLE_CONTRACT_REQUIRED`
 *
 * candidate ที่ **ประกาศเจตนาว่าจะเป็น executable** ต้องประกาศ contract
 * ให้ครบตั้งแต่ก่อนลงทะเบียน มิฉะนั้นถูกปฏิเสธ
 *
 * WHY. capability 8 ตัวที่ลงทะเบียนไว้ก่อนหน้านี้ไม่ได้ประกาศ `input`/`output`
 * และเพราะ contract เป็นส่วนหนึ่งของ `semantic_fingerprint`
 * (ดู `../event-pipeline/registration-contract.ts#fingerprintCandidate`)
 * การเติมทีหลังจะทำให้ fingerprint ไม่ตรงกับแถวของตัวเอง และ duplicate gate
 * จะหา semantic match ไม่เจอ — เกิด capability ซ้ำ
 * (หลักฐานเต็ม: governance/architecture-rules/SEMANTIC_CANDIDATE_AND_CONTRACT_DISCOVERY.md)
 *
 * gate นี้จึงต้องอยู่ **ก่อน** `fingerprintCandidate()` เสมอ — ค่า input/output
 * ที่ประกาศจะได้เข้าไปอยู่ใน fingerprint ตามกฎเดิมโดยอัตโนมัติ
 * **ไม่ต้องแก้กฎ identity และไม่ต้อง retrofit ของเก่า**
 *
 * ขอบเขตโดยเจตนา:
 *   - ใช้กับ candidate ใหม่ที่ประกาศเจตนา executable เท่านั้น
 *   - candidate เชิงโครงสร้าง/เอกสาร ที่ไม่ประกาศเจตนา ไม่ถูกแตะ
 *   - ไม่ย้อนไปตรวจ record เดิมในทะเบียน
 *
 * Input: `RegistrationCandidate`.
 * Output: `checkExecutableAdmission`, `ExecutableAdmissionResult`.
 * Dependency ที่อนุญาต: ../event-pipeline/contract.ts (type only).
 * สิ่งที่ห้ามแตะ: ห้ามให้ gate นี้อ่านหรือเขียนทะเบียน — มันตรวจเฉพาะสิ่งที่
 * candidate ประกาศมาเท่านั้น การอ่านทะเบียนเป็นหน้าที่ของ stage อื่น
 */

import type { RegistrationCandidate } from "../event-pipeline/contract";

export type ExecutableAdmissionReason =
  | "MISSING_INPUT_CONTRACT"
  | "MISSING_OUTPUT_CONTRACT"
  | "MISSING_EXECUTION_BINDING"
  | "MISSING_CONTRACT_PROVENANCE";

export interface ExecutableAdmissionResult {
  readonly applicable: boolean;
  readonly ok: boolean;
  readonly reasons: readonly ExecutableAdmissionReason[];
}

const EXECUTION_BINDING_KINDS = new Set(["CAPABILITY_TO_API", "CAPABILITY_TO_WORKER"]);

interface CandidateRelationshipLike { readonly relationship_kind?: string }

/**
 * เจตนา executable อ่านได้จากสองทาง — ทั้งคู่เป็นสิ่งที่ candidate ประกาศเอง
 * ไม่ใช่การอนุมานจากชื่อหรือ path
 */
export function declaresExecutableIntent(candidate: RegistrationCandidate): boolean {
  const explicit = (candidate as { intended_executable?: boolean }).intended_executable === true;
  const rels = ((candidate as { relationships?: readonly CandidateRelationshipLike[] }).relationships ?? []);
  const declaresBinding = rels.some((r) => EXECUTION_BINDING_KINDS.has(String(r.relationship_kind)));
  return explicit || declaresBinding;
}

export function checkExecutableAdmission(candidate: RegistrationCandidate): ExecutableAdmissionResult {
  if (!declaresExecutableIntent(candidate)) return { applicable: false, ok: true, reasons: [] };

  const reasons: ExecutableAdmissionReason[] = [];
  if ((candidate.input ?? []).length === 0) reasons.push("MISSING_INPUT_CONTRACT");
  if ((candidate.output ?? []).length === 0) reasons.push("MISSING_OUTPUT_CONTRACT");

  const rels = ((candidate as { relationships?: readonly CandidateRelationshipLike[] }).relationships ?? []);
  if (!rels.some((r) => EXECUTION_BINDING_KINDS.has(String(r.relationship_kind)))) {
    reasons.push("MISSING_EXECUTION_BINDING");
  }
  // provenance ที่ตรวจซ้ำได้ = evidence_refs ที่ไม่ว่าง อย่างน้อยหนึ่งรายการ
  // ต้องชี้ไปที่ source/test/validator ไม่ใช่คำบรรยายลอย ๆ
  const refs = candidate.evidence_refs ?? [];
  const hasSourceRef = refs.some((r) => /\.(ts|mts|mjs|js|py)(:|#|$)|\/tests?\//.test(String(r)));
  if (!hasSourceRef) reasons.push("MISSING_CONTRACT_PROVENANCE");

  return { applicable: true, ok: reasons.length === 0, reasons };
}
