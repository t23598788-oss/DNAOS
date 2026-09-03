/**
 * หน้าที่: type contracts for `control/work-resolution/` — the layer that
 * RESOLVES the existing system BEFORE any coding Agent is dispatched, so
 * the Agent receives an executable work packet instead of a discovery
 * assignment.
 *
 * THE ONE RULE (Owner, 2026-08-26): an Agent is never told "an
 * implementation exists, go find it". Every WHERE/WHAT/WHETHER question is
 * answered here, deterministically, from the Registry, the Capability
 * Index, the Live Census and the real filesystem — before dispatch.
 *
 * RELATIONSHIP TO `../scheduler/work-packet.ts` — this EXTENDS it, it does
 * not replace it. That file already owns the correct dispatch boundary
 * ("a Processing Resource must not scan the repo") but is built for
 * census-driven maintenance kinds (WIRE_OR_RETIRE/REPAIR/IMPLEMENT/
 * RESOLVE_DEPENDENCY) and carries no existing-system resolution: no
 * decision, no existing_capability_id, no exact_source_paths, no
 * components_to_reuse, no forbidden_write_scope. This folder computes
 * exactly those, and `./contract.ts#toWorkPacketFields` hands them down in
 * that file's own shape rather than forking a second packet format.
 *
 * Input: none (pure type definitions).
 * Output: every type below.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never add a field an Agent is expected to fill in by
 * looking around — a field this layer cannot prove stays `UNKNOWN`, and
 * `UNKNOWN` is a dispatch blocker, not an invitation to investigate.
 */

/** The literal, unresolvable value. Never replaced by a guess, at any stage. */
export const UNKNOWN = "UNKNOWN" as const;

/** Step 1 input. Nothing here is a path or a decision — only what the Owner asked for. */
export interface WriteIntent {
  readonly requested_function: string;
  readonly requested_change: string;
  readonly target_domain: string;
  readonly owner_intent: string;
  readonly current_work_id: string;
}

export type ResolutionDecision =
  /** A complete implementation exists and satisfies the intent. Nothing to build. */
  | "REUSE_EXISTING"
  /** Exists; the missing piece belongs INSIDE its own boundary. */
  | "EXTEND_EXISTING"
  /** Exists in a different runtime/repo; the missing piece is a new consumer beside it. */
  | "ADAPT_EXISTING"
  /** Every deterministic source returned nothing. Only then may something new be built. */
  | "MISSING_CONFIRMED"
  /** Sources disagree, or evidence is insufficient. Dispatch is BLOCKED, never guessed. */
  | "UNRESOLVED";

/** One deterministic source consulted, and what it actually returned. */
export interface ResolutionProbe {
  readonly source: string;
  readonly query: string;
  readonly hit: boolean;
  readonly detail: string;
}

/**
 * A candidate existing implementation, with the evidence that found it.
 * `match_score` is a token-overlap count — an integer produced by code,
 * never a model's confidence.
 */
export interface ExistingMatch {
  readonly canonical_name: string;
  readonly capability_id: string;
  readonly resource_id: string;
  readonly repository: string;
  readonly source_paths: readonly string[];
  readonly public_functions: readonly string[];
  readonly runtime_owner: string;
  readonly runtime_type: string;
  readonly credential_boundary: string;
  readonly consumers: readonly string[];
  readonly match_score: number;
  readonly matched_on: readonly string[];
  /** From the Registry row itself — see §2. Empty when the row carries none. */
  readonly input_contract?: readonly string[];
  readonly output_contract?: readonly string[];
  readonly side_effects?: readonly string[];
}

/**
 * Step 3's output — the complete packet. Every field is either proven or
 * `UNKNOWN`; there is no third state and no default.
 */
export interface ResolvedWorkContext {
  readonly work_id: string;
  readonly decision: ResolutionDecision;

  readonly existing_resource_id: string;
  readonly existing_capability_id: string;
  readonly canonical_name: string;

  readonly repository: string;
  readonly source_root: string;
  readonly exact_source_paths: readonly string[];
  readonly contract_paths: readonly string[];
  readonly public_functions: readonly string[];
  readonly input_contract: readonly string[];
  readonly output_contract: readonly string[];

  readonly runtime_owner: string;
  readonly runtime_type: string;
  readonly service_id: string;
  readonly credential_boundary: string;

  readonly dependencies: readonly string[];
  readonly consumers: readonly string[];
  readonly blueprint_refs: readonly string[];
  readonly evidence_refs: readonly string[];

  readonly missing_piece: string;
  readonly required_change: string;

  /** Closed set. A write outside this is BLOCK_WRITE, not a warning. */
  readonly allowed_write_scope: readonly string[];
  /** Named explicitly so a violation is reported against a rule, not a vibe. */
  readonly forbidden_write_scope: readonly string[];

  readonly components_to_reuse: readonly string[];
  /** The duplication this work must not produce — checked before any write. */
  readonly components_not_to_reimplement: readonly string[];

  readonly required_imports: readonly string[];
  readonly verification_commands: readonly string[];
  readonly completion_conditions: readonly string[];

  readonly next_action: string;

  /** Every source consulted, in order, with its real result. The audit trail. */
  readonly resolution_path: readonly ResolutionProbe[];
  /** True only when every dispatch-critical field is proven. False blocks dispatch. */
  readonly dispatchable: boolean;
  readonly blocking_reason: string;
}

export type EnforcementVerdict = "ALLOW_WRITE" | "BLOCK_WRITE";

/** Step 5's output. A block always names the existing component and the reuse required. */
export interface EnforcementResult {
  readonly verdict: EnforcementVerdict;
  readonly reason_code:
    | "IN_SCOPE"
    | "OUT_OF_ALLOWED_SCOPE"
    | "IN_FORBIDDEN_SCOPE"
    | "DUPLICATE_IMPLEMENTATION_BLOCKED"
    | "NOT_DISPATCHABLE";
  readonly existing_component: string;
  readonly required_reuse: readonly string[];
  readonly allowed_next_action: string;
  readonly detail: string;
}
