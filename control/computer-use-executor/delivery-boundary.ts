/**
 * หน้าที่: name the intermediate boundaries a scroll actually crosses between
 * dispatch and the target's wheel listener, say which of them can currently be
 * observed at all, and derive from evidence which ones were reached — without
 * turning an unobserved boundary into a failed one (Owner, 2026-09-02).
 *
 * WHY THE CHAIN IS SHORT AND SPECIFIC. Every boundary below was read out of
 * source, not imagined: the executor's adapter call, os-ui's admission, the
 * `execFile` of connections/os-ui/bin/mouse-helper, the CGEvent post inside
 * mouse-helper.swift, the window server's routing of a coordinate-less scroll
 * wheel event, and the page's own wheel listener. Boundaries that are
 * theoretically describable but have no producer in this path are absent.
 *
 * THE FACT THAT SHAPED THIS FILE, AND WHAT CHANGED. `OK scroll 0,600` looks
 * like proof that a CGEvent was posted. It never was: the OK line prints
 * unconditionally after the post call, so a null event produced silence and an
 * OK. Step 12 split that single opaque boundary in two, along the line the SDK
 * actually supports — CGEventCreateScrollWheelEvent2 returns a nullable ref, so
 * CGEVENT_CONSTRUCTION is knowable, and CGEventPost returns void, so
 * CGEVENT_POST_INVOCATION is the furthest anything can claim. There is no
 * CGEVENT_ACCEPTED boundary because nothing acknowledges one. Executions
 * written before that instrumentation report UNAVAILABLE and stay UNKNOWN; the
 * OK line is still never read as CGEvent evidence.
 *
 * THREE STATES, NOT TWO — AGAIN. REACHED, NOT_OBSERVED and UNKNOWN stay apart.
 * UNKNOWN means no measurement exists for that boundary; NOT_OBSERVED means a
 * real measurement ran and did not see it. Collapsing them would let a boundary
 * nobody can watch be reported as one that failed, which is exactly the jump
 * from TARGET_RECEIPT_NOT_OBSERVED to "delivery failed" that this step exists
 * to refuse.
 *
 * WHAT THIS FILE STILL MAY NOT SAY. It localizes; it does not blame. No
 * component is named as defective, no cause is proposed, no repair or retry is
 * chosen. Producing the map is the whole job.
 *
 * Input: one ExecutionEvidence row + any DiagnosticFindings drawn from it.
 * Output: the boundary contract, SCROLL_DELIVERY_CHAIN, buildDeliveryKnowledgeMap.
 * Dependency ที่อนุญาต: ./executor (types), ./diagnostic-wheel-receipt (types), ./diagnostic-procedure (types).
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่ม boundary ที่ไม่มี producer จริงในเส้นทางนี้, ห้ามแปลง
 * UNOBSERVABLE เป็น FAILED, ห้ามระบุ component ที่เสีย.
 */
import type { ExecutionEvidence } from "./executor";
import type { DiagnosticFinding } from "./diagnostic-wheel-receipt";
import type { CgEventBoundaryState } from "./cgevent-instrumentation";
import type { EvidenceLocation, StateContractId } from "./diagnostic-procedure";

/** The boundaries this operation really crosses, in order. Each has a producer in source. */
export type DeliveryBoundaryId =
  | "EXECUTOR_DISPATCH"
  | "ADAPTER_ADMISSION"
  | "HELPER_PROCESS_INVOCATION"
  | "CGEVENT_CONSTRUCTION"
  | "CGEVENT_POST_INVOCATION"
  | "WINDOW_SERVER_ROUTING"
  | "TARGET_RECEIPT"
  | "TARGET_DEFAULT_ACTION";

/** Whether a measurement for this boundary exists at all — not whether it passed. */
export type BoundaryObservabilityStatus =
  /** A real measurement exists and is captured today. */
  | "OBSERVABLE"
  /** The boundary exists but no producer emits a signal that could confirm it. */
  | "UNOBSERVABLE"
  /** A measurement is possible but nothing captures it on this path yet. */
  | "UNREGISTERED";

/** What the evidence says about one boundary on one execution. */
export type BoundaryReachState =
  /** A measurement ran and showed the boundary was crossed. */
  | "REACHED"
  /** A measurement ran and did NOT see it crossed. Not the same as proof it failed. */
  | "NOT_OBSERVED"
  /** No measurement covers it. Nothing at all is claimed. */
  | "UNKNOWN";

/** Where a boundary's confirming signal is read from. */
export type BoundaryEvidenceSource =
  | "EXECUTION_EVIDENCE_EXECUTED"
  | "EXECUTION_EVIDENCE_DISPATCH_EVIDENCE"
  | "OBSERVATION_STATE"
  | "EFFECT_VERDICT"
  | "EXECUTION_EVIDENCE_CGEVENT_INSTRUMENTATION"
  | "NONE";

export interface DeliveryBoundary {
  boundary_id: DeliveryBoundaryId;
  upstream_boundary: DeliveryBoundaryId | null;
  downstream_boundary: DeliveryBoundaryId | null;
  capability_id: string;
  operation: string;
  /** Which producer emits (or would emit) the confirming signal. */
  producer: string;
  /** Observable keys/markers that confirm this boundary, if any. */
  observable_keys: readonly string[];
  evidence_sources: readonly BoundaryEvidenceSource[];
  /** Which observation the keys must be read from — empty when the source is not an observation. */
  observation_requirement: readonly { observable: string; location: EvidenceLocation }[];
  requires_state_contract: StateContractId | null;
  authority_requirement: "NONE" | "COMPUTER_USE_LEASE" | "OWNER_SESSION";
  status: BoundaryObservabilityStatus;
  /** Why a boundary is not observable — finite, and empty when it is. */
  unobservable_reason: UnobservableReason | null;
}

/** Finite reasons a boundary cannot be confirmed. No prose is executable here. */
export type UnobservableReason =
  /** The producer reports success unconditionally, so its output cannot distinguish success from failure. */
  | "PRODUCER_REPORTS_UNCONDITIONALLY"
  /** A signal could be captured but nothing on this path captures it. */
  | "NO_CAPTURE_ON_THIS_PATH";

const OS_UI = "capability-0de653bb-c968-4168-85c6-9d67beef2b5a";

/**
 * The scroll delivery chain, transcribed from source. Read top to bottom:
 * executor.ts → adapter-contract.ts admission → runMouseHelper's execFile →
 * mouse-helper.swift's CGEvent post → the window server → the page's listener →
 * the browser's default action.
 */
export const SCROLL_DELIVERY_CHAIN: readonly DeliveryBoundary[] = Object.freeze([
  {
    boundary_id: "EXECUTOR_DISPATCH", upstream_boundary: null, downstream_boundary: "ADAPTER_ADMISSION",
    capability_id: OS_UI, operation: "scroll",
    producer: "control/computer-use-executor/executor.ts#executeComputerUse",
    observable_keys: Object.freeze(["executed"]),
    evidence_sources: Object.freeze(["EXECUTION_EVIDENCE_EXECUTED"] as const),
    observation_requirement: Object.freeze([]), requires_state_contract: null,
    authority_requirement: "NONE", status: "OBSERVABLE", unobservable_reason: null,
  },
  {
    boundary_id: "ADAPTER_ADMISSION", upstream_boundary: "EXECUTOR_DISPATCH", downstream_boundary: "HELPER_PROCESS_INVOCATION",
    capability_id: OS_UI, operation: "scroll",
    producer: "connections/os-ui/adapter-contract.ts#admission",
    // The admission markers the adapter prepends to every outcome's evidence.
    observable_keys: Object.freeze(["ui_action=scroll", "scope=", "risk="]),
    evidence_sources: Object.freeze(["EXECUTION_EVIDENCE_DISPATCH_EVIDENCE"] as const),
    observation_requirement: Object.freeze([]), requires_state_contract: null,
    authority_requirement: "NONE", status: "OBSERVABLE", unobservable_reason: null,
  },
  {
    boundary_id: "HELPER_PROCESS_INVOCATION", upstream_boundary: "ADAPTER_ADMISSION", downstream_boundary: "CGEVENT_CONSTRUCTION",
    capability_id: OS_UI, operation: "scroll",
    producer: "connections/os-ui/adapter-contract.ts#runMouseHelper (execFile of bin/mouse-helper)",
    // Proves the process ran and exited 0 with stdout starting "OK".
    observable_keys: Object.freeze(["mouse_helper=OK"]),
    evidence_sources: Object.freeze(["EXECUTION_EVIDENCE_DISPATCH_EVIDENCE"] as const),
    observation_requirement: Object.freeze([]), requires_state_contract: null,
    authority_requirement: "NONE", status: "OBSERVABLE", unobservable_reason: null,
  },
  {
    boundary_id: "CGEVENT_CONSTRUCTION", upstream_boundary: "HELPER_PROCESS_INVOCATION", downstream_boundary: "CGEVENT_POST_INVOCATION",
    capability_id: OS_UI, operation: "scroll",
    // CGEventCreateScrollWheelEvent2 returns a nullable ref, so construction is
    // a fact the API really can report — once the helper stops swallowing it.
    producer: "connections/os-ui/mouse-helper.swift#post (CGEvent construction result)",
    observable_keys: Object.freeze(["cgevent_instrumentation.construction"]),
    evidence_sources: Object.freeze(["EXECUTION_EVIDENCE_CGEVENT_INSTRUMENTATION"] as const),
    observation_requirement: Object.freeze([]), requires_state_contract: null,
    authority_requirement: "NONE", status: "OBSERVABLE", unobservable_reason: null,
  },
  {
    boundary_id: "CGEVENT_POST_INVOCATION", upstream_boundary: "CGEVENT_CONSTRUCTION", downstream_boundary: "WINDOW_SERVER_ROUTING",
    capability_id: OS_UI, operation: "scroll",
    // The furthest the API allows: that post() was called. CGEventPost returns
    // void, so acceptance and delivery remain someone else's boundary.
    producer: "connections/os-ui/mouse-helper.swift#post (post invocation)",
    observable_keys: Object.freeze(["cgevent_instrumentation.post_invocation"]),
    evidence_sources: Object.freeze(["EXECUTION_EVIDENCE_CGEVENT_INSTRUMENTATION"] as const),
    observation_requirement: Object.freeze([]), requires_state_contract: null,
    authority_requirement: "NONE", status: "OBSERVABLE", unobservable_reason: null,
  },
  {
    boundary_id: "WINDOW_SERVER_ROUTING", upstream_boundary: "CGEVENT_POST_INVOCATION", downstream_boundary: "TARGET_RECEIPT",
    capability_id: OS_UI, operation: "scroll",
    // A scrollWheelEvent2 carries no coordinate, so the window server routes it
    // by pointer location and frontmost window. Both are measurable — the helper
    // has a read-only `pos` op and System Events reports the frontmost pid — but
    // neither is captured at dispatch time on this path.
    producer: "macOS window server (routing of a coordinate-less scroll wheel event)",
    observable_keys: Object.freeze(["pointer_position_at_dispatch", "frontmost_pid_at_dispatch"]),
    evidence_sources: Object.freeze(["NONE"] as const),
    observation_requirement: Object.freeze([]), requires_state_contract: null,
    authority_requirement: "NONE", status: "UNREGISTERED",
    unobservable_reason: "NO_CAPTURE_ON_THIS_PATH",
  },
  {
    boundary_id: "TARGET_RECEIPT", upstream_boundary: "WINDOW_SERVER_ROUTING", downstream_boundary: "TARGET_DEFAULT_ACTION",
    capability_id: OS_UI, operation: "scroll",
    producer: "control/computer-use-executor/sandbox/acceptance-sandbox.html (window wheel listener)",
    observable_keys: Object.freeze(["wc"]),
    evidence_sources: Object.freeze(["OBSERVATION_STATE"] as const),
    observation_requirement: Object.freeze([
      { observable: "wc", location: "OBSERVATION_BEFORE" as EvidenceLocation },
      { observable: "wc", location: "OBSERVATION_AFTER" as EvidenceLocation },
    ]),
    requires_state_contract: "DNAOS_SANDBOX_TITLE_V1",
    authority_requirement: "NONE", status: "OBSERVABLE", unobservable_reason: null,
  },
  {
    boundary_id: "TARGET_DEFAULT_ACTION", upstream_boundary: "TARGET_RECEIPT", downstream_boundary: null,
    capability_id: OS_UI, operation: "scroll",
    producer: "browser default scroll, observed as window.scrollY in the same title contract",
    observable_keys: Object.freeze(["sy"]),
    evidence_sources: Object.freeze(["EFFECT_VERDICT", "OBSERVATION_STATE"] as const),
    observation_requirement: Object.freeze([
      { observable: "sy", location: "OBSERVATION_BEFORE" as EvidenceLocation },
      { observable: "sy", location: "OBSERVATION_AFTER" as EvidenceLocation },
    ]),
    requires_state_contract: "DNAOS_SANDBOX_TITLE_V1",
    authority_requirement: "NONE", status: "OBSERVABLE", unobservable_reason: null,
  },
]) as readonly DeliveryBoundary[];

export interface DeliveryKnowledgeMap {
  capability_id: string;
  operation: string;
  evidence_id: string;
  /** Every boundary in order, with what this execution's evidence says about it. */
  boundaries: readonly { boundary_id: DeliveryBoundaryId; status: BoundaryObservabilityStatus; reach: BoundaryReachState }[];
  /** The furthest boundary a measurement actually confirmed. */
  last_proven_reached: DeliveryBoundaryId | null;
  /** The first boundary no measurement covers. Not a failure — an absence of measurement. */
  first_unknown: DeliveryBoundaryId | null;
  /** The first boundary a real measurement ran on and did not see crossed. */
  first_not_observed: DeliveryBoundaryId | null;
}

/** The chain is declared for one capability and one operation; nothing else may borrow it. */
export function chainFor(capabilityId: string | null, operation: string): readonly DeliveryBoundary[] | null {
  const chain = SCROLL_DELIVERY_CHAIN.filter((b) => b.capability_id === capabilityId && b.operation === operation);
  return chain.length === SCROLL_DELIVERY_CHAIN.length ? SCROLL_DELIVERY_CHAIN : null;
}

function dispatchEvidence(evidence: ExecutionEvidence): readonly string[] {
  return evidence.outcome?.dispatch_evidence.evidence ?? [];
}

/**
 * Derives, per boundary, what this execution's already-persisted evidence says.
 * Pure. An UNOBSERVABLE or UNREGISTERED boundary always yields UNKNOWN — never
 * REACHED by inheritance from an upstream boundary, and never NOT_OBSERVED,
 * because nothing looked.
 */
export function buildDeliveryKnowledgeMap(
  evidence: ExecutionEvidence,
  findings: readonly DiagnosticFinding[] = [],
): DeliveryKnowledgeMap | null {
  const chain = chainFor(evidence.capability_id ?? null, String(evidence.operation));
  if (!chain) return null;

  const own = findings.filter((f) => f.source_execution_evidence_id === evidence.evidence_id);
  const lines = dispatchEvidence(evidence);

  const reachOf = (boundary: DeliveryBoundary): BoundaryReachState => {
    if (boundary.status !== "OBSERVABLE") return "UNKNOWN";
    switch (boundary.boundary_id) {
      case "EXECUTOR_DISPATCH":
        return evidence.executed === true ? "REACHED" : "NOT_OBSERVED";
      case "ADAPTER_ADMISSION":
        return boundary.observable_keys.every((k) => lines.some((l) => l.startsWith(k))) ? "REACHED" : "UNKNOWN";
      case "HELPER_PROCESS_INVOCATION":
        return lines.includes("mouse_helper=OK") ? "REACHED"
          : lines.some((l) => l.startsWith("mouse_helper=")) ? "NOT_OBSERVED" : "UNKNOWN";
      case "CGEVENT_CONSTRUCTION":
      case "CGEVENT_POST_INVOCATION": {
        // Owned by the helper's own instrumentation, not re-derived here. A row
        // written before that instrumentation existed reports UNAVAILABLE, which
        // is UNKNOWN — never REACHED by inheritance from the OK line.
        const inst = evidence.cgevent_instrumentation;
        if (!inst) return "UNKNOWN";
        const state: CgEventBoundaryState = boundary.boundary_id === "CGEVENT_CONSTRUCTION" ? inst.construction : inst.post_invocation;
        return state === "REACHED" ? "REACHED" : state === "FAILED" || state === "NOT_REACHED" ? "NOT_OBSERVED" : "UNKNOWN";
      }
      case "TARGET_RECEIPT": {
        // Owned by the registered procedure, not re-derived here — one semantic owner.
        const f = own.find((x) => x.resolved_unknown_key === "input_reached_target_application");
        if (!f) return "UNKNOWN";
        return f.finding === "OBSERVED" ? "REACHED" : f.finding === "NOT_OBSERVED" ? "NOT_OBSERVED" : "UNKNOWN";
      }
      case "TARGET_DEFAULT_ACTION": {
        const v = evidence.effect_verdict;
        if (!v || v.deciding_observable !== "scrollY") return "UNKNOWN";
        return v.status === "VERIFIED" ? "REACHED" : v.status === "FAILED" ? "NOT_OBSERVED" : "UNKNOWN";
      }
      default:
        return "UNKNOWN";
    }
  };

  const boundaries = chain.map((b) => ({ boundary_id: b.boundary_id, status: b.status, reach: reachOf(b) }));
  // "Last proven reached" is the furthest CONTIGUOUS confirmation from the
  // start: a later REACHED across an unknown gap does not prove the gap.
  let lastProven: DeliveryBoundaryId | null = null;
  for (const b of boundaries) {
    if (b.reach !== "REACHED") break;
    lastProven = b.boundary_id;
  }
  return {
    capability_id: evidence.capability_id ?? "",
    operation: String(evidence.operation),
    evidence_id: evidence.evidence_id,
    boundaries: Object.freeze(boundaries),
    last_proven_reached: lastProven,
    first_unknown: boundaries.find((b) => b.reach === "UNKNOWN")?.boundary_id ?? null,
    first_not_observed: boundaries.find((b) => b.reach === "NOT_OBSERVED")?.boundary_id ?? null,
  };
}
