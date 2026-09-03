/**
 * หน้าที่: ขอบเขตสาธารณะของ `control/owner-error-lane/` ตาม CAPABILITY_FOLDER_LAW ข้อ 9
 *
 * Input: re-export เท่านั้น
 * Output: การรับความผิดพลาดเข้าคอนโซล การตัดสินการส่งอัตโนมัติ และฟีดสองเลน
 * Dependency ที่อนุญาต: ./lane.ts, ./console-feed.ts, ./types.ts
 * สิ่งที่ห้ามแตะ: ห้าม export เส้นทางที่ส่งงานให้ worker โดยข้าม decideAutoDispatch
 */

export { loadAdmittedConsoleItems, CONSOLE_ITEM_TASK_ID, admitSystemError, decideAutoDispatch, buildAiWorkPackage, errorEventIdOf } from "./lane";
export type { AdmitOptions, AiWorkPackageV1 } from "./lane";
export { listOwnerConsoleItems } from "./console-feed";
export { linkAdmittedErrorToRepairLoop, classifyNonDefect, gapFromConsoleItem, gapIdForError } from "./repair-link";
export type { LinkOutcome, NonDefectReason } from "./repair-link";
export { listUnifiedRepairItems } from "./unified-queue";
export { bindFailureEvidence, withProvenCause, resolveOwnershipForPath } from "./evidence-binding";
export type { PathOwnership } from "./evidence-binding";
export { collapseSymptoms } from "./causal-collapse";
export { normalizeSourceLocation, covers, KNOWN_REPOSITORIES } from "./source-identity";
export type { RepositoryIdentity, CanonicalSourceIdentity } from "./source-identity";
export type { RootIncident, CollapseResult } from "./causal-collapse";
export type { EvidenceBinding, BindingStatus, CausalGraph, MissingEvidenceKind } from "./evidence-binding";
export {
  runPreparationCycle, preparationState, setPreparationState, loadPreparedRepairs,
  derivedWorkIdFor, backoffMsFor, MAX_ITEMS_PER_CYCLE, MIN_IDLE_SWEEP_MS, BACKOFF_MAX_MS,
} from "./preparation";
export type { PreparedRepairRecord, PreparationCycleResult, PreparationState, PreparationOptions } from "./preparation";
export type { UnifiedRepairItem, UnifiedQueueInput } from "./unified-queue";
export type { ConsoleFeedItem } from "./console-feed";
export {
  AUTO_DISPATCH_ELIGIBLE, OWNER_ATTENTION_REQUIRED, MAX_REPAIR_DEPTH,
} from "./types";
export type {
  OriginKind, SystemErrorKind, SystemErrorEvidence, SystemErrorObservation,
  DevelopmentAuthorityMode, AutoDispatchDecision, AutoDispatchDecisionCode,
  OwnerConsoleItem, AdmitOutcome,
} from "./types";
