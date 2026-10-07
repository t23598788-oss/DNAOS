/**
 * หน้าที่: the public boundary of `permissions/write-gate/`.
 *
 * Input: re-exports only.
 * Output: `evaluateWriteIntent`, plus every type a caller needs.
 * Dependency ที่อนุญาต: ./policy.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never re-export ./rules.ts or ./evidence.ts here — private implementation.
 */

export { evaluateWriteIntent } from "./policy";
export type { WriteGateCanonicalReference, WriteGateContext, WriteGateDecision, WriteGateDecisionValue, WriteGateEvidence, WriteIntent, WriteOperation, WriteTargetType } from "./types";
