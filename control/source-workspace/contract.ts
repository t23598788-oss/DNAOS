/**
 * หน้าที่: the public boundary of `control/source-workspace/` — the only
 * file another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Input: re-exports only.
 * Output: `createWorkspace`, `removeWorkspace`, plus every type a caller needs.
 * Dependency ที่อนุญาต: ./resolver.ts, ./types.ts.
 */

export { createWorkspace, removeWorkspace, removeWorkspaceSafe } from "./resolver";
export type { WorkspaceReservation, CreateWorkspaceInput, CreateWorkspaceResult, CreateWorkspaceStatus, RemoveWorkspaceResult, RemoveWorkspaceStatus } from "./types";
export { listReservations, loadReservation } from "./resolver";
export {
  registerReservationWorkspace,
  registerPublicationCheckoutWorkspace,
  listLocalWorkspaces,
  latestWorkspaceForWork,
  workspacesForWork,
  isRegisteredManagedWorktree,
  classifyDisposablePath,
  pathDisclosureRef,
  transitionLocalWorkspace,
} from "./local-registry";
export type { LocalWorkspaceRecord, LocalWorkspaceState, WorkspacePurpose, CleanupPolicy, PersistencePolicy } from "./local-registry";
export { evaluateDisposableCleanup, cleanupWorkspacesForWork, resumeCleanupPending, listWorkspaceCleanupEvidence } from "./cleanup";
export type { CleanupFacts, CleanupOutcome, CleanupStatus } from "./cleanup";
export { recreateWorkspaceFromRegisteredSource } from "./recovery";
export { PERSISTENT_LOCAL_FOOTPRINT, DISPOSABLE_LOCAL_FOOTPRINT, NEVER_DELETE } from "./persistent-footprint";
