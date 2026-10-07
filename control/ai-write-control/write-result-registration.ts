/**
 * หน้าที่: PHASE 8 — closes the verified file-write orphan gap. A
 * genuinely successful, non-sandbox file write (`execution/file-write/`'s
 * real, write-gate-ALLOWed, on-disk-verified result) must become a real
 * `RegistrationCandidate` and enter the SAME registration pipeline every
 * other real software write already goes through
 * (`control/registration-pipeline/contract.ts`'s `runRegistrationPipeline`)
 * — never a direct registry mutation of its own, never a second write
 * path, never a parallel registry.
 *
 * `isTemporaryWorkspaceArtifact()` is the honest boundary this file
 * exists to enforce: `control/agent-gateway/work-order-validator.ts`'s
 * own `SANDBOX_ROOT` confines EVERY WorkOrder this system can currently
 * produce to `tests/__sandbox__/` — "Sandbox is deliberately outside
 * every registered production capability folder, so the existing Write
 * Gate can prove this is a new test artifact" (that file's own comment).
 * That means, as of this STEP, every real write reachable through
 * `control/agent-gateway/adapters/ai-write-adapter.ts` today is honestly
 * a temporary workspace artifact and is correctly, deliberately never
 * registered — this function is real and ready for the day a genuine
 * non-sandbox WorkOrder mode exists; it does not fabricate today's
 * system as more capable than it is.
 *
 * Input: `WriteResultForRegistration` (the real, finished results of
 * `executeFileWrite()` + `evaluateWriteIntent()`, never recomputed here).
 * Output: `isTemporaryWorkspaceArtifact`, `toRegistrationCandidate` ->
 * `RegistrationEligibility`.
 * Dependency ที่อนุญาต: ../../execution/file-write/contract.ts (type
 * only), ../../permissions/write-gate/contract.ts (type only),
 * ../event-pipeline/contract.ts (type only).
 * สิ่งที่ห้ามแตะ: never call runRegistrationPipeline/commitRegisteredCandidate
 * here — this file only produces a candidate; the caller
 * (control/agent-gateway/adapters/ai-write-adapter.ts) is responsible
 * for actually running it through the real, unmodified registration
 * pipeline. Never register a write whose FileWriteStatus is not
 * "completed", whose WriteGateDecision is not a real ALLOW_CREATE/
 * ALLOW_MODIFY, or whose target_path is a temporary workspace artifact.
 */

import type { FileWriteResult } from "../../execution/file-write/contract";
import type { WriteGateDecision } from "../../permissions/write-gate/contract";
import type { RegistrationCandidate } from "../event-pipeline/contract";

/** Must match control/agent-gateway/work-order-validator.ts's own SANDBOX_ROOT exactly — one owner for what "temporary" means, kept in sync by hand since that file is a leaf type-driven validator with no shared contract for this constant today. */
const SANDBOX_ROOT = "tests/__sandbox__/";

export function isTemporaryWorkspaceArtifact(targetPath: string): boolean {
  return targetPath.startsWith(SANDBOX_ROOT);
}

export interface WriteResultForRegistration {
  write: FileWriteResult;
  decision: WriteGateDecision;
  target_path: string;
  requesting_identity_id: string;
  requested_change: string;
  evidence: readonly { source: string; note: string }[];
}

export type RegistrationEligibility = { eligible: true; candidate: RegistrationCandidate; reason: string } | { eligible: false; candidate: null; reason: string };

export function toRegistrationCandidate(input: WriteResultForRegistration): RegistrationEligibility {
  if (input.write.status !== "completed") {
    return { eligible: false, candidate: null, reason: `write.status=${input.write.status} — a failed/refused write is never registered` };
  }
  if (input.decision.decision !== "ALLOW_CREATE" && input.decision.decision !== "ALLOW_MODIFY") {
    return { eligible: false, candidate: null, reason: `decision=${input.decision.decision} — a write the real Write Gate did not genuinely ALLOW is never registered` };
  }
  if (isTemporaryWorkspaceArtifact(input.target_path)) {
    return { eligible: false, candidate: null, reason: `target_path=${input.target_path} is a temporary workspace artifact (SANDBOX_ROOT) — never registered as a canonical capability` };
  }
  if (input.evidence.length === 0) {
    return { eligible: false, candidate: null, reason: "no real evidence supplied for this write — never registering without a real evidence_ref" };
  }
  return {
    eligible: true,
    reason: "real, non-sandbox, write-gate-ALLOWed, on-disk-completed write — eligible for registration",
    candidate: {
      candidate_id: `write-result-${input.write.write_id}`,
      name: input.target_path,
      kind: "resource",
      source_location: input.target_path,
      owner: input.requesting_identity_id,
      input: [],
      output: [],
      side_effects: [],
      dependencies: [],
      behavior: input.requested_change,
      version: "1.0.0",
      evidence_refs: input.evidence.map((e) => e.source),
      domain: "SOFTWARE_CONTROL_PLANE",
      resource_type: "SOURCE_REFERENCE",
      data_classification: "INTERNAL",
      source_system: "dna-os-infrastructure",
      scope: "ai_write_control",
    },
  };
}
