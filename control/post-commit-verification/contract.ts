/**
 * หน้าที่: the public boundary of `control/post-commit-verification/` —
 * the only file another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Input: re-exports only.
 * Output: `runPostCommitVerification`, `resolveRequiredChecks`,
 * `decideVerification`, plus every type a caller needs.
 * Dependency ที่อนุญาต: ./resolver.ts, ./requirement-resolution.ts, ./decision.ts, ./types.ts.
 */

export { runPostCommitVerification } from "./resolver";
export { resolveRequiredChecks } from "./requirement-resolution";
export type { ResolvedCheckRequirement } from "./requirement-resolution";
export { decideVerification } from "./decision";
export type {
  CheckType,
  CheckStatus,
  CheckResult,
  VerificationStatus,
  VerificationReasonCode,
  PostCommitVerificationInput,
  PostCommitVerificationResult,
} from "./types";
