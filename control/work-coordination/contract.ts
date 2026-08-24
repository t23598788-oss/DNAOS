/**
 * หน้าที่: the public boundary of `control/work-coordination/` — the only file
 * another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9. This folder
 * previously had NO contract.ts, so existing callers
 * (`control/agent-gateway/controller.ts`, `control/owner-command/input-gateway.ts`,
 * `control/event-pipeline/canonical-event-pipeline.ts`) reach into
 * `./coordination.ts` directly. Those imports are left untouched on purpose —
 * rewriting three live callers is not this change's scope, and breaking them to
 * satisfy a lint would be worse than the violation. New callers must use THIS file.
 *
 * Input: re-exports only.
 * Output: the pre-existing work queue + atomic work claim, plus the WRITE SCOPE
 * layer that closes the overlapping-boundary hole.
 * Dependency ที่อนุญาต: ./coordination.ts, ./write-scope.ts, ./types.ts.
 */

// Pre-existing: durable work queue + real cross-process work claim. Unchanged.
export {
  claimWork,
  releaseWorkClaim,
  renewWorkClaim,
  createCoordinationStore,
} from "./coordination";
export type {
  WorkClaim,
  ClaimWorkInput,
  ClaimWorkResult,
  ReleaseClaimResult,
  WorkItem,
  WorkStatus,
  CoordinationEvent,
  CoordinationEventType,
  CoordinationStore,
} from "./coordination";

// New: path-containment-aware write boundary locking + the derived WRITE_LOCK_MAP.
export {
  claimWriteScope,
  releaseWriteScope,
  renewWriteScope,
  listWriteLocks,
  normalizeScopePath,
  scopesOverlap,
} from "./write-scope";
export type {
  WriteScopeClaim,
  ClaimWriteScopeInput,
  ClaimWriteScopeResult,
  ReleaseWriteScopeResult,
  HeldWriteLock,
} from "./types";
