/**
 * หน้าที่: the public boundary of `control/work-continuation/`, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Input: re-exports only.
 * Output: the reverse index, the deterministic evaluator, and durable storage.
 * Dependency ที่อนุญาต: ./evaluate.ts, ./store.ts, ./types.ts.
 */

export { buildIndex, affectedWorkIds, evaluate, digestOf, MAX_RESUME_ATTEMPTS } from "./evaluate";
export { appendWaiting, loadWaiting, currentWaiting, WAITING_PATH } from "./store";
export type { WaitingWork, DependencyEvent, DependencyIndex, DependencyKey, Evaluation, ResumeCondition, ResumeVerdict } from "./types";
