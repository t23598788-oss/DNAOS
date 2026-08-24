/**
 * หน้าที่: the public boundary of `control/source-execution/` — the only
 * file another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Input: re-exports only.
 * Output: `executeSource`, plus every type a caller needs.
 * Dependency ที่อนุญาต: ./resolver.ts, ./types.ts.
 */

export { executeSource } from "./resolver";
export type { SourceExecutionContext } from "./resolver";
export type { ExecutionStatus, ExecutionReasonCode, GithubRepositoryReference, SourceExecutionInput, SourceExecutionResult } from "./types";
