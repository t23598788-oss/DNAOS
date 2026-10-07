/**
 * หน้าที่: the public boundary of `control/work-graph/` — the only file another
 * capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Input: re-exports only.
 * Output: work-graph derivation + dispatch selection, and every type a caller needs.
 * Dependency ที่อนุญาต: ./derive.ts, ./types.ts.
 */
export { deriveWorkGraph, deriveState, selectDispatch, workIdFor, workerClassFor } from "./derive";
export type { ExternalBlocker } from "./derive";
export type { WorkItem, WorkState, WorkKind, WorkerClass, WorkGraph, Dispatch, WorkResult } from "./types";
