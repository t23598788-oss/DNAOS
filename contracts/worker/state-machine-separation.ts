/**
 * หน้าที่: document, at the type level only, why this loop has THREE
 * separate state machines that must never be merged, and what the
 * intended (but NOT automatic, NOT yet implemented) relationship between
 * them is. Owner, 2026-08-18: "Add a type-level documented transition
 * contract only. No runtime logic yet." This file contains zero
 * functions — it exists purely so a future implementer reads the
 * intended relationship before writing the real transition logic,
 * instead of inventing one from scratch or accidentally merging the
 * three machines into one.
 *
 * The three real, distinct state machines in this repo today:
 * 1. `WorkRequestExecutionState` (./work-request.ts) — the lifecycle of
 *    ONE requested job, owned by the (not-yet-built) AI Worker Gateway.
 * 2. Research & Evaluation Engine's real `executions.status` column
 *    (RUNNING | COMPLETED | FAILED | TIMEOUT) — one finished execution's
 *    real runtime result, already live in `research.db` today.
 * 3. `CapabilityStatus` (software/capability-registrar/types.ts) — a
 *    CAPABILITY's persistent registration readiness, spanning possibly
 *    many WorkRequests and executions over its lifetime.
 *
 * Input: none (pure documentation types — no function in this file is
 * ever meant to run).
 * Output: `IntendedStatusTransitionGuidance` (a documentation-shaped
 * type, not an executable rule).
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never implement a function in this file that actually
 * performs the transition described below — that belongs to a future,
 * separately-approved round, once the AI Worker Gateway itself exists.
 * Never let a future implementation collapse these three enums into one
 * shared type — each answers a different real question, at a different
 * real scope (one job vs. one finished run vs. one capability's whole
 * history).
 */

/**
 * Documents the Owner's own example (2026-08-18) as a type, not a rule
 * that runs: a WorkRequest reaching COMPLETED, together with a Lab
 * execution reaching COMPLETED, together with validation having passed
 * and evidence having been verified, does NOT automatically imply the
 * capability's `CapabilityStatus` becomes `"VERIFIED"`. `VERIFIED` status
 * on a capability requires its OWN separate verification evidence —
 * never inferred from a single successful WorkRequest.
 *
 * This type is read as documentation by whoever eventually implements
 * the real transition logic; it is never constructed or consumed at
 * runtime.
 */
export interface IntendedStatusTransitionGuidance {
  precondition_work_request_state: "COMPLETED";
  precondition_lab_execution_status: "COMPLETED";
  precondition_validation_required_and_passed: true;
  precondition_evidence_required_and_present: true;

  /** The Owner's own explicit non-implication, recorded verbatim as a type-level fact. */
  does_not_automatically_imply: "CapabilityStatus VERIFIED";

  /** What real evidence a capability's own VERIFIED status separately requires — never inferred from one WorkRequest's success alone. */
  capability_verified_requires: "capability-scoped verification evidence, independent of any single WorkRequest — see software/capability-registrar/types.ts CapabilityMetadata.EVIDENCE_SOURCE";
}
