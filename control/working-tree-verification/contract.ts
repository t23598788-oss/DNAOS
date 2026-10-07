/**
 * หน้าที่: the public boundary of `control/working-tree-verification/` — the
 * only file another capability folder may import from, per
 * `../../governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Input: re-exports only.
 * Output: `runWorkingTreeVerification`, `resolveWorkingTreeRevision`, types.
 * Dependency ที่อนุญาต: ./resolver.ts, ./types.ts.
 */

export { runWorkingTreeVerification, resolveWorkingTreeRevision } from "./resolver";
export type { WorkingTreeVerificationDeps } from "./resolver";
export type {
  WorkingTreeRevision,
  WorkingTreeVerificationInput,
  WorkingTreeVerificationResult,
  WorkingTreeVerificationStatus,
  WorkingTreeReasonCode,
} from "./types";
