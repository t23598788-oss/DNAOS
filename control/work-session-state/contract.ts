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
export {
  openEntry,
  advanceEntry,
  failEntry,
  readEntries,
  currentEntries,
  recoverableEntries,
  entryJournalPath,
  JOURNAL_STAGES,
} from "./journal";
export type { JournalEntry, JournalStage, RecoverableEntry, AdvanceResult } from "./journal";
export {
  nextBackoffMs,
  recordConnectionState,
  recordConnected,
  recordDisconnect,
  readConnectionState,
  reconcile,
  queueNetworkOperation,
  readQueue,
  drainQueue,
  streamPositions,
  connectionStatePath,
  networkQueuePath,
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  BACKOFF_MAX_ATTEMPTS,
} from "./connection";
export type { ConnectionState, ConnectionStatus, ReconcileResult, QueuedOperation, DrainResult } from "./connection";
export {
  STATE_AUTHORITY,
  authorityOf,
  authorityReport,
  resolveResolution,
  resolveAllowedWriteScope,
  resolutionRefOf,
} from "./authority";
export type { StateAuthority, FactKind, CanonicalResolution, ScopeAnswer } from "./authority";
export { buildRehydrationPlan, allRehydrationPlans, recoverRuntime, renderRehydrationBriefing, RECOVERY_MAX_ATTEMPTS } from "./rehydrate";
export type { RehydrationPlan, RuntimeRecovery } from "./rehydrate";
export { currentStateProjection } from "./current-state";
export type { CurrentStateProjection } from "./current-state";
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
  UiContext,
  StreamPosition,
  SyncState,
  ResolutionRef,
  CrossRepoEvidence,
} from "./types";
