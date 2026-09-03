/**
 * หน้าที่: the public boundary of `control/work-resolution/`.
 *
 * Input: re-exports only.
 * Output: `resolveWriteIntent` (step 2+3), `enforceProposedWrite` (step 5),
 * `toWorkPacketFields` (the hand-down into the EXISTING
 * `../scheduler/work-packet.ts` shape), plus every type.
 * Dependency ที่อนุญาต: ./resolver.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never re-export ./host-runtime.ts — filesystem reads stay
 * private so a caller cannot substitute its own "evidence".
 */

export { resolveWriteIntent, enforceProposedWrite, generateNameCandidates, tokenize, SIBLING_REPOS } from "./resolver";
export { persistResolution, loadResolution, computeResolutionDigest } from "./persistence";
export type { PersistedResolution, LoadedResolution } from "./persistence";
export { guardAgentWrite } from "./mandatory-gate";
export type { MandatoryGateResult, ProposedMutation } from "./mandatory-gate";
export { UNKNOWN } from "./types";
export type {
  EnforcementResult,
  EnforcementVerdict,
  ExistingMatch,
  ResolutionDecision,
  ResolutionProbe,
  ResolvedWorkContext,
  WriteIntent,
} from "./types";

import type { ResolvedWorkContext } from "./types";

/**
 * Hands a resolved context down in `../scheduler/work-packet.ts`'s OWN
 * field names, so the existing dispatch boundary is extended rather than
 * forked. Deliberately does not import that module: this returns plain
 * fields its `buildWorkPacket` caller can merge, keeping the dependency
 * one-way and avoiding a second packet format.
 */
export function toWorkPacketFields(context: ResolvedWorkContext): {
  objective: string;
  input_refs: readonly string[];
  permitted_write_scope: readonly string[];
  pass_criteria: readonly string[];
} {
  return {
    objective: context.next_action,
    // The Agent reads the existing implementation (to reuse it) and its own
    // scope — and nothing else. This is what replaces "go find it".
    input_refs: [...context.exact_source_paths, ...context.allowed_write_scope],
    permitted_write_scope: context.allowed_write_scope,
    pass_criteria: context.completion_conditions,
  };
}
