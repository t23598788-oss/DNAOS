/**
 * หน้าที่: the public boundary of `control/owner-command-semantics/` — the
 * only file another capability folder may import from, per
 * `../../governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * `./semantic-runner.py` and `./run-semantic.sh` are deliberately NOT reachable
 * from here: no caller may run the model without the contract check and the
 * deterministic resolution that follow it.
 *
 * Input: re-exports only.
 * Output: the layer entry point, the resolution helpers, and every type.
 * Dependency ที่อนุญาต: ./resolver.ts, ./ai-contract.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: ห้าม re-export ทางที่เรียกโมเดลได้โดยข้าม validator.
 */

export { resolveOwnerCommandSemantics, resolveFromInterpretation, resolveCapabilityMention, resolveResourceMention, resolveContinuation, resolvePolicyCommandId, type SemanticDeps, type SemanticOutcome } from "./resolver";
export { recordCommandTaskId } from "./resolver";
export { readEvidenceForCapability, readTaskState, readHistoryForIdentity, readDocumentReferences, type ReadResult, type HistoryRecord, type TaskStateResult } from "./read-paths";
export { validateAiInterpretation, type AiValidation } from "./ai-contract";
export type { AiSemanticInterpretation, ResolvedReference, StructuredOwnerContext, Provenance, ResolutionStatus, SourceTraceEntry } from "./types";
