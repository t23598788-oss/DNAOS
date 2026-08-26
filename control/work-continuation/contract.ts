/**
 * หน้าที่: the public boundary of `control/work-continuation/`, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Input: re-exports only.
 * Output: the canonical key constructor, the reverse index, the deterministic
 * evaluator, the real-evidence adapter, the resume join, and durable storage.
 * Dependency ที่อนุญาต: ./key.ts, ./evaluate.ts, ./adapter.ts, ./resume.ts,
 * ./store.ts, ./types.ts.
 */

export { dependencyKey, capabilityKeyOf, KEY_NAMESPACES } from "./key";
export { buildIndex, affectedWorkIds, evaluate, digestOf, MAX_RESUME_ATTEMPTS } from "./evaluate";
export { deriveEvents, deriveEventsWithFailures, eventsFromCapability } from "./adapter";
export type { ProducerFailure } from "./adapter";
export { decideResumes, satisfiedKeysFrom } from "./resume";
export type { ResumeDecision } from "./resume";
export { appendWaiting, loadWaiting, currentWaiting, WAITING_PATH } from "./store";
export type { WaitingWork, DependencyEvent, DependencyIndex, DependencyKey, Evaluation, ResumeCondition, ResumeVerdict } from "./types";
