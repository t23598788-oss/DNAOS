/**
 * หน้าที่: the public boundary of `control/external-system-lifecycle/` —
 * the only file another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 * `./pipeline.ts`, `./boundary.ts`, `./store.ts`, `./host-runtime.ts`
 * stay reachable only through here.
 *
 * Input: re-exports only.
 * Output: `runExternalSystemLifecycle`, `createLifecycleEventStore`,
 * plus every type a caller needs.
 * Dependency ที่อนุญาต: ./pipeline.ts, ./store.ts, ./types.ts.
 */

export { runExternalSystemLifecycle } from "./pipeline";
export { createLifecycleEventStore } from "./store";
export type { LifecycleEventStore } from "./store";
export type {
  LifecycleStage,
  LifecycleStageStatus,
  LifecycleEvent,
  LifecycleRun,
  LifecycleRelationshipRequest,
  ExternalSystemLifecycleInput,
  ExternalSystemLifecycleResult,
} from "./types";
export { EXTERNAL_OPERATIONAL_STAGES, CANONICAL_LIFECYCLE_MAPPING } from "./types";
