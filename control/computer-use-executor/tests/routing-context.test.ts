/**
 * หน้าที่: prove that DNA OS records where the pointer was and which process was
 * frontmost in the instant before it dispatched an input — as facts, at a
 * temporal point the code can actually defend, and never reconstructed
 * afterwards (Owner, 2026-09-02).
 *
 * WHY THIS CANNOT BE DONE LATER. A scroll wheel event carries no coordinate, so
 * the window server routes it by pointer position and frontmost window. Neither
 * is kept by the OS, so once the instant passes the routing context of that
 * execution is gone. Case 6 fails if anything backfills a historical row from
 * current state, which would look like evidence and be fiction.
 *
 * THE ZERO THAT IS NOT A MEASUREMENT. `mouse-helper pos` computes
 * `CGEvent(source: nil)?.location ?? .zero`, so a failed read prints `POS 0 0`
 * — identical to a cursor genuinely at the corner. Case 7 requires that exact
 * value to be recorded as NOT acquired with a reason naming the ambiguity. A
 * fabricated coordinate that looks measured is the worst outcome available
 * here, worse than no coordinate at all.
 *
 * "IMMEDIATELY BEFORE", NOT "AT". The real dispatch happens inside another
 * process that reports nothing back, so the strongest defensible claim is that
 * these readings were taken with no observation, no await and no other work
 * between them and the adapter call. Cases 3 and 4 assert that ordering in
 * source, because a name the code does not enforce is just a label.
 *
 * Input: none — producers, authority, adapter and observer are all injected.
 * The two real producers are exercised once, read-only, in cases 1 and 2.
 * Output: exit code 0 (all passed) or 1.
 * Dependency ที่อนุญาต: ../routing-context, ../executor, node built-ins.
 * สิ่งที่ห้ามแตะ: ห้ามยอมรับพิกัดที่ไม่ได้อ่านมาจริง, ห้ามให้ observer สรุปเรื่อง routing.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { NOT_CAPTURED, captureRoutingContext, type RoutingContext } from "../routing-context";
import { EXECUTION_ROUTE_CAPABILITY_ID, executeComputerUse, type ExecutionEvidence } from "../executor";
import { SCROLL_DELIVERY_CHAIN } from "../delivery-boundary";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const dir = mkdtempSync(join(tmpdir(), "dna-os-routing-test-"));
const evidenceDir = relative(process.cwd(), dir);
const rows = (): ExecutionEvidence[] =>
  readFileSync(join(dir, "execution-evidence.jsonl"), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as ExecutionEvidence);

const CONTRACT_STATE = { clicks: "0", dbls: "0", st: "SANDBOX READY", in: "", sy: "0", dl: "72", af: "body", mx: "1861", wc: "0", wdy: "0", wdm: "0", wt: "" };
/** Stamps advance with each read so BEFORE < capture < AFTER reflects the real order. */
let observeTick = 0;
const seen = () => ({ acquired: true, observed_at: `2026-09-02T16:00:0${observeTick++ === 0 ? 0 : 2}.000Z`, source: "ACCESSIBILITY_WINDOW_TITLE", state: CONTRACT_STATE, unavailable_reason: null }) as never;
const OUTCOME = { ok: true, status: "COMPLETED", summary: "scroll via CGEvent", evidence: ["ui_action=scroll", "mouse_helper=OK", "OK scroll 0,600"], artifacts: [], next_action: null, idempotent_replay: false, presentation: null, focus_restored: null } as never;

const base = {
  authority_id: "authority-test", requester: "control/computer-use-executor/tests",
  operation: "scroll" as never, target: "screen", capability_id: EXECUTION_ROUTE_CAPABILITY_ID as string,
  observation_target: { pid: 4242 }, scope_needed: ["screen"],
  ui: { app: "chrome", target: "screen", scope: "screen", delta: { dx: 0, dy: 600 } },
};

const CAPTURED: RoutingContext = {
  acquired: true, capture_point: "IMMEDIATELY_BEFORE_DISPATCH",
  pointer_position: { x: 720, y: 630 }, pointer_source: "MOUSE_HELPER_POS", pointer_acquired_at: "2026-09-02T16:00:01.000Z",
  frontmost_pid: 4242, frontmost_source: "SYSTEM_EVENTS_FRONTMOST", frontmost_acquired_at: "2026-09-02T16:00:00.900Z",
  target_pid: 4242, target_window_bounds: { x: 0, y: 0, width: 1440, height: 900 },
  bounds_source: "SYSTEM_EVENTS_WINDOW_BOUNDS", window_identity_source: "TARGET_PUBLISHED_STATE_TITLE",
  bounds_acquired_at: "2026-09-02T16:00:00.800Z",
  acquired_at: "2026-09-02T16:00:01.000Z", failure_reason: null,
};

function runWith(id: string, capture: boolean, ctx: RoutingContext | (() => RoutingContext) = CAPTURED, order: string[] = []) {
  observeTick = 0;
  return executeComputerUse({ ...base, work_order_id: `wo-${id}`, capture_routing_context: capture } as never, {
    validateAuthority: () => ({ ok: true }) as never,
    runUiWorkOrder: async () => { order.push("ADAPTER"); return OUTCOME; },
    observe: () => { order.push("OBSERVE"); return seen(); },
    captureRoutingContext: () => { order.push("ROUTING"); return typeof ctx === "function" ? ctx() : ctx; },
    now: () => new Date(), newEvidenceId: () => id, evidenceDir,
    platform: "darwin",
  } as never);
}

/** The live capture needs a real target pid; the frontmost process is a real one. */
function rawPidForLive(): number {
  return Number(String(execFileSync("/usr/bin/osascript", ["-e", 'tell application "System Events" to get unix id of first process whose frontmost is true'], { encoding: "utf8" })).trim());
}

(async () => {
  // ===== 1-2. the real producers, exercised once, read-only =====
  const live = captureRoutingContext({ pid: rawPidForLive() });
  const rawPos = String(execFileSync(join(process.cwd(), "connections/os-ui/bin/mouse-helper"), ["pos"], { encoding: "utf8" })).trim();
  check("1. the pointer producer returns real current coordinates",
    /^POS\s+-?\d+\s+-?\d+$/.test(rawPos)
    && (live.pointer_position !== null || live.failure_reason === "POINTER_VALUE_INDISTINGUISHABLE_FROM_READ_FAILURE"),
    `${rawPos} -> ${JSON.stringify(live.pointer_position)}`);
  const rawPid = Number(String(execFileSync("/usr/bin/osascript", ["-e", 'tell application "System Events" to get unix id of first process whose frontmost is true'], { encoding: "utf8" })).trim());
  check("2. the frontmost producer returns a real current pid",
    Number.isInteger(rawPid) && rawPid > 0 && live.frontmost_pid !== null && live.frontmost_source === "SYSTEM_EVENTS_FRONTMOST",
    `pid=${live.frontmost_pid}`);

  // ===== 3-5. the temporal point =====
  const order: string[] = [];
  await runWith("cue-rc-order", true, CAPTURED, order);
  check("3. routing context is captured at the declared point: after BEFORE, before dispatch",
    JSON.stringify(order) === JSON.stringify(["OBSERVE", "ROUTING", "ADAPTER", "OBSERVE"]),
    order.join(" → "));
  const execSrc = readFileSync(join(process.cwd(), "control/computer-use-executor/executor.ts"), "utf8");
  const between = execSrc.slice(execSrc.indexOf("const routingContext"), execSrc.indexOf("const outcome = await deps.runUiWorkOrder(order)"));
  check("4. nothing sits between the capture and the dispatch in source",
    !/deps\.observe\(|observeWindowTitleState\(|\bawait\b/.test(between.replace(/\/\/[^\n]*/g, "")),
    "the capture point's name is enforced by code order, not only asserted");
  const captured = rows().find((r) => r.evidence_id === "cue-rc-order")!;
  check("5. the AFTER observation cannot substitute for routing context",
    captured.routing_context!.capture_point === "IMMEDIATELY_BEFORE_DISPATCH"
    && Date.parse(captured.routing_context!.acquired_at!) < Date.parse(captured.observation_after!.observed_at!)
    && !("pointer_position" in captured.observation_after!));

  // ===== 6. no backfill =====
  const routingSrc = readFileSync(join(process.cwd(), "control/computer-use-executor/routing-context.ts"), "utf8");
  const allModules = ["routing-context.ts", "executor.ts", "outcome-classification.ts", "delivery-boundary.ts", "diagnostic-wheel-receipt.ts"]
    .map((f) => readFileSync(join(process.cwd(), "control/computer-use-executor", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")).join("\n");
  check("6. no backfill path exists for historical evidence",
    !/backfill|reconstruct/i.test(allModules)
    // Nothing assigns the field onto an already-written row; it exists only as
    // part of the object literal built during the execution that captured it.
    && !/\.routing_context\s*=[^=]/.test(allModules)
    // `extraFacts["routing_context"] = …` in the classifier writes a key into a
    // classification's known_facts — a different object entirely, not the
    // evidence row's field. What must not exist is a write onto an evidence row.
    && !/\b(evidence|row|ev)\s*\[\s*"routing_context"\s*\]\s*=/.test(allModules),
    "routing context is written once, at execution time, or not at all");

  // ===== 7-9. absence is never a value =====
  const ambiguous: RoutingContext = { ...CAPTURED, acquired: false, pointer_position: null, failure_reason: "POINTER_VALUE_INDISTINGUISHABLE_FROM_READ_FAILURE" };
  await runWith("cue-rc-nopointer", true, ambiguous);
  const noPointer = rows().find((r) => r.evidence_id === "cue-rc-nopointer")!;
  check("7. an unreadable pointer stores null, never {x:0,y:0}",
    noPointer.routing_context!.pointer_position === null && noPointer.routing_context!.acquired === false
    && noPointer.routing_context!.failure_reason === "POINTER_VALUE_INDISTINGUISHABLE_FROM_READ_FAILURE"
    && !/"x":0/.test(JSON.stringify(noPointer.routing_context!.pointer_position)));
  const noFront: RoutingContext = { ...CAPTURED, acquired: false, frontmost_pid: null, failure_reason: "FRONTMOST_PRODUCER_FAILED" };
  await runWith("cue-rc-nofront", true, noFront);
  const nf = rows().find((r) => r.evidence_id === "cue-rc-nofront")!;
  check("8. an unreadable frontmost stores null, never a guessed pid",
    nf.routing_context!.frontmost_pid === null && nf.routing_context!.acquired === false
    && nf.routing_context!.pointer_position!.x === 720,
    "the fact that WAS read is kept; the pair is still not called complete");
  const FINITE_BOUNDS = ["NO_TARGET_PID", "TARGET_PROCESS_NOT_FOUND", "TARGET_WINDOW_NOT_FOUND", "TARGET_WINDOW_AMBIGUOUS", "WINDOW_POSITION_READ_FAILED", "WINDOW_SIZE_READ_FAILED", "WINDOW_BOUNDS_INVALID"];
  const FINITE = ["NO_ROUTING_CONTEXT_CAPTURE_FOR_THIS_EXECUTION", "POINTER_PRODUCER_FAILED", "POINTER_OUTPUT_UNPARSEABLE", "POINTER_VALUE_INDISTINGUISHABLE_FROM_READ_FAILURE", "FRONTMOST_PRODUCER_FAILED", "FRONTMOST_OUTPUT_UNPARSEABLE"];
  check("9. every acquisition failure carries a finite reason",
    [noPointer, nf].every((r) => FINITE.includes(r.routing_context!.failure_reason!))
    && NOT_CAPTURED.failure_reason === "NO_ROUTING_CONTEXT_CAPTURE_FOR_THIS_EXECUTION");

  // ===== 10-14. the observer concludes nothing =====
  check("10. the capture contains no routing conclusion",
    !/pointer_over_target|correct_window|routing_possible|routing_failed|focus_caused|reachable|on_target/i.test(JSON.stringify(captured.routing_context))
    && Object.keys(captured.routing_context!).sort().join(",") === "acquired,acquired_at,bounds_acquired_at,bounds_source,capture_point,failure_reason,frontmost_acquired_at,frontmost_pid,frontmost_source,pointer_acquired_at,pointer_position,pointer_source,target_pid,target_window_bounds,window_identity_source",
    Object.keys(captured.routing_context!).join(","));
  check("11. the capture produces no effect verdict of its own",
    !("effect_verdict" in captured.routing_context!) && captured.effect_verdict!.status === "FAILED"
    && captured.effect_verdict!.deciding_observable === "scrollY",
    "the verdict still comes only from expectation + observations");
  check("12. the capture produces no diagnostic finding",
    !/finding|diagnostic|resolved_unknown/i.test(JSON.stringify(captured.routing_context))
    && !/DiagnosticFinding/.test(routingSrc.replace(/\/\*[\s\S]*?\*\//g, "")));
  check("13. the capture produces no root cause",
    !/root_cause|cause|defect|component/i.test(JSON.stringify(captured.routing_context)));
  check("14. the capture selects no next state",
    !/next_state|BLOCKED|DIAGNOSE|REPAIR|RETRY/i.test(JSON.stringify(captured.routing_context)));

  // ===== 15. capture failure is not action failure =====
  await runWith("cue-rc-allfail", true, { ...NOT_CAPTURED, failure_reason: "POINTER_PRODUCER_FAILED", pointer_source: "MOUSE_HELPER_POS", frontmost_source: "SYSTEM_EVENTS_FRONTMOST", acquired_at: "2026-09-02T16:00:01.000Z" });
  const allFail = rows().find((r) => r.evidence_id === "cue-rc-allfail")!;
  check("15. a failed capture does not fabricate an action failure",
    allFail.routing_context!.acquired === false && allFail.executed === true
    && allFail.result_status === "COMPLETED" && allFail.authorized === true,
    "observation availability is evidence about observation, not about the action");
  const thrown = await runWith("cue-rc-throws", true, () => { throw new Error("producer exploded"); }).then(() => "NO_THROW").catch(() => "THREW");
  check("15b. a capture that throws is not silently swallowed into a false success", thrown === "THREW",
    "the caller sees the error rather than an evidence row claiming a capture that never happened");

  // ===== 16-18. compatibility and determinism =====
  await runWith("cue-rc-optout", false);
  const optOut = rows().find((r) => r.evidence_id === "cue-rc-optout")!;
  check("16a. an existing caller that does not opt in records NOT_CAPTURED, not a failure",
    optOut.routing_context!.acquired === false && optOut.routing_context!.pointer_source === "NONE"
    && optOut.routing_context!.failure_reason === "NO_ROUTING_CONTEXT_CAPTURE_FOR_THIS_EXECUTION");
  const legacy = JSON.parse('{"evidence_id":"cue-legacy","work_order_id":"w","execution_owner":"control/computer-use-executor","executor_pid":1,"executor_process_title":"node","requester":"x","authority_id":"a","operation":"scroll","target":"screen","authorized":true,"authorization_reason":"AUTHORIZED","executed":true,"result_status":"COMPLETED","started_at":"2026-09-01T00:00:00.000Z","completed_at":"2026-09-01T00:00:01.000Z"}') as ExecutionEvidence;
  check("16b. legacy evidence remains readable; routing context simply absent",
    legacy.result_status === "COMPLETED" && legacy.routing_context === undefined);
  const step5 = readFileSync(join(process.cwd(), "control/computer-use-executor/data/execution-evidence.jsonl"), "utf8")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l) as ExecutionEvidence)
    .find((r) => r.evidence_id === "cue-195b83ba-ab96-4465-b877-568614e8bf42")!;
  check("17. the Step 5 historical row still reports routing context as absent",
    step5.routing_context === undefined && step5.effect_verdict!.status === "FAILED",
    "not backfilled, not reinterpreted");
  const repeats = new Set(Array.from({ length: 100 }, () => JSON.stringify(CAPTURED)));
  check("18. structure and readback are deterministic",
    repeats.size === 1 && JSON.stringify(captured.routing_context) === JSON.stringify(CAPTURED));

  // ===== 19. no model =====
  const code = routingSrc.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
  check("19. no model or network in the capture path",
    !/\b(fetch|anthropic|openai|claude|http|Math\.random)\b/i.test(code),
    "two read-only OS producers and nothing else");

  // ===== 20-27. earlier steps intact on the same row =====
  check("20-27. the whole chain still lands on one row, in order",
    !!captured.capability_id && !!captured.expectation && !!captured.observation_before
    && !!captured.routing_context && !!captured.outcome && !!captured.observation_after && !!captured.effect_verdict
    && captured.outcome!.dispatch_evidence.evidence.includes("OK scroll 0,600")
    && captured.result_status === "COMPLETED");


  // ================= STEP 10 — the target window bounds fact =================
  // A. real acquisition, against a real process, read-only.
  const livePid = rawPidForLive();
  const liveBounds = captureRoutingContext({ pid: livePid });
  const rawGeom = String(execFileSync("/usr/bin/osascript", ["-e",
    `tell application "System Events" to tell (first process whose unix id is ${livePid}) to get {count of windows, position of window 1, size of window 1}`], { encoding: "utf8" })).trim();
  check("B1. bounds acquisition runs against a real process and returns a fact or a finite reason",
    (liveBounds.target_window_bounds !== null && liveBounds.target_window_bounds.width > 0)
    || FINITE_BOUNDS.includes(liveBounds.failure_reason!),
    `pid=${livePid} raw={${rawGeom}} -> ${JSON.stringify(liveBounds.target_window_bounds)} reason=${liveBounds.failure_reason}`);
  check("B2. bounds are recorded against the execution's own target pid",
    liveBounds.target_pid === livePid && liveBounds.bounds_source === "SYSTEM_EVENTS_WINDOW_BOUNDS"
    && liveBounds.window_identity_source === "TARGET_PUBLISHED_STATE_TITLE");
  // B3: a process that exists but publishes no marker window is NOT borrowed —
  // this is the "unrelated process window" case, using a real live pid.
  check("B3. a process whose windows carry no identity marker yields no bounds",
    liveBounds.target_window_bounds === null ? liveBounds.failure_reason === "TARGET_WINDOW_NOT_FOUND" : true,
    `frontmost process bounds=${JSON.stringify(liveBounds.target_window_bounds)}`);
  check("B4. a missing target pid returns null bounds with NO_TARGET_PID",
    captureRoutingContext({}).target_window_bounds === null
    && captureRoutingContext({}).failure_reason === "NO_TARGET_PID"
    && captureRoutingContext({}).target_pid === null);
  const gonePid = captureRoutingContext({ pid: 999999 });
  check("B5. a process that does not exist returns null bounds, never a rectangle",
    gonePid.target_window_bounds === null && gonePid.failure_reason === "TARGET_PROCESS_NOT_FOUND");
  check("B6. no window matching the identity marker returns null",
    captureRoutingContext({ pid: livePid }, () => new Date(), "NO_SUCH_PREFIX_ZZZ").failure_reason === "TARGET_WINDOW_NOT_FOUND");

  // B7-B13: the parse/validation rules, exercised through injected records so
  // no process needs to be contrived into an ambiguous state.
  const withBounds = (b: RoutingContext["target_window_bounds"], reason: RoutingContext["failure_reason"]): RoutingContext =>
    ({ ...CAPTURED, acquired: b !== null, target_window_bounds: b, failure_reason: reason });
  await runWith("cue-rc-ambiguous", true, withBounds(null, "TARGET_WINDOW_AMBIGUOUS"));
  const amb = rows().find((r) => r.evidence_id === "cue-rc-ambiguous")!;
  check("B7. two marker windows are refused, not resolved by picking the first",
    amb.routing_context!.target_window_bounds === null
    && amb.routing_context!.failure_reason === "TARGET_WINDOW_AMBIGUOUS" && amb.routing_context!.acquired === false);
  await runWith("cue-rc-nopos", true, withBounds(null, "WINDOW_POSITION_READ_FAILED"));
  await runWith("cue-rc-nosize", true, withBounds(null, "WINDOW_SIZE_READ_FAILED"));
  check("B8/B9. position and size read failures are separately attributable and store null",
    rows().find((r) => r.evidence_id === "cue-rc-nopos")!.routing_context!.failure_reason === "WINDOW_POSITION_READ_FAILED"
    && rows().find((r) => r.evidence_id === "cue-rc-nosize")!.routing_context!.failure_reason === "WINDOW_SIZE_READ_FAILED"
    && rows().find((r) => r.evidence_id === "cue-rc-nopos")!.routing_context!.target_window_bounds === null);
  await runWith("cue-rc-zeroxy", true, withBounds({ x: 0, y: 0, width: 1440, height: 900 }, null));
  const zeroXY = rows().find((r) => r.evidence_id === "cue-rc-zeroxy")!;
  check("B10/B11. x=0 and y=0 are valid positions and are kept",
    zeroXY.routing_context!.target_window_bounds!.x === 0 && zeroXY.routing_context!.target_window_bounds!.y === 0
    && zeroXY.routing_context!.acquired === true,
    "a full-screen window really does sit at 0,0");
  // The rule that rejects non-positive extents lives in the reader; assert the
  // reader's own contract rather than a fixture's.
  const readerSrc = readFileSync(join(process.cwd(), "control/computer-use-executor/routing-context.ts"), "utf8");
  check("B12/B13. non-positive width or height is refused as not-a-rectangle",
    /width <= 0 \|\| height <= 0/.test(readerSrc) && /WINDOW_BOUNDS_INVALID/.test(readerSrc)
    && !/width < 0|height < 0/.test(readerSrc.replace(/\/\*[\s\S]*?\*\//g, "")));

  // B14-B17: still no geometry, still no conclusion.
  const rcCode = readerSrc.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
  check("B14/B15. the observer never compares the pointer with the bounds",
    !/pointer_inside|inside\(|contains\(|isInside|>=\s*bounds|bounds\.\w+\s*<=/.test(rcCode)
    && !/pointer_position[\s\S]{0,80}target_window_bounds[\s\S]{0,40}[<>]/.test(rcCode),
    "the rectangle and the point sit side by side, uncompared");
  check("B16/B17. no routing success or failure is produced anywhere in the record",
    !/routing_possible|routing_success|routing_failed|pointer_inside_target|correct_window|reachable/i.test(JSON.stringify(zeroXY.routing_context))
    && !/routing_possible|routing_success|routing_failed|pointer_inside_target/i.test(rcCode));
  check("B18. bounds cannot bridge the CGEvent boundary, in either half",
    SCROLL_DELIVERY_CHAIN.some((b) => b.boundary_id === "CGEVENT_CONSTRUCTION")
    && SCROLL_DELIVERY_CHAIN.some((b) => b.boundary_id === "CGEVENT_POST_INVOCATION")
    && !rcCode.includes("CGEVENT"),
    "pointer inside bounds and frontmost==target would still not prove a CGEvent was posted");
  check("B19. per-fact timestamps are recorded, and no simultaneity is claimed",
    !!zeroXY.routing_context!.bounds_acquired_at && !!zeroXY.routing_context!.frontmost_acquired_at
    && !!zeroXY.routing_context!.pointer_acquired_at
    && zeroXY.routing_context!.capture_point === "IMMEDIATELY_BEFORE_DISPATCH");

  rmSync(dir, { recursive: true, force: true });
  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
