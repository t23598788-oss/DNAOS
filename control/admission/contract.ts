/**
 * หน้าที่: the public boundary of `control/admission/` — the only file
 * another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Input: re-exports only.
 * Output: `evaluateAdmission`, plus every type a caller needs.
 * Dependency ที่อนุญาต: ./resolver.ts, ./types.ts.
 */

export { evaluateAdmission } from "./resolver";
export type { AdmissionContext } from "./resolver";
export type { AdmissionDecision, AdmissionInput, AdmissionReasonCode, ExecutionReadyReference, AdmissionResult } from "./types";
