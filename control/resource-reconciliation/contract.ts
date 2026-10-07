/**
 * หน้าที่: the public boundary of `control/resource-reconciliation/` — the only
 * file another capability folder may import from, per
 * `../../governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * NOTE WHAT IS ABSENT AND MUST STAY ABSENT: nothing exported here deletes,
 * moves, truncates, resets or restarts anything. This capability answers
 * questions and produces verdicts and plans. Execution belongs to the storage
 * lifecycle's trash adapter (~/Desktop/dna-os-deadboard) and to
 * `../service-reload/` -> `../runtime-control/`, and to nothing else.
 *
 * Input: re-exports only.
 * Output: lineage, supersession detection, reconciliation, the database gate,
 * reset planning and post-mutation verification.
 * Dependency ที่อนุญาต: ./lineage.ts, ./supersession.ts, ./reconcile.ts,
 * ./decide.ts, ./database-safety.ts, ./reset.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: ห้าม export ฟังก์ชันที่ลบ/ย้าย/รีสตาร์ทอะไรก็ตาม.
 */

export { buildLineage, censusIndex, REPO_ROOT } from "./lineage";
export {
  detectSupersessions,
  detectRenameSupersessions,
  detectIdenticalContentSupersessions,
  detectRegistryDuplicateSupersessions,
  supersessionFor,
} from "./supersession";
export type { Supersession } from "./supersession";
export { reconcileSystem, impactOfChange, measureLightness, machineWorkspaceState } from "./reconcile";
export type { ReconciliationReport, MachineWorkspaceState } from "./reconcile";
export { decideVerdict, sourceOfTruthReason, SOURCE_OF_TRUTH_MARKERS } from "./decide";
export type { DecideInput } from "./decide";
export { assessDatabaseObject } from "./database-safety";
export { planReset, verifyAfterMutation, allocatedBytes } from "./reset";
export type { PostMutationVerification } from "./reset";
export type {
  Provenance,
  ResourceState,
  ResourceLineage,
  FindingKind,
  ReconciliationFinding,
  ReconciliationVerdict,
  AutoTrashConditions,
  VerdictDecision,
  ResetScope,
  ResetPlan,
  DatabaseSafetyDecision,
  LightnessMetrics,
  ImpactClass,
  ChangeImpactEntry,
} from "./types";
