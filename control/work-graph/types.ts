/**
 * หน้าที่: type contracts for `control/work-graph/` — the dependency-aware work
 * graph DERIVED from the Live Census.
 *
 * OWNER DIRECTIVE this satisfies: no sequential global phases. Every work item
 * carries exactly one runtime state, and a BLOCKED item blocks only its own
 * dependent branch — never unrelated work. That property is a consequence of
 * deriving state per item from its OWN dependencies, so it cannot be violated
 * by an ordering mistake somewhere else.
 *
 * Input: none (pure type definitions).
 * Output: `WorkItem`, `WorkState`, `WorkKind`, `WorkGraph`, `Dispatch`.
 * Dependency ที่อนุญาต: none — a leaf contract.
 * สิ่งที่ห้ามแตะ: never add a sixth runtime state. The Owner named exactly five;
 * anything else (e.g. "PENDING") would reintroduce phase thinking.
 */

/** The ONLY five runtime states a work item may have. */
export type WorkState = "READY" | "RUNNING" | "BLOCKED" | "VERIFIED" | "RETIRED";

export type WorkKind =
  /** Run a capability's own tests and record the result as evidence. */
  | "VERIFY_CAPABILITY"
  /** A capability with code but no callers, no contract and no live process — wire it or retire it. */
  | "WIRE_OR_RETIRE"
  /** A capability whose own tests really ran and really failed — the source itself needs a real fix, not a re-run. */
  | "REPAIR"
  /** A capability folder that is DECLARED (named, present in the census) but has no `.ts`/`.mjs` implementation at all. */
  | "IMPLEMENT"
  /** A capability BLOCKED on an unmet in-repo dependency chain that is itself stuck, not merely not-yet-reached. */
  | "RESOLVE_DEPENDENCY"
  /** Work that cannot proceed for a reason outside the repository. */
  | "EXTERNAL";

/**
 * The class of worker a `WorkItem` must be dispatched to — derived from
 * `kind` alone (`workerClassFor`, `./derive.ts`), never chosen by a caller.
 * `DETERMINISTIC_TEST` is the ONLY class whose result may ever set a
 * capability's census outcome to VERIFIED (`control/scheduler/coordinator.ts`
 * enforces this structurally, not by convention) — every `*_AGENT`/
 * `REASONING_INTEGRATION` class produces evidence that can change the
 * SOURCE, but never self-certifies the change; the next `DETERMINISTIC_TEST`
 * dispatch against the changed source is what actually verifies it.
 */
export type WorkerClass =
  | "DETERMINISTIC_TEST"
  | "REASONING_INTEGRATION"
  | "REPAIR_AGENT"
  | "IMPLEMENTATION_AGENT"
  | "DEPENDENCY_RESOLUTION_AGENT";

export interface WorkItem {
  work_id: string;
  kind: WorkKind;
  /** Derived 1:1 from `kind` — see `WorkerClass`'s own doc for the verification-authority rule this exists to carry. */
  worker_class: WorkerClass;
  /** The capability path this work acts on. */
  target: string;
  /** Files/folders this item will WRITE. Used to claim a non-overlapping boundary before dispatch. */
  write_scope: readonly string[];
  /** Test files this item will execute, if any. */
  test_files: readonly string[];
  /** Other work_ids that must reach VERIFIED first. Derived from real declared dependencies. */
  depends_on: readonly string[];
  state: WorkState;
  /** Present only when BLOCKED — names the specific unmet dependency or external cause. */
  blocked_by: readonly string[];
  /** Why the item is in this state, in words, so a reader never guesses. */
  reason: string;
  /** Evidence produced when this item reached VERIFIED. */
  evidence_ref: string | null;
}

export interface WorkGraph {
  derived_at: string;
  items: readonly WorkItem[];
  totals: Readonly<Record<WorkState, number>>;
}

/** One dispatch decision: the items chosen to run concurrently, and what was deliberately held back. */
export interface Dispatch {
  dispatch_id: string;
  decided_at: string;
  dispatched: readonly WorkItem[];
  /** READY items NOT dispatched this round, each with the real reason (write-scope overlap, concurrency cap). */
  withheld: readonly { work_id: string; reason: string }[];
}

/** What an agent returns. Agents report evidence; they never report system state. */
export interface WorkResult {
  work_id: string;
  target: string;
  outcome: "VERIFIED" | "PARTIAL" | "FAILED" | "BLOCKED";
  /** Literal observed output — "N passed, M failed" — not a summary. */
  evidence_ref: string;
  passed: number;
  failed: number;
  duration_ms: number;
  /** Raw tail of the agent's output, kept for audit when a run fails. */
  output_tail: string;
}
