/**
 * หน้าที่: the public boundary of `control/post-commit-verification/` —
 * the only file another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Input: re-exports only.
 * Output: `runPostCommitVerification`, `resolveRequiredChecks`,
 * `runOneCheck`, `decideVerification`, `findVerificationForCommit`, plus every
 * type a caller needs.
 *
 * `runOneCheck` is exported for `../working-tree-verification/` (Owner,
 * 2026-08-26). That capability verifies uncommitted change, which this one
 * cannot — its whole contract is built on a real `commit_sha`. Exporting the
 * check RUNNER, rather than letting it own a second one, is what keeps
 * "which checks are required, how they are run, and what counts as passing"
 * a single answer for both entry points.
 * Dependency ที่อนุญาต: ./resolver.ts, ./requirement-resolution.ts, ./decision.ts, ./run-checks.ts, ./lookup.ts, ./types.ts.
 */

export { runPostCommitVerification } from "./resolver";
export { resolveRequiredChecks } from "./requirement-resolution";
export type { ResolvedCheckRequirement } from "./requirement-resolution";
export { runOneCheck } from "./run-checks";
export type { RunOneCheckDeps } from "./run-checks";
export { decideVerification } from "./decision";
/** Read-only: reports a verdict that already exists, and can never produce one. */
export { findVerificationForCommit } from "./lookup";
export type {
  CheckType,
  CheckStatus,
  CheckResult,
  VerificationStatus,
  VerificationReasonCode,
  PostCommitVerificationInput,
  PostCommitVerificationResult,
} from "./types";
