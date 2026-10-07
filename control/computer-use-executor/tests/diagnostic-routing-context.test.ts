/**
 * หน้าที่: prove that C-1 turns four captured routing facts into exactly one
 * machine-readable finding — and that "compatible" never quietly becomes
 * "routing worked" (Owner, 2026-09-02).
 *
 * THE COLLAPSE THIS FORBIDS. A pointer inside the target window with the target
 * process frontmost feels like proof the scroll should have landed. It is not.
 * Nothing in this system observes the window server, and CGEVENT_POST is
 * structurally unobservable — mouse-helper prints OK whether or not an event was
 * ever constructed. So the finding is named for what was measured, ROUTING
 * CONTEXT, and cases 23–25 and 37–38 fail if any claim about CGEvent, window
 * server delivery, or target receipt appears anywhere in the output.
 *
 * EDGES ARE A RULE, NOT AN ACCIDENT. `left <= px < right`, `top <= py < bottom`.
 * A 1200-wide window at x=22 covers columns 22..1221; column 1222 is someone
 * else's. Cases 19–22 pin all four edges, because an implicit edge policy is how
 * two correct-looking implementations disagree by one pixel forever.
 *
 * NO CURRENT-STATE READS. Every input arrives as an argument from one persisted
 * row. Case 40 checks at source that this module has no clock, subprocess or
 * live producer — otherwise it could compare a past execution against where the
 * pointer happens to be right now and call that evidence.
 *
 * Input: none — evidence rows are built in memory. No execution, no OS action.
 * Output: exit code 0 (all passed) or 1.
 * Dependency ที่อนุญาต: ../diagnostic-routing-context, ../diagnostic-procedure,
 *   ../outcome-classification, ../outcome-classification-store, ../delivery-boundary, node built-ins.
 * สิ่งที่ห้ามแตะ: ห้ามแปลง COMPATIBLE เป็นข้อสรุปว่า routing สำเร็จ, ห้ามให้
 * procedure เลือก boundary/next_state.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { C1_REGISTRATION, C1_PROCEDURE_ID, runRoutingContextProcedure, pointerInsideBounds, type RoutingContextDiagnosticFinding } from "../diagnostic-routing-context";
import { selectProcedures, type DiagnosticProcedure } from "../diagnostic-procedure";
import { classifyOutcome } from "../outcome-classification";
import { readDiagnosticProcedures } from "../outcome-classification-store";
import { SCROLL_DELIVERY_CHAIN, buildDeliveryKnowledgeMap } from "../delivery-boundary";
import type { ExecutionEvidence } from "../executor";
import type { RoutingContext } from "../routing-context";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const OS_UI = "capability-0de653bb-c968-4168-85c6-9d67beef2b5a";
const CONTRACT_STATE = { clicks: "0", dbls: "0", st: "SANDBOX READY", in: "", sy: "0", dl: "72", af: "body", mx: "1861", wc: "0", wdy: "0", wdm: "0", wt: "" };
const seen = (state: Record<string, string> = {}) =>
  ({ acquired: true, observed_at: "2026-09-02T17:00:00.000Z", source: "ACCESSIBILITY_WINDOW_TITLE", state: { ...CONTRACT_STATE, ...state }, unavailable_reason: null }) as never;

/** The Step 10 routing context, as persisted. */
const RC: RoutingContext = {
  acquired: true, capture_point: "IMMEDIATELY_BEFORE_DISPATCH",
  pointer_position: { x: 720, y: 630 }, pointer_source: "MOUSE_HELPER_POS", pointer_acquired_at: "2026-09-02T17:00:00.850Z",
  frontmost_pid: 29454, frontmost_source: "SYSTEM_EVENTS_FRONTMOST", frontmost_acquired_at: "2026-09-02T17:00:00.821Z",
  target_pid: 29454, target_window_bounds: { x: 22, y: 22, width: 1200, height: 856 },
  bounds_source: "SYSTEM_EVENTS_WINDOW_BOUNDS", window_identity_source: "TARGET_PUBLISHED_STATE_TITLE",
  bounds_acquired_at: "2026-09-02T17:00:00.693Z",
  acquired_at: "2026-09-02T17:00:00.850Z", failure_reason: null,
};
const rc = (o: Partial<RoutingContext>): RoutingContext => ({ ...RC, ...o });

const evidence = (o: Partial<ExecutionEvidence>): ExecutionEvidence => ({
  evidence_id: "cue-c1-test", work_order_id: "wo-c1", execution_owner: "control/computer-use-executor",
  executor_pid: 1, executor_process_title: "node", requester: "tests", authority_id: "a",
  operation: "scroll" as never, target: "screen", capability_id: OS_UI,
  authorized: true, authorization_reason: "AUTHORIZED", executed: true, result_status: "COMPLETED",
  started_at: "2026-09-02T17:00:00.000Z", completed_at: "2026-09-02T17:00:01.000Z",
  expectation: { available: true, operation: "scroll", created_at: "2026-09-02T17:00:00.000Z", conditions: [{ observable: "scrollY", observed_as: "sy", relation: "CHANGES", expected_value: null, expected_pattern: null, origin: "OPERATION_CONTRACT" }] },
  observation_before: seen(), routing_context: RC, observation_after: seen({ wc: "1" }),
  outcome: { dispatch_evidence: { ok: true, summary: "scroll via CGEvent", evidence: ["ui_action=scroll", "scope=screen", "risk=LOW", "mouse_helper=OK", "OK scroll 0,600"], idempotent_replay: false }, artifact_references: [], presentation_state: null, focus_restoration_verified: null, next_action: null },
  effect_verdict: { status: "FAILED", reason_code: "EXPECTATION_NOT_MET", evaluated_at: "2026-09-02T17:00:01.000Z", deciding_observable: "scrollY", deciding_relation: "CHANGES", observed_before_value: "0", observed_after_value: "0", expectation_operation: "scroll", expectation_created_at: "2026-09-02T17:00:00.000Z", observation_before_at: "2026-09-02T17:00:00.000Z", observation_after_at: "2026-09-02T17:00:00.900Z" },
  ...o,
} as ExecutionEvidence);

let n = 0;
const run = (e: ExecutionEvidence) => runRoutingContextProcedure(C1_REGISTRATION, e, () => `df-c1-${++n}`, () => new Date("2026-09-02T18:00:00.000Z"));
const ALL_UNKNOWN = ["root_cause", "defective_component", "input_reached_target_application", "target_default_action_occurred", "focus_state_caused_outcome", "timing_caused_outcome", "routing_context_compatible_with_target", "repair_required"] as never[];
const sel = (e: ExecutionEvidence, unknowns = ALL_UNKNOWN, procs: readonly DiagnosticProcedure[] = [C1_REGISTRATION]) => selectProcedures(procs, unknowns, e, "SYSTEM");

(async () => {
  // ===== 1-3. identity and registry =====
  check("1. procedure has a stable id and canonical name",
    C1_REGISTRATION.procedure_id === C1_PROCEDURE_ID && C1_REGISTRATION.canonical_name === "WINDOW_SERVER_ROUTING_CONTEXT");
  const registry = readDiagnosticProcedures();
  const fromRegistry = registry.find((p) => p.procedure_id === C1_PROCEDURE_ID);
  check("2. registered in, and readable from, the existing registry",
    !!fromRegistry && JSON.stringify(fromRegistry) === JSON.stringify(C1_REGISTRATION));
  check("3. no parallel registry was created — both procedures share one store",
    registry.length === 2 && registry.some((p) => p.procedure_id === "proc-wheel-receipt-from-existing-observation-v1"),
    registry.map((p) => p.canonical_name).join(", "));

  // ===== 4-8. selection preconditions =====
  check("4. exact capability match required",
    sel(evidence({ capability_id: "capability-00000000-0000-0000-0000-000000000000" })).rejected.some((r) => r.rejection === "CAPABILITY_MISMATCH"));
  check("5. exact operation match required",
    sel(evidence({ operation: "click" as never })).rejected.some((r) => r.rejection === "OPERATION_MISMATCH"));
  check("6. a wrong capture point is refused by the semantic owner",
    run(evidence({ routing_context: rc({ capture_point: "SOMETHING_ELSE" as never }) })).reason_code === "CAPTURE_POINT_MISMATCH");
  check("7. wrong provenance is refused",
    run(evidence({ routing_context: rc({ pointer_source: "NONE" }) })).reason_code === "PROVENANCE_MISMATCH"
    && run(evidence({ routing_context: rc({ bounds_source: "NONE" }) })).reason_code === "PROVENANCE_MISMATCH");
  const own = run(evidence({}));
  check("8. the finding references the SAME execution it was derived from",
    own.source_execution_evidence_id === "cue-c1-test"
    && classifyOutcome(evidence({}), registry, () => new Date(), [{ ...own, source_execution_evidence_id: "cue-other" }]).known_facts["routing_context"] === undefined,
    "a finding from another execution narrows nothing here");

  // ===== 9-14. missing or invalid inputs =====
  check("9. missing pointer -> UNPROVEN", run(evidence({ routing_context: rc({ pointer_position: null, acquired: true }) })).finding === "UNPROVEN");
  check("10. missing frontmost pid -> UNPROVEN", run(evidence({ routing_context: rc({ frontmost_pid: null }) })).finding === "UNPROVEN");
  check("11. missing target pid -> UNPROVEN", run(evidence({ routing_context: rc({ target_pid: null }) })).finding === "UNPROVEN");
  check("12. missing bounds -> UNPROVEN", run(evidence({ routing_context: rc({ target_window_bounds: null }) })).finding === "UNPROVEN");
  check("12b. an unacquired capture -> UNPROVEN with REQUIRED_ROUTING_CONTEXT_MISSING",
    run(evidence({ routing_context: rc({ acquired: false }) })).reason_code === "REQUIRED_ROUTING_CONTEXT_MISSING"
    && run(evidence({ routing_context: undefined })).reason_code === "REQUIRED_ROUTING_CONTEXT_MISSING");
  check("13. width <= 0 rejected as not-a-rectangle",
    run(evidence({ routing_context: rc({ target_window_bounds: { x: 22, y: 22, width: 0, height: 856 } }) })).reason_code === "INVALID_WINDOW_BOUNDS");
  check("14. height <= 0 rejected as not-a-rectangle",
    run(evidence({ routing_context: rc({ target_window_bounds: { x: 22, y: 22, width: 1200, height: -1 } }) })).reason_code === "INVALID_WINDOW_BOUNDS");

  // ===== 15-18. the four combinations =====
  check("15. pointer inside + pid match -> COMPATIBLE",
    own.finding === "ROUTING_CONTEXT_COMPATIBLE" && own.reason_code === "CONTEXT_MATCHED"
    && own.process_context_match === true && own.pointer_context_match === true);
  const outside = run(evidence({ routing_context: rc({ pointer_position: { x: 5000, y: 630 } }) }));
  check("16. pointer outside + pid match -> INCOMPATIBLE",
    outside.finding === "ROUTING_CONTEXT_INCOMPATIBLE" && outside.reason_code === "POINTER_OUTSIDE_TARGET_WINDOW"
    && outside.process_context_match === true && outside.pointer_context_match === false);
  const otherProc = run(evidence({ routing_context: rc({ frontmost_pid: 99999 }) }));
  check("17. pointer inside + pid mismatch -> INCOMPATIBLE",
    otherProc.finding === "ROUTING_CONTEXT_INCOMPATIBLE" && otherProc.reason_code === "FRONTMOST_PROCESS_MISMATCH");
  const both = run(evidence({ routing_context: rc({ frontmost_pid: 99999, pointer_position: { x: 5000, y: 5000 } }) }));
  check("18. both mismatch -> INCOMPATIBLE with the combined reason",
    both.finding === "ROUTING_CONTEXT_INCOMPATIBLE" && both.reason_code === "PROCESS_AND_POINTER_MISMATCH");

  // ===== 19-22. the four edges, pinned =====
  const B = { x: 22, y: 22, width: 1200, height: 856 };
  check("19. left edge is inclusive: x=22 in, x=21 out",
    pointerInsideBounds({ x: 22, y: 100 }, B) === true && pointerInsideBounds({ x: 21, y: 100 }, B) === false);
  check("20. top edge is inclusive: y=22 in, y=21 out",
    pointerInsideBounds({ x: 100, y: 22 }, B) === true && pointerInsideBounds({ x: 100, y: 21 }, B) === false);
  check("21. right edge is exclusive: x=1221 in, x=1222 out",
    pointerInsideBounds({ x: 1221, y: 100 }, B) === true && pointerInsideBounds({ x: 1222, y: 100 }, B) === false);
  check("22. bottom edge is exclusive: y=877 in, y=878 out",
    pointerInsideBounds({ x: 100, y: 877 }, B) === true && pointerInsideBounds({ x: 100, y: 878 }, B) === false);

  // ===== 23-27. the boundaries that must not be crossed =====
  const src = readFileSync(join(process.cwd(), "control/computer-use-executor/diagnostic-routing-context.ts"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
  // The procedure's own registered identity legitimately contains
  // "window-server" — that is the boundary it examines, not a claim about it.
  // The sweep therefore runs on the claim-bearing content, with identity fields
  // removed, plus an explicit check on the finding and reason vocabularies.
  const stripIdentity = (f: RoutingContextDiagnosticFinding) => ({ ...f, procedure_id: "", entry_point: undefined });
  const allFindings = JSON.stringify([own, outside, otherProc, both].map(stripIdentity));
  const verdictWords = [own, outside, otherProc, both].map((f) => `${f.finding}|${f.reason_code}`).join(" ");
  check("23/24/25. no CGEvent, window-server delivery or target-receipt claim anywhere",
    !/CGEvent|CGEVENT|window.?server|WINDOW_SERVER_ROUTING_(SUCCEEDED|FAILED)|delivered|target_receipt|listener/i.test(allFindings)
    && !/CGEvent|WINDOW_SERVER_ROUTING_SUCCEEDED|WINDOW_SERVER_ROUTING_FAILED/i.test(code)
    // Every finding value names CONTEXT, never routing itself.
    && [own, outside, otherProc, both].every((f) => f.finding === "UNPROVEN" || f.finding.startsWith("ROUTING_CONTEXT_"))
    && !/SUCCEED|FAIL(?!ED_)|DELIVER|RECEIV/i.test(verdictWords.replace("ROUTING_CONTEXT_INCOMPATIBLE", "")),
    "the finding names routing CONTEXT and stops there");
  check("26/27. no root cause and no defective component",
    !/root_cause|defective|component|broken|because/i.test(allFindings));
  check("28. the procedure selects no next state, boundary or classification",
    !/next_state|failure_boundary|defect_status|BLOCKED|DIAGNOSE/i.test(allFindings)
    && !("next_state" in own) && !("failure_boundary" in own));
  check("29/30. the procedure neither repairs nor retries",
    !/repair|retry|rerun|dispatch\(/i.test(code));
  check("31. the procedure performs no physical action",
    C1_REGISTRATION.physical_action === "NONE" && !/spawn|execFile|osascript|import\s*\(/.test(code));
  check("32. the procedure requires no authority",
    C1_REGISTRATION.authority_requirement === "NONE" && C1_REGISTRATION.origination === "SYSTEM");

  // ===== 33-38. persistence and the classifier =====
  check("33. the finding is a standalone append-only record with its own identity",
    own.diagnostic_finding_id.length > 0 && own.procedure_id === C1_PROCEDURE_ID
    && own.resolved_unknown_key === "routing_context_compatible_with_target");
  const source = evidence({});
  const snapshot = JSON.stringify(source);
  run(source);
  check("34. running the procedure leaves its source evidence unchanged", JSON.stringify(source) === snapshot);
  const before = classifyOutcome(evidence({}), registry, () => new Date(), []);
  const after = classifyOutcome(evidence({}), registry, () => new Date(), [own]);
  check("35. the classifier consumes the finding",
    after.known_facts["routing_context"] === "ROUTING_CONTEXT_COMPATIBLE"
    && after.known_facts["routing_context_procedure"] === C1_PROCEDURE_ID
    && before.unknown_facts.includes("routing_context_compatible_with_target")
    && !after.unknown_facts.includes("routing_context_compatible_with_target"));
  check("36. the classifier remains the classification owner",
    after.failure_boundary !== undefined && after.next_state !== undefined
    && !("failure_boundary" in own) && !("next_state" in own));
  check("37. a compatible context does NOT become routing success",
    after.failure_boundary === before.failure_boundary
    && after.failure_boundary === "UNLOCALIZED_BETWEEN_DISPATCH_AND_TARGET_EFFECT",
    "the boundary is unchanged: nothing observed the window server");
  const map = buildDeliveryKnowledgeMap(evidence({}), [own as never]);
  check("37b. WINDOW_SERVER_ROUTING and both CGEvent halves stay UNKNOWN",
    map!.boundaries.find((b) => b.boundary_id === "WINDOW_SERVER_ROUTING")!.reach === "UNKNOWN"
    && map!.boundaries.find((b) => b.boundary_id === "CGEVENT_CONSTRUCTION")!.reach === "UNKNOWN"
    && map!.boundaries.find((b) => b.boundary_id === "CGEVENT_POST_INVOCATION")!.reach === "UNKNOWN",
    "a compatible routing context bridges nothing, and this fixture carries no CGEvent instrumentation");
  const afterIncompatible = classifyOutcome(evidence({ routing_context: rc({ frontmost_pid: 99999 }) }), registry, () => new Date(), [{ ...otherProc, source_execution_evidence_id: "cue-c1-test" } as RoutingContextDiagnosticFinding]);
  check("38. an incompatible context does NOT become a window-server failure",
    afterIncompatible.failure_boundary === "UNLOCALIZED_BETWEEN_DISPATCH_AND_TARGET_EFFECT"
    && afterIncompatible.known_facts["routing_context"] === "ROUTING_CONTEXT_INCOMPATIBLE"
    && afterIncompatible.root_cause === null);

  // ===== 39-40. determinism and purity =====
  const repeats = new Set(Array.from({ length: 50 }, () => JSON.stringify({ ...run(evidence({})), diagnostic_finding_id: "*", created_at: "*" })));
  check("39. 50 repeats produce an identical semantic result", repeats.size === 1, `distinct=${repeats.size}`);
  check("40. no model, clock, subprocess or current-state read decides anything",
    !/\b(fetch|anthropic|openai|claude|spawn|exec|execFile|http|Math\.random|readFileSync|Date\.now)\b/i.test(code)
    && !/captureRoutingContext|observeWindowTitleState/.test(code),
    "every input arrives as an argument from one persisted row");

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
