/**
 * หน้าที่: REGISTRATION DECISION — stage 4, a pure combinator. Takes the
 * already-computed results of Classification (stage 2) and Duplicate
 * Resolution (stage 3) and combines them into ONE outcome — it never
 * recomputes either. No domain lookup, no fingerprinting, no store
 * access happens in this file.
 *
 * Input: `ClassificationResult`, `DuplicateResolutionResult`.
 * Output: `decideRegistration` -> `RegistrationDecisionOutcome`.
 * Dependency ที่อนุญาต: ../event-pipeline/contract.ts (types only), ./types.ts.
 * สิ่งที่ห้ามแตะ: never import classifyCandidate, fingerprintCandidate, or
 * resolveDuplicate here — this file only combines their already-produced
 * results.
 */

import type { ClassificationResult } from "../event-pipeline/contract";
import type { DuplicateOf, DuplicateResolutionResult, PipelineStage } from "./types";

export type RegistrationDecisionOutcome =
  | { decision: "APPROVED" }
  | { decision: "REJECTED"; failed_stage: PipelineStage; reason_code: string }
  | { decision: "UNRESOLVED"; failed_stage: PipelineStage; reason_code: string }
  | { decision: "DUPLICATE"; reason_code: string; duplicate_of: DuplicateOf };

export function decideRegistration(classification: ClassificationResult, duplicate: DuplicateResolutionResult): RegistrationDecisionOutcome {
  if (classification.decision === "UNRESOLVED_DOMAIN") {
    return { decision: "UNRESOLVED", failed_stage: "CLASSIFICATION", reason_code: classification.reason_code };
  }
  if (classification.decision === "DOMAIN_REJECTED" || classification.decision === "INGRESS_METADATA_INVALID") {
    return { decision: "REJECTED", failed_stage: "CLASSIFICATION", reason_code: classification.reason_code };
  }
  // classification.decision === "ACCEPT" from here on.
  if (duplicate.status === "UNRESOLVED_DUPLICATE") {
    return { decision: "UNRESOLVED", failed_stage: "DUPLICATE_RESOLUTION", reason_code: duplicate.reason_code ?? "UNRESOLVED_DUPLICATE" };
  }
  if (duplicate.status === "DUPLICATE_EXACT" || duplicate.status === "DUPLICATE_SEMANTIC") {
    return { decision: "DUPLICATE", reason_code: duplicate.status, duplicate_of: duplicate.matched! };
  }
  return { decision: "APPROVED" };
}
