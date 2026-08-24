/**
 * หน้าที่: the public boundary of `control/runtime-verification/` — the
 * only file another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Input: re-exports only.
 * Output: `verifyRuntime`, plus every type a caller needs.
 * Dependency ที่อนุญาต: ./resolver.ts, ./types.ts.
 */

export { verifyRuntime } from "./resolver";
export type { RuntimeVerificationStatus, RuntimeVerificationInput, RuntimeVerificationResult } from "./types";
