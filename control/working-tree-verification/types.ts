/**
 * หน้าที่: type contracts for WORKING TREE VERIFICATION — the deterministic
 * entry point for verifying a change that has NOT been committed.
 *
 * WHY THIS EXISTS (Owner decision, 2026-08-26). `../post-commit-verification/`
 * answers "does this already-committed commit pass the checks this repo
 * declares?" and its input is built around `commit_sha` on purpose. A
 * working-tree edit has no commit, and the two available answers were both
 * wrong: fabricate a commit_sha to satisfy the shape (a lie in the evidence
 * record), or refuse to verify uncommitted change at all (and leave a daemon
 * running code that was replaced on disk 15 minutes ago — the failure that
 * started this whole line of work).
 *
 * So there is a second ENTRY POINT and deliberately NOT a second check engine:
 * the required checks are resolved by `../post-commit-verification/`'s own
 * `resolveRequiredChecks`, executed by its own `runOneCheck`, and judged by its
 * own `decideVerification`. What differs is the identity of the thing verified
 * and the AUTHORITY of the answer.
 *
 * THE AUTHORITY DIFFERENCE IS THE POINT. This never returns `VERIFIED`. Its
 * success value is `WORKING_TREE_VERIFIED`, which carries
 * `authority: "OWNER_TRIGGERED_ONLY"` — enough for an owner to act on now, never
 * enough for an unattended automatic action. A tree that no commit records can
 * change under you between the check and the act; a commit cannot.
 *
 * Input: none (pure type definitions).
 * Output: `WorkingTreeRevision`, `WorkingTreeVerificationInput/Result`.
 * Dependency ที่อนุญาต: ../post-commit-verification/contract.ts (types only).
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเพิ่มค่า "VERIFIED" ให้ `WorkingTreeVerificationStatus`.
 * - ห้ามเพิ่ม field `commit_sha` ที่ caller กรอกเองได้.
 */
import type { CheckResult, CheckType } from "../post-commit-verification/contract";

/**
 * Identity of an uncommitted state. Deterministic in the way a commit sha is:
 * the same tree always digests to the same value, and any edit changes it —
 * so "was THIS state verified" is answerable without a commit existing.
 */
export interface WorkingTreeRevision {
  /** The commit the tree is based on. Real, and never used as the identity of the change itself. */
  head_sha: string;
  /** sha256 over the porcelain status plus the content hash of every dirty file, sorted. */
  working_tree_digest: string;
  /** Paths git reports as changed, with their status codes. */
  dirty_paths: readonly { path: string; status: string; content_sha256: string | null }[];
  /** True when git reports nothing changed — then the tree IS head_sha and post-commit verification is the right authority. */
  clean: boolean;
}

export type WorkingTreeVerificationStatus = "WORKING_TREE_VERIFIED" | "FAILED" | "UNRESOLVED";

export type WorkingTreeReasonCode =
  | "WORKING_TREE_VERIFIED"
  | "CHECK_FAILED"
  | "VERIFICATION_REQUIREMENT_NOT_FOUND"
  | "CHECK_EXECUTION_UNRESOLVED"
  | "TREE_IS_CLEAN"
  | "GIT_UNAVAILABLE";

export interface WorkingTreeVerificationInput {
  repo_root: string;
  /** What the caller believes changed. Recorded and cross-checked against git, never trusted as the source of truth. */
  claimed_changed_paths: readonly string[];
  correlation_id: string;
}

export interface WorkingTreeVerificationResult {
  verification_id: string;
  status: WorkingTreeVerificationStatus;
  reason_code: WorkingTreeReasonCode;
  revision: WorkingTreeRevision | null;
  required_checks: readonly CheckType[];
  checks: readonly CheckResult[];
  /**
   * ALWAYS "OWNER_TRIGGERED_ONLY". A constant, not a computed field, so that no
   * future branch can quietly widen it — widening it means editing this line
   * and reading this comment.
   */
  authority: "OWNER_TRIGGERED_ONLY";
  /** Paths the caller claimed changed that git does not report as dirty. Named, never silently dropped. */
  unverified_claims: readonly string[];
  created_at: string;
}
