/**
 * หน้าที่: type contracts for `control/work-continuation/` — evidence-triggered
 * work continuation. Blocked work persists WHAT IT IS WAITING FOR as structured
 * keys, so a later event can wake exactly the work that was waiting on it,
 * without polling, without agent memory, and without scanning every work item.
 *
 * WHAT THIS DOES NOT DO — deliberately, per the Owner's "do not create another
 * task system": it does not own work identity, work progress, dispatch, or
 * resolution. Those already exist and are reused:
 *   - `control/work-session-state/`  work_id, append-only checkpoints, Blocker,
 *                                    DecisionRequired, buildResumeContext
 *   - `control/work-resolution/`     ResolvedWorkContext, computeResolutionDigest
 *   - `control/work-coordination/`   write-scope claims
 *   - `control/scheduler/`           dispatch to a real execution resource
 * This capability adds exactly two things nothing else has: a REVERSE INDEX
 * (dependency key -> waiting work_ids) and a DETERMINISTIC RESUME EVALUATOR.
 *
 * `control/realtime-change/#findRelatedWork` is the mirror image and is NOT
 * duplicated here: it maps a changed PATH to work that is RUNNING (in order to
 * interrupt it). This maps an arriving EVIDENCE KEY to work that is WAITING (in
 * order to wake it).
 *
 * Input: none (pure type definitions).
 * Output: the shapes below.
 * Dependency ที่อนุญาต: none — a leaf contract.
 * สิ่งที่ห้ามแตะ: never add a free-text field that the evaluator reads. A resume
 * criterion must be a KEY that an event can equal, never a sentence an AI has to
 * interpret — `AI_DECISION_IN_RESUME_PATH=NO` is a structural property of this
 * file, not a policy someone remembers.
 */

/**
 * A dependency key. Namespaced so an arriving event can be turned into keys by
 * string construction alone, with no lookup and no inference.
 * Examples: `evidence:E91`, `resource:resource-c191a71e`, `capability:execution/run`,
 * `runtime:port:5178`, `external:provider:github`, `owner:decision:deploy-approval`.
 */
export type DependencyKey = string;

/** How many of a waiting item's dependencies must be satisfied before it may resume. */
export type ResumeCondition =
  /** Every key in `blocked_on` must be satisfied. */
  | "ALL_AVAILABLE"
  /** Any single key in `blocked_on` is enough. */
  | "ANY_AVAILABLE"
  /** A named key must reach one exact value (see `WaitingWork.exact_state`). */
  | "EXACT_STATE"
  /** Only the Owner can clear it. No event and no agent ever satisfies this. */
  | "OWNER_DECISION";

/** The verdict of one evaluation. Never a suggestion — the dispatcher acts on it directly. */
export type ResumeVerdict =
  | "STILL_BLOCKED"
  | "RESUME_ELIGIBLE"
  | "OWNER_DECISION_REQUIRED"
  | "STALE_RESOLUTION";

/**
 * One work item that stopped and recorded exactly what would let it continue.
 * Persisted append-only; the CURRENT record for a `work_id` is the LAST one,
 * matching `control/work-session-state/`'s existing checkpoint convention so
 * both reduce the same way and a crashed writer cannot leave a half-updated row.
 */
export interface WaitingWork {
  /** THE resume key. Identical to `control/work-session-state`'s work_id — never minted here. */
  work_id: string;
  current_phase: string;
  status: "WAITING" | "WAITING_FOR_RESOURCE" | "RESUMED" | "RETIRED";

  /** Every dependency key this work is waiting on. The reverse index is built from exactly this. */
  blocked_on: readonly DependencyKey[];
  /** Subsets of `blocked_on`, kept separate so a reader can see WHAT KIND of thing is missing. */
  required_evidence: readonly DependencyKey[];
  required_resources: readonly DependencyKey[];
  required_capabilities: readonly DependencyKey[];
  required_runtime_state: readonly DependencyKey[];
  required_external_state: readonly DependencyKey[];

  resume_condition: ResumeCondition;
  /** Only read when `resume_condition === "EXACT_STATE"`: the key and the one value that clears it. */
  exact_state: { key: DependencyKey; equals: string } | null;

  /** The deterministic next step, decided when the work stopped — never re-derived by an agent. */
  next_action: string;
  /** Pointer into `control/work-resolution/`'s persisted ResolvedWorkContext. */
  resolved_work_context_ref: string | null;
  /** The resolution digest at the time of blocking. Compared on wake to detect STALE_RESOLUTION. */
  last_verified_revision: string | null;
  evidence_refs: readonly DependencyKey[];

  /** LOOP SAFETY — see `../evaluate.ts`. Bounded retry, not unbounded reactivation. */
  resume_attempt_count: number;
  last_resume_reason: string | null;
  /** Digest of the trigger input that last caused a resume. Identical trigger + unchanged result = refuse. */
  last_input_digest: string | null;
  /** Digest of the last recorded result for this work. */
  last_result_digest: string | null;

  /** The execution resource class this work needs, so failover can find a compatible substitute. */
  required_worker_class: string | null;
  recorded_at: string;
}

/** An arriving fact. Produced by translating an EXISTING system event; this capability observes nothing itself. */
export interface DependencyEvent {
  /** The key that just became available. */
  key: DependencyKey;
  /** Present only for EXACT_STATE matching. */
  value: string | null;
  /** Which existing producer this came from, e.g. `live-census`, `registry`, `verification`, `owner`. */
  source: string;
  /** Real provenance for the fact — a ledger line, a registry id, a census digest. */
  evidence_ref: string;
  occurred_at: string;
}

/** The reverse index: dependency key -> the work_ids waiting on it. Derived from persisted rows, never hand-maintained. */
export interface DependencyIndex {
  /** key -> work_ids. */
  waiting: ReadonlyMap<DependencyKey, readonly string[]>;
  /** How many distinct waiting work items were indexed. */
  indexed_work: number;
  built_at: string;
}

/** The result of evaluating ONE waiting item against ONE event. */
export interface Evaluation {
  work_id: string;
  verdict: ResumeVerdict;
  /** Which keys are now satisfied, and which are still missing. Always both, so a reader never guesses. */
  satisfied: readonly DependencyKey[];
  missing: readonly DependencyKey[];
  reason: string;
  /** The trigger digest this evaluation was computed from — carried into the resume record for loop safety. */
  input_digest: string;
}
