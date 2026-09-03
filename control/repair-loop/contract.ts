/**
 * หน้าที่: the public boundary of `control/repair-loop/` — the only file
 * another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Input: re-exports only.
 * Output: the gap scan, the root-cause analyzer, the repair-item builder,
 * the deterministic verifier, and `runRepairCycle`.
 * Dependency ที่อนุญาต: ./gap-scanner.ts, ./root-cause.ts, ./repair-item.ts,
 * ./verifier.ts, ./loop.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never export a way to promote a change that skips
 * `verifyProposal` — `verifyProposal` is the only path that reaches the write
 * gate, and a second one would make the gate optional.
 */

export {
  annotationIdOf, appendAnnotation, listAnnotations, isEvidenceFieldAdmissible, admissibilityStoreFile,
} from "./evidence-admissibility";
export type {
  EvidenceAdmissibilityAnnotationV1, EvidenceSubject, EvidenceStoreId, EvidenceRecordType,
  Admissibility, AdmissibilityVerdict, AdmissibilityQuery, AnnotateInput,
  InterpretationScope, DefectClassification, AppendOutcome,
} from "./evidence-admissibility";

export { scanGaps } from "./gap-scanner";
export type { GapScanSummary } from "./gap-scanner";
export { analyzeRootCause } from "./root-cause";
export type { RootCauseFinding } from "./root-cause";
export { buildRepairWorkItem, errorSignature } from "./repair-item";
export { verifyProposal, hashProposal } from "./verifier";
export { runRepairCycle, loopCheck, preDispatchStop, MAX_ATTEMPTS_PER_GAP } from "./loop";
export type { RepairCycleOptions } from "./loop";
export type {
  GapState, GapRecord, RootCauseClass, RepairType, RepairWorkItem, AgentProposal,
  VerificationStage, StageResult, VerificationVerdict, StopCondition,
  RepairAttemptRecord, RepairCycleOutcome,
} from "./types";
