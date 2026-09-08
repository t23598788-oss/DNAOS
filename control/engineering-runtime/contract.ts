/**
 * หน้าที่: the public boundary of `control/engineering-runtime/` — the
 * ENGINEERING coding gate and internal completion lifecycle. Business
 * Runtime must not import this to perform READ / OPERATE / DOCUMENTATION
 * work.
 *
 * Input: re-exports only.
 * Output: admitEngineeringCoding, runEngineeringCoding, completeEngineeringWork,
 * publishEngineeringSource.
 * Dependency ที่อนุญาต: ./gate.ts, ./runtime.ts, ./complete.ts, ./publish.ts, ./types.ts, ./invariants.ts.
 * สิ่งที่ห้ามแตะ: never re-export continueRegisteredArtifact, GitHub Contents
 * write, worker commit/push helpers, or deploy. GitHub publication is only
 * publishEngineeringSource → DNA OS GitHub Publish Authority.
 */

export { admitEngineeringCoding, readEngineeringCodingIntent, isBusinessCapabilityId } from "./gate";
export { runEngineeringCoding, evaluateScopedWrite } from "./runtime";
export { completeEngineeringWork, finalizeEngineeringWork } from "./complete";
export { runAutonomousEngineeringLoop } from "./autonomous-loop";
export type { EngineeringLoopResult, EngineeringLoopDeps } from "./autonomous-loop";
export { inspectEngineeringRecovery, recoverEngineeringLoop } from "./recovery";
export { reconstructControlRuntime, reconstructionDigest, untrackedLifecycleWasNotCopied, MCP_SELF_REPORTING_TOOL_NAMES } from "./control-runtime-recovery";
export type { ControlRuntimeReconstruction, RecoveredWorkReference } from "./control-runtime-recovery";
export { RECOVERABLE_CANONICAL_STATE, REBINDABLE_STATE, MACHINE_LOCAL_NOT_TRANSFERRED } from "./control-runtime-recovery";
export { selectEngineeringWorker, listEngineeringWorkers, localScopedWorker, scriptedWorker } from "./engineering-worker-registry";
export { mayProceedToPublish, mayProceedToRegistry } from "./proceed-gate";
export { listLifecycle, latestLifecycleForWork, persistScopeLock, fingerprintEngineeringAction, transitionLifecycle, persistLifecycle } from "./lifecycle";
export { ownerFacingEngineeringResult, verifyGithubPublicationPermanence, permanenceReadDeps, parseEngineeringCommitMessage } from "./github-permanence";
export type { GithubPermanenceProof, GithubPermanenceStatus, OwnerEngineeringFace } from "./github-permanence";
export { listVerifiedCapabilities, listGithubPublicationProofs, latestGithubPublicationProof, persistGithubPublicationProof, listWorkspaceCleanupRecords, latestPublicationPointer } from "./persist";
export { publishEngineeringSource } from "./publish";
export { admitEngineeringResult } from "./completion-gate";
export { resolveGithubDestination } from "./github-destination";
export { createDnaOsCommit } from "./commit-authority";
export { denyWorkerGithubWrite, publishDnaOsCommit, githubGitHttpAuthorizationHeader } from "./github-publish-authority";
export { createPublicationProofCheckout, removePublicationProofCheckout, resolveIsolatedEngineeringCheckout, authoritativeWorkingTreeDirty } from "./publication-checkout";
export { cleanupAfterEngineeringVerified } from "./workspace-lifecycle";
export { recreateWorkspaceFromRegisteredSource } from "../source-workspace/contract";
export type { IsolatedEngineeringCheckout, PublicationProofCheckout } from "./publication-checkout";
export { corroborateAuthenticatedGithubRemote } from "./remote-corroboration";
export { SOURCE_PUBLICATION_INVARIANTS, EXTERNAL_AI_MAY, EXTERNAL_AI_MAY_NOT } from "./invariants";
export type {
  EngineeringAdmission,
  EngineeringCodingIntent,
  EngineeringCompletionResult,
  EngineeringGateReason,
  EngineeringLineage,
  EngineeringPublicationResult,
  EngineeringResultManifest,
  EngineeringRunResult,
  ProposedScopedWrite,
  RuntimeAuthority,
} from "./types";
export { ENGINEERING_AUTHORITY, BUSINESS_AUTHORITY, WORKER_DENIED_OPERATIONS } from "./types";
