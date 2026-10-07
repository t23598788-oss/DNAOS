/**
 * หน้าที่: C-1 — read the routing context captured immediately before a
 * dispatch and state one fact: was that context consistent with the target
 * being eligible to receive a coordinate-less input? (Owner, 2026-09-02).
 *
 * THE NAME IS NARROW ON PURPOSE. This is not "did the window server route the
 * event". Nothing in this system observes the window server, so a finding
 * called ROUTING_SUCCEEDED or ROUTING_FAILED would be a claim about a component
 * no measurement has ever touched. What the evidence supports is narrower and
 * exact: at the captured pre-dispatch moment, the target process was (or was
 * not) frontmost, and the pointer was (or was not) inside the target window's
 * rectangle. That is the whole finding.
 *
 * WHAT COMPATIBLE DOES NOT MEAN. It does not mean a CGEvent existed, that one
 * was posted, that the window server accepted or routed it, that the browser
 * received it, that the page's listener fired, or that a default scroll
 * occurred. Every one of those is a separate boundary with its own evidence
 * requirement, and CGEVENT_POST in particular remains structurally unobservable
 * — the helper prints OK whether or not the event was constructed. A compatible
 * context removes one candidate from the field; it proves nothing downstream.
 *
 * EDGE POLICY, STATED RATHER THAN IMPLIED. A window at (x, y) with (width,
 * height) occupies `left <= px < right` and `top <= py < bottom`. The right and
 * bottom edges are exclusive because a window of width 1200 starting at x=22
 * covers columns 22..1221; column 1222 belongs to whatever is next. Leaving
 * this implicit would make two implementations disagree by one pixel and call
 * it the same rule.
 *
 * PURE, AND UNABLE TO CHEAT. Every input arrives as an argument from one
 * already-persisted evidence row. There is no clock, no subprocess, no network,
 * no read of current machine state — so this cannot quietly compare a past
 * execution against where the pointer happens to be now.
 *
 * Input: the registered procedure + the ExecutionEvidence it matched.
 * Output: RoutingContextDiagnosticFinding, runRoutingContextProcedure, C1_REGISTRATION.
 * Dependency ที่อนุญาต: ./diagnostic-procedure, ./executor (types), ./routing-context (types), ./outcome-classification (types).
 * สิ่งที่ห้ามแตะ: ห้ามสรุปว่า WindowServer/CGEvent/browser ทำอะไร, ห้ามอ่านสถานะ
 * ปัจจุบันของเครื่อง, ห้ามให้ procedure เลือก next_state หรือ boundary.
 */
import type { DiagnosticProcedure } from "./diagnostic-procedure";
import type { ExecutionEvidence } from "./executor";
import type { RoutingContext, WindowBounds } from "./routing-context";
import type { UnknownFactKey } from "./outcome-classification";

export const C1_PROCEDURE_ID = "proc-window-server-routing-context-v1";
export const C1_CANONICAL_NAME = "WINDOW_SERVER_ROUTING_CONTEXT";
export const C1_RESOLVES_UNKNOWN: UnknownFactKey = "routing_context_compatible_with_target";

/** Narrower than routing success or failure, which nothing here can observe. */
export type RoutingContextFinding = "ROUTING_CONTEXT_COMPATIBLE" | "ROUTING_CONTEXT_INCOMPATIBLE" | "UNPROVEN";

/** Finite. No free-form explanation exists on a finding. */
export type RoutingContextReasonCode =
  | "CONTEXT_MATCHED"
  | "FRONTMOST_PROCESS_MISMATCH"
  | "POINTER_OUTSIDE_TARGET_WINDOW"
  | "PROCESS_AND_POINTER_MISMATCH"
  | "REQUIRED_ROUTING_CONTEXT_MISSING"
  | "INVALID_WINDOW_BOUNDS"
  | "PROVENANCE_MISMATCH"
  | "CAPTURE_POINT_MISMATCH";

export interface RoutingContextDiagnosticFinding {
  diagnostic_finding_id: string;
  procedure_id: string;
  /** Back-references. The source row is read, never written. */
  source_execution_evidence_id: string;
  work_order_id: string;
  capability_id: string | null;
  operation: string;
  resolved_unknown_key: UnknownFactKey;
  finding: RoutingContextFinding;
  reason_code: RoutingContextReasonCode;
  /** The exact values compared, so the finding can be re-derived by hand. */
  pointer_position: { x: number; y: number } | null;
  frontmost_pid: number | null;
  target_pid: number | null;
  target_window_bounds: WindowBounds | null;
  /** The two independent conditions, recorded separately from the combined finding. */
  process_context_match: boolean | null;
  pointer_context_match: boolean | null;
  /** Provenance of the values: where they came from and when they were captured. */
  evidence_source: string;
  capture_point: string | null;
  routing_context_acquired_at: string | null;
  /** Metadata only. It takes no part in the finding above. */
  created_at: string;
}

const EXPECTED_CAPTURE_POINT = "IMMEDIATELY_BEFORE_DISPATCH";
const EXPECTED_POINTER_SOURCE = "MOUSE_HELPER_POS";
const EXPECTED_FRONTMOST_SOURCE = "SYSTEM_EVENTS_FRONTMOST";
const EXPECTED_BOUNDS_SOURCE = "SYSTEM_EVENTS_WINDOW_BOUNDS";

/**
 * THE edge policy for this contract: right and bottom are exclusive. Exported so
 * a later reader can check the rule rather than infer it from a result.
 */
export function pointerInsideBounds(pointer: { x: number; y: number }, bounds: WindowBounds): boolean {
  const left = bounds.x, top = bounds.y;
  const right = bounds.x + bounds.width, bottom = bounds.y + bounds.height;
  return pointer.x >= left && pointer.x < right && pointer.y >= top && pointer.y < bottom;
}

/**
 * Runs C-1 against one evidence row. Pure apart from the id and timestamp the
 * caller supplies; the finding depends only on the four captured values.
 */
export function runRoutingContextProcedure(
  procedure: DiagnosticProcedure,
  evidence: ExecutionEvidence,
  newFindingId: () => string,
  now: () => Date = () => new Date(),
): RoutingContextDiagnosticFinding {
  const rc: RoutingContext | undefined = evidence.routing_context;

  const finish = (
    finding: RoutingContextFinding, reason_code: RoutingContextReasonCode,
    processMatch: boolean | null = null, pointerMatch: boolean | null = null,
  ): RoutingContextDiagnosticFinding => ({
    diagnostic_finding_id: newFindingId(),
    procedure_id: procedure.procedure_id,
    source_execution_evidence_id: evidence.evidence_id,
    work_order_id: evidence.work_order_id,
    capability_id: evidence.capability_id ?? null,
    operation: String(evidence.operation),
    resolved_unknown_key: C1_RESOLVES_UNKNOWN,
    finding, reason_code,
    pointer_position: rc?.pointer_position ?? null,
    frontmost_pid: rc?.frontmost_pid ?? null,
    target_pid: rc?.target_pid ?? null,
    target_window_bounds: rc?.target_window_bounds ?? null,
    process_context_match: processMatch,
    pointer_context_match: pointerMatch,
    evidence_source: "EXECUTION_EVIDENCE_ROUTING_CONTEXT",
    capture_point: rc?.capture_point ?? null,
    routing_context_acquired_at: rc?.acquired_at ?? null,
    created_at: now().toISOString(),
  });

  // ---- preconditions: an absent or wrongly-sourced reading yields a fact
  // about the evidence, never about the target ----
  if (!rc || rc.acquired !== true) return finish("UNPROVEN", "REQUIRED_ROUTING_CONTEXT_MISSING");
  if (rc.capture_point !== EXPECTED_CAPTURE_POINT) return finish("UNPROVEN", "CAPTURE_POINT_MISMATCH");
  if (rc.pointer_source !== EXPECTED_POINTER_SOURCE
    || rc.frontmost_source !== EXPECTED_FRONTMOST_SOURCE
    || rc.bounds_source !== EXPECTED_BOUNDS_SOURCE) {
    return finish("UNPROVEN", "PROVENANCE_MISMATCH");
  }
  const pointer = rc.pointer_position, bounds = rc.target_window_bounds;
  if (pointer === null || bounds === null || rc.frontmost_pid === null || rc.target_pid === null) {
    return finish("UNPROVEN", "REQUIRED_ROUTING_CONTEXT_MISSING");
  }
  if (!(bounds.width > 0) || !(bounds.height > 0)) return finish("UNPROVEN", "INVALID_WINDOW_BOUNDS");

  // ---- the two independent conditions ----
  const processMatch = rc.frontmost_pid === rc.target_pid;
  const pointerMatch = pointerInsideBounds(pointer, bounds);

  if (processMatch && pointerMatch) return finish("ROUTING_CONTEXT_COMPATIBLE", "CONTEXT_MATCHED", processMatch, pointerMatch);
  if (!processMatch && !pointerMatch) return finish("ROUTING_CONTEXT_INCOMPATIBLE", "PROCESS_AND_POINTER_MISMATCH", processMatch, pointerMatch);
  if (!processMatch) return finish("ROUTING_CONTEXT_INCOMPATIBLE", "FRONTMOST_PROCESS_MISMATCH", processMatch, pointerMatch);
  return finish("ROUTING_CONTEXT_INCOMPATIBLE", "POINTER_OUTSIDE_TARGET_WINDOW", processMatch, pointerMatch);
}

/** The registry row for C-1, so registration and semantics cannot drift apart. */
export const C1_REGISTRATION: DiagnosticProcedure = Object.freeze({
  procedure_id: C1_PROCEDURE_ID,
  canonical_name: C1_CANONICAL_NAME,
  capability_id: "capability-0de653bb-c968-4168-85c6-9d67beef2b5a",
  operation: "scroll",
  resolves_unknown: Object.freeze([C1_RESOLVES_UNKNOWN]),
  // The four facts it compares must all be present on the row it is selected for.
  requires_evidence: Object.freeze([
    { observable: "pointer_position", location: "ROUTING_CONTEXT", must_be_acquired: true },
    { observable: "frontmost_pid", location: "ROUTING_CONTEXT", must_be_acquired: true },
    { observable: "target_pid", location: "ROUTING_CONTEXT", must_be_acquired: true },
    { observable: "target_window_bounds", location: "ROUTING_CONTEXT", must_be_acquired: true },
  ]),
  requires_state_contract: null,
  origination: "SYSTEM",
  diagnostic_boundary: "DELIVERY",
  input_contract: Object.freeze(["EXECUTION_EVIDENCE"]),
  output_contract: Object.freeze(["DIAGNOSTIC_FINDING"]),
  authority_requirement: "NONE",
  physical_action: "NONE",
  status: "REGISTERED",
  registered_by: "control/computer-use-executor/diagnostic-routing-context.ts",
  entry_point: "control/computer-use-executor/diagnostic-routing-context.ts#runRoutingContextProcedure",
}) as DiagnosticProcedure;
