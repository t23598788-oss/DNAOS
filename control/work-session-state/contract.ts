/**
 * หน้าที่: the public boundary of `control/work-session-state/` — the only file
 * another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Input: re-exports only.
 * Output: the persistent work-state journal, the resume engine, and change
 * ownership resolution.
 * Dependency ที่อนุญาต: ./store.ts, ./resume.ts, ./ownership.ts, ./types.ts.
 */
export {
  appendCheckpoint,
  currentCheckpoint,
  allCurrentCheckpoints,
  checkpointHistory,
  currentRevision,
  currentBranch,
  journalPath,
  newCheckpointId,
  newSessionId,
} from "./store";
export { buildResumeContext, renderResumeBriefing, revalidateStep } from "./resume";
export { resolveChangeOwner, resolveChangeOwners } from "./ownership";
export type {
  WorkSessionCheckpoint,
  WorkStep,
  StepState,
  StepVerification,
  StepRevalidation,
  Blocker,
  DecisionRequired,
  ResumeContext,
  ChangeOwnership,
} from "./types";
