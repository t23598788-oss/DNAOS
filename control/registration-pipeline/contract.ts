/**
 * หน้าที่: the public boundary of `control/registration-pipeline/` — the
 * only file another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Input: re-exports only.
 * Output: `runRegistrationPipeline`, plus every type a caller needs.
 * Dependency ที่อนุญาต: ./pipeline.ts, ./types.ts.
 */

export { runRegistrationPipeline } from "./pipeline";
export type {
  PipelineStage,
  DuplicateResolutionStatus,
  DuplicateOf,
  DuplicateResolutionResult,
  PipelineApprovedResult,
  PipelineDuplicateResult,
  PipelineRejectedResult,
  PipelineUnresolvedResult,
  PipelineResult,
} from "./types";
