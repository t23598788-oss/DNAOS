/**
 * หน้าที่: type contracts for `observability/joint-monitor/` — pure types,
 * no behavior. `status`/`reason` are plain `string`, deliberately never
 * imported from `contracts/command/capability-result.ts`'s
 * `CapabilityResultStatus` or `control/agent-gateway/types.ts`'s `Status`:
 * this capability observes BOTH `control/command-router/` (which uses the
 * former) and `control/agent-gateway/` (which uses a different, unrelated
 * union), so it must stay decoupled from either caller's specific status
 * vocabulary rather than pick one and silently misrepresent the other.
 *
 * Input: none (pure type definitions).
 * Output: `JointEvent`, `ViolationEvent`, `ReportJointInput`,
 * `ReportViolationInput`, `JointMonitorSnapshot`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never add a field that lets a caller pre-supply
 * `event_id`/`received_at`/`at` — all three are only ever produced by
 * ./joint-store.ts at the moment an event is actually recorded, never by
 * the reporting caller (see
 * reports/SYSTEM_JOINT_AND_SEARCH_WASTE_AUDIT_2026-08-22.md for why
 * fabricated evidence timestamps are exactly the failure mode this
 * capability exists to make impossible). NARROWED, not lifted, 2026-08-26
 * (Owner): the separate `OccurrenceStamp` fields below ARE
 * reporter-supplied, because ordering by the collector's arrival time was
 * proven wrong against a real production task. The collector's own
 * unforgeable stamp is still recorded beside every claimed one, so the
 * claim is always checkable — never remove `received_at` to "clean up"
 * an apparent duplicate of `occurred_at`.
 */

/**
 * The two clocks every recorded row carries, kept strictly apart (Owner,
 * 2026-08-26). Conflating them is what made production show
 * `FAILED` before `VERIFYING` for one real task: reports are `void`-fired
 * concurrently by their callers, so arrival order over a real network is
 * not emission order, and the store's own arrival stamp was the only
 * timestamp a row had.
 *
 * - EVENT_OCCURRED_ORDER = `occurred_at` + `occurred_seq` + `reporter_run_id`,
 *   stamped by ./client.ts inside the reporting process at the moment the
 *   real call site fired. This is the ONLY thing order may be derived
 *   from. Reporter-claimed, and labelled as such — see the note on
 *   forgery below.
 * - COLLECTOR_RECEIVED_AT = `received_at` (and its unchanged legacy alias
 *   `at`), stamped by ./joint-store.ts when the report actually landed.
 *   Never used for ordering; kept because the gap between the two is the
 *   real transport latency measurement and deleting it would throw that
 *   away.
 */
export interface OccurrenceStamp {
  /** When the reporting process fired this — reporter-claimed, ordering source of truth. */
  occurred_at: string;
  /** Monotonic counter within one `reporter_run_id`, so two events in the same millisecond still order deterministically. */
  occurred_seq: number;
  /** Identifies the one reporter process/run that produced `occurred_seq`, so counters from different processes are never compared as if they shared a sequence. */
  reporter_run_id: string;
}

/** One real cross-capability call, as reported by the capability that made it — never inferred, never scanned for. */
export interface JointEvent extends OccurrenceStamp {
  event_id: string;
  from_capability: string;
  to_capability: string;
  /** The real task_id this joint produced/belongs to, when one exists — null for joints that never mint a Task (e.g. an early classification exit). */
  task_id: string | null;
  status: string;
  summary: string;
  /** `<file path>#<function name>` of the real call site that reported this — matches the evidence-citation convention every other capability in this repo already uses. */
  source: string;
  /** COLLECTOR_RECEIVED_AT — stamped here, never trusted from a reporter. */
  received_at: string;
  /** Unchanged legacy alias of `received_at`: every row written since 2026-08-22 carries `at`, and existing readers (data/joints.jsonl, the 17 rows already on disk) still read it. Same value, kept so this change reads nothing that was written before it as malformed. */
  at: string;
}

/** One detected policy/boundary violation, from `control/circuit-breaker/` (or any future reporter) — `enforced` records whether this violation actually triggered a kill, or was report-only (dry-run mode), so the dashboard never conflates "detected" with "acted on". */
export interface ViolationEvent extends OccurrenceStamp {
  event_id: string;
  launch_id: string;
  reason: string;
  detail: string;
  source: string;
  /** COLLECTOR_RECEIVED_AT — see `JointEvent`. */
  received_at: string;
  /** Unchanged legacy alias of `received_at` — see `JointEvent`. */
  at: string;
  enforced: boolean;
}

/**
 * What a real calling capability passes. Deliberately unchanged by the
 * 2026-08-26 ordering fix: `control/agent-gateway/`,
 * `control/command-router/` and `control/circuit-breaker/` call
 * `reportJoint`/`reportViolation` with exactly the same argument as
 * before — the occurrence stamp is added by ./client.ts, inside this
 * capability, so no caller's own code had to change to get correct
 * ordering.
 */
export type ReportJointInput = Omit<JointEvent, "event_id" | "at" | "received_at" | keyof OccurrenceStamp>;
export type ReportViolationInput = Omit<ViolationEvent, "event_id" | "at" | "received_at" | keyof OccurrenceStamp>;

/**
 * What actually goes over the wire: the caller's input plus ./client.ts's
 * occurrence stamp. `event_id`/`received_at`/`at` are still absent by
 * construction — those remain the store's alone, which is the original
 * anti-forgery rule in this file's header and is unchanged.
 *
 * `occurred_at`/`occurred_seq` ARE reporter-supplied, which is the one
 * thing this file previously forbade outright. Stated plainly rather than
 * hidden: a lying reporter can claim any occurrence time. That is
 * accepted deliberately, because the alternative (ordering by arrival)
 * was already proven to display a real task's real transitions in the
 * wrong order. The collector's own independent `received_at` is still
 * recorded next to it and cannot be forged, so any claimed time can
 * always be checked against when the report really landed.
 */
export type JointReport = ReportJointInput & OccurrenceStamp;
export type ViolationReport = ReportViolationInput & OccurrenceStamp;

export interface JointMonitorSnapshot {
  recent_joints: readonly JointEvent[];
  recent_violations: readonly ViolationEvent[];
  updated_at: string;
}
