/**
 * หน้าที่: the Capability Result Contract — the ONE uniform shape every
 * registered capability (`../../control/command-router/`'s routing
 * targets: `file-intelligence`, `permission-reasoner`, `research-engine`,
 * `execution`, `github`, and any future one) must return, so
 * `../../control/owner-command/` never has to know the internal result
 * shape of any individual capability. Distinct from `./routing-result.ts`
 * (which answers "was this envelope allowed to route at all") — this
 * contract answers "what happened when the routed capability actually
 * ran," including partial/blocked/needs-review outcomes, never only a
 * pass/fail boolean.
 *
 * Input: none (pure type definition).
 * Output: `CapabilityResultStatus`, `CapabilityResult`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never collapse `status` back down to a boolean or a
 * two-value enum — `BLOCKED` and `OWNER_REVIEW` are distinct from
 * `FAILED` on purpose (a policy stop is not the same fact as a real
 * failure), matching this repo's no-silent-failure discipline already
 * used in `./routing-result.ts` and
 * `../../permissions/execution-policy/types.ts`'s
 * `ExecutionPermissionDecision`. Never add a field that lets a capability
 * hand raw, unsanitized business data back through `evidence`/`artifacts`
 * — each capability's own adapter is responsible for sanitizing before it
 * ever reaches this shape.
 *
 * NOT_YET_BUILT: produced by ../../control/command-router/ once it wires
 * a real capability call, consumed by ../../control/owner-command/'s
 * Owner-facing surface. See ../../control/command-router/README.md.
 */

export type CapabilityResultStatus = "PENDING" | "RUNNING" | "COMPLETED" | "BLOCKED" | "OWNER_REVIEW" | "FAILED";

/** One step's worth of supporting evidence — a plain, already-sanitized fact, never a bare boolean (matches ./routing-result.ts's own discipline). */
export interface CapabilityResultEvidence {
  source: string; // which capability/step produced this fact, e.g. "github.read_status", "execution-policy.decision"
  note: string;
}

/** A reference to something the capability produced — never inline file content (matches connections/github/adapter-contract.ts's own "metadata only" rule). */
export interface CapabilityResultArtifact {
  kind: string; // e.g. "execution_id", "event_id", "decision_id" — a reference, not a payload
  ref: string;
}

/**
 * The uniform result shape. `task_id` identifies the Owner-visible task
 * this result belongs to (stable across every step of a multi-worker
 * sequence — see ../../control/command-router/router.ts); `capability_id`
 * identifies which single registered capability actually produced THIS
 * result (for a combined multi-step result, the router sets this to the
 * id of the last capability invoked and records every step's own id in
 * `evidence`).
 */
export interface CapabilityResult {
  task_id: string;
  capability_id: string;
  status: CapabilityResultStatus;
  summary: string;
  evidence: readonly CapabilityResultEvidence[];
  artifacts: readonly CapabilityResultArtifact[];
  warnings: readonly string[];
  next_action: string | null;
}
