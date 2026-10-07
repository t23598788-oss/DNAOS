/**
 * หน้าที่: prove that an execution can now distinguish "the helper ran" from
 * "the CGEvent was constructed" from "post() was invoked" — and that none of
 * those ever becomes "the window server delivered it" (Owner, 2026-09-02).
 *
 * WHAT THE SDK ALLOWS, AND THEREFORE WHAT EXISTS HERE. CGEvent.h declares
 * `CGEventCreateScrollWheelEvent2` returning `CGEventRef __nullable` and
 * `CGEventPost` returning `void`. So construction is knowable, post invocation
 * is knowable, and acceptance is not knowable by anyone. There is no
 * CGEVENT_ACCEPTED state in this contract, and case 5 fails if any delivery
 * claim appears.
 *
 * THE STRING THAT LOOKED LIKE PROOF. `OK scroll 0,600` printed unconditionally
 * on the line after the post call, so a null event yielded silence from the
 * poster and an OK from the printer. Case 7 feeds a row carrying only that line
 * and requires UNAVAILABLE. Case 8 does the same against the two real historical
 * executions, which must stay unknown at this boundary forever.
 *
 * INSTRUMENTATION IS NOT REPAIR. Cases 10–15 diff the helper source to prove the
 * event type, tap, deltas, coordinates, event count and command routing are
 * byte-identical to the pre-change version, and that the OK line still prints
 * first so the adapter's `startsWith("OK")` check is unaffected.
 *
 * Input: none — evidence rows are built in memory. No execution, no OS action.
 * Output: exit code 0 (all passed) or 1.
 * Dependency ที่อนุญาต: ../cgevent-instrumentation, ../delivery-boundary, ../executor, node built-ins.
 * สิ่งที่ห้ามแตะ: ห้ามอ่านบรรทัด OK เป็นหลักฐาน CGEvent, ห้ามยุบผลบางส่วนเป็นสำเร็จ.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NO_CGEVENT_INSTRUMENTATION, parseCgEventInstrumentation } from "../cgevent-instrumentation";
import { SCROLL_DELIVERY_CHAIN, buildDeliveryKnowledgeMap, type DeliveryBoundaryId } from "../delivery-boundary";
import type { ExecutionEvidence } from "../executor";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const OS_UI = "capability-0de653bb-c968-4168-85c6-9d67beef2b5a";
const ADMISSION = ["ui_action=scroll", "scope=screen", "risk=LOW", "reasons=none", "mouse_helper=OK"];
const OK_LINE = "OK scroll 0,600";
const CONTRACT_STATE = { clicks: "0", dbls: "0", st: "SANDBOX READY", in: "", sy: "0", dl: "72", af: "body", mx: "1861", wc: "0", wdy: "0", wdm: "0", wt: "" };
const seen = (state: Record<string, string> = {}) =>
  ({ acquired: true, observed_at: "2026-09-02T18:00:00.000Z", source: "ACCESSIBILITY_WINDOW_TITLE", state: { ...CONTRACT_STATE, ...state }, unavailable_reason: null }) as never;

const evidence = (lines: readonly string[]): ExecutionEvidence => ({
  evidence_id: "cue-cg-test", work_order_id: "wo-cg", execution_owner: "control/computer-use-executor",
  executor_pid: 1, executor_process_title: "node", requester: "tests", authority_id: "a",
  operation: "scroll" as never, target: "screen", capability_id: OS_UI,
  authorized: true, authorization_reason: "AUTHORIZED", executed: true, result_status: "COMPLETED",
  started_at: "2026-09-02T18:00:00.000Z", completed_at: "2026-09-02T18:00:01.000Z",
  observation_before: seen(), observation_after: seen(),
  outcome: { dispatch_evidence: { ok: true, summary: "scroll via CGEvent", evidence: [...lines], idempotent_replay: false }, artifact_references: [], presentation_state: null, focus_restoration_verified: null, next_action: null },
  cgevent_instrumentation: parseCgEventInstrumentation(lines),
} as ExecutionEvidence);

const reachOf = (e: ExecutionEvidence, id: DeliveryBoundaryId) =>
  buildDeliveryKnowledgeMap(e, [])!.boundaries.find((b) => b.boundary_id === id)!.reach;

const helperSrc = readFileSync(join(process.cwd(), "connections/os-ui/mouse-helper.swift"), "utf8");
const backup = readFileSync("/private/tmp/claude-501/-Users-tam-Desktop-DNA-OS-INFRASTRUCTURE/68b6c911-e6bd-4221-9bf2-933449f1630f/scratchpad/mouse-helper.swift.backup", "utf8");

(async () => {
  // ===== 1-6. the two facts, kept apart, and never promoted =====
  const posted = parseCgEventInstrumentation([...ADMISSION, OK_LINE, "CGEVENT scroll events=1 event1=CGEVENT_POST_INVOKED"]);
  check("1. construction success is explicitly represented",
    posted.construction === "REACHED" && posted.source === "MOUSE_HELPER_CGEVENT_INSTRUMENTATION"
    && posted.declared_event_count === 1 && posted.event_results.length === 1);
  const failedBuild = parseCgEventInstrumentation([...ADMISSION, OK_LINE, "CGEVENT scroll events=1 event1=CGEVENT_CONSTRUCTION_FAILED"]);
  check("2. construction failure is explicitly represented",
    failedBuild.construction === "FAILED" && failedBuild.reason_code === "CONSTRUCTION_FAILED_FOR_AT_LEAST_ONE_EVENT");
  check("3. a construction failure can never become post invoked",
    failedBuild.post_invocation === "NOT_REACHED");
  check("4. post invocation is a separate field from construction",
    posted.post_invocation === "REACHED" && posted.construction === "REACHED"
    && Object.keys(posted).includes("post_invocation") && Object.keys(posted).includes("construction"));
  const src = readFileSync(join(process.cwd(), "control/computer-use-executor/cgevent-instrumentation.ts"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
  check("5. post invocation cannot become window-server delivery",
    !/ACCEPTED|DELIVERED|WINDOW_SERVER|ROUTED/i.test(JSON.stringify(posted))
    && !/CGEVENT_ACCEPTED|WINDOW_SERVER|delivered/i.test(code),
    "CGEventPost returns void; nothing acknowledges acceptance");
  check("6. post invocation cannot become target receipt",
    !/receipt|wheel|listener|wc\b/i.test(JSON.stringify(posted))
    && reachOf(evidence([...ADMISSION, OK_LINE, "CGEVENT scroll events=1 event1=CGEVENT_POST_INVOKED"]), "WINDOW_SERVER_ROUTING") === "UNKNOWN");

  // ===== 7-9. the legacy line, and history =====
  const okOnly = parseCgEventInstrumentation([...ADMISSION, OK_LINE]);
  check("7. the legacy OK line alone is not CGEvent proof",
    okOnly.construction === "UNAVAILABLE" && okOnly.post_invocation === "UNAVAILABLE"
    && okOnly.reason_code === "INSTRUMENTATION_ABSENT" && okOnly.source === "NONE",
    "OK printed unconditionally after post(); it proves only that the helper reached that line");
  const rows = readFileSync(join(process.cwd(), "control/computer-use-executor/data/execution-evidence.jsonl"), "utf8")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l) as ExecutionEvidence);
  const historic = ["cue-195b83ba-ab96-4465-b877-568614e8bf42", "cue-251799e7-b5e9-426c-9ab2-c81ea4731980"]
    .map((id) => rows.find((r) => r.evidence_id === id)!);
  check("8. both historical executions stay UNKNOWN at the CGEvent boundary",
    historic.every((r) => r.cgevent_instrumentation === undefined)
    && historic.every((r) => reachOf(r, "CGEVENT_CONSTRUCTION") === "UNKNOWN" && reachOf(r, "CGEVENT_POST_INVOCATION") === "UNKNOWN"),
    historic.map((r) => r.evidence_id.slice(0, 12)).join(", "));
  const execSrc = readFileSync(join(process.cwd(), "control/computer-use-executor/executor.ts"), "utf8");
  const execCode = execSrc.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
  check("9. no backfill path writes instrumentation onto an existing row",
    !/backfill|reinterpret/i.test(code + execCode)
    && !/\b(evidence|row)\.cgevent_instrumentation\s*=[^=]/.test(execSrc));

  // ===== 10-16. instrumentation is not repair: the helper's behaviour is unchanged =====
  const behaviour = (s: string) => ({
    event: /CGEvent\(scrollWheelEvent2Source: src, units: \.pixel, wheelCount: 2, wheel1: dy, wheel2: dx, wheel3: 0\)/.test(s),
    tap: (s.match(/\.cghidEventTap/g) ?? []).length,
    delta: /let dx = Int32\(a\[2\]\) \?\? 0, dy = Int32\(a\[3\]\) \?\? 0/.test(s),
    moveArgs: /mouseCursorPosition: p/.test(s),
    postCalls: (s.match(/post\(CGEvent\(/g) ?? []).length,
    ops: (s.match(/^case "\w+":/gm) ?? []).join(","),
    ok: /print\("OK scroll \\\(dx\),\\\(dy\)"\)/.test(s),
  });
  const b = behaviour(backup), a = behaviour(helperSrc);
  check("10/11. event type and event tap unchanged", a.event === b.event && a.event === true && a.tap === b.tap);
  check("12/13. scroll delta and coordinate handling unchanged", a.delta === b.delta && a.moveArgs === b.moveArgs);
  check("14. event count unchanged — scrollWheelEvent2 is ONE event (wheel1/2/3 are axes)",
    a.postCalls === b.postCalls, `post(CGEvent( calls: ${b.postCalls} -> ${a.postCalls}`);
  check("15. command routing unchanged", a.ops === b.ops, a.ops);
  check("16. the legacy OK line is preserved AND still printed first",
    a.ok && b.ok && helperSrc.indexOf('print("OK scroll') < helperSrc.indexOf('print("CGEVENT scroll'),
    "the adapter checks stdout.startsWith(\"OK\"), so order is behaviour");

  // ===== 17-18. finite vocabulary, honest aggregation =====
  check("17. an unknown result code is refused rather than accepted",
    parseCgEventInstrumentation(["CGEVENT scroll events=1 event1=CGEVENT_TOTALLY_FINE"]).reason_code === "UNKNOWN_RESULT_CODE"
    && parseCgEventInstrumentation(["CGEVENT scroll events=nope event1=CGEVENT_POST_INVOKED"]).reason_code === "INSTRUMENTATION_UNPARSEABLE");
  const partial = parseCgEventInstrumentation(["CGEVENT drag events=2 event1=CGEVENT_POST_INVOKED event2=CGEVENT_CONSTRUCTION_FAILED"]);
  check("18. a partial multi-event result does not collapse into success",
    partial.construction === "FAILED" && partial.post_invocation === "NOT_REACHED"
    && partial.event_results.length === 2 && partial.event_results[0]!.result === "CGEVENT_POST_INVOKED",
    "one event posted, one failed to construct — the operation is not POST_INVOKED");
  check("18b. a missing per-event report is a count mismatch, not a pass",
    parseCgEventInstrumentation(["CGEVENT drag events=2 event1=CGEVENT_POST_INVOKED"]).reason_code === "EVENT_COUNT_MISMATCH");

  // ===== 19-20. persistence and readback =====
  const row = evidence([...ADMISSION, OK_LINE, "CGEVENT scroll events=1 event1=CGEVENT_POST_INVOKED"]);
  const round = JSON.parse(JSON.stringify(row)) as ExecutionEvidence;
  check("19/20. instrumentation persists on the evidence row and reads back exactly",
    JSON.stringify(round.cgevent_instrumentation) === JSON.stringify(posted)
    && round.cgevent_instrumentation!.construction === "REACHED"
    && round.outcome!.dispatch_evidence.evidence.includes(OK_LINE));

  // ===== 21-27. what instrumentation may not produce =====
  check("21/22/23/24. no cause, component, repair or retry anywhere",
    !/root_cause|defective|component|repair|retry|broken/i.test(JSON.stringify([posted, failedBuild]) + code));
  check("25. no diagnostic procedure is invoked by the parser",
    !/runWheelReceiptProcedure|runRoutingContextProcedure|selectProcedures/.test(code));
  check("26/27. no window-server verdict and no target-receipt verdict",
    reachOf(row, "WINDOW_SERVER_ROUTING") === "UNKNOWN" && reachOf(row, "TARGET_RECEIPT") === "UNKNOWN",
    "post invocation is where the API stops, so the chain stops there too");
  check("26b. a constructed-and-posted row DOES reach both CGEvent boundaries",
    reachOf(row, "CGEVENT_CONSTRUCTION") === "REACHED" && reachOf(row, "CGEVENT_POST_INVOCATION") === "REACHED");
  check("26c. a construction failure reads as NOT_OBSERVED at both, never UNKNOWN",
    reachOf(evidence([...ADMISSION, OK_LINE, "CGEVENT scroll events=1 event1=CGEVENT_CONSTRUCTION_FAILED"]), "CGEVENT_CONSTRUCTION") === "NOT_OBSERVED");

  // ===== the defect the first real run exposed =====
  // os-ui records the helper's entire trimmed stdout as ONE array element, so
  // the instrumentation arrives with an embedded newline rather than as its own
  // element. Searching elements alone found nothing and reported
  // INSTRUMENTATION_ABSENT while the line was sitting right there.
  const packed = parseCgEventInstrumentation([...ADMISSION, `${OK_LINE}\nCGEVENT scroll events=1 event1=CGEVENT_POST_INVOKED`]);
  check("R1. instrumentation packed into one multi-line evidence element is still found",
    packed.construction === "REACHED" && packed.post_invocation === "REACHED"
    && JSON.stringify(packed) === JSON.stringify(posted),
    "the adapter joins stdout lines; the parser splits them back");
  check("R2. a packed element carrying only OK is still ABSENT, not invented",
    parseCgEventInstrumentation([...ADMISSION, `${OK_LINE}\nsomething else`]).reason_code === "INSTRUMENTATION_ABSENT");

  // ===== 28-29. determinism and purity =====
  const repeats = new Set(Array.from({ length: 100 }, () => JSON.stringify(parseCgEventInstrumentation([...ADMISSION, OK_LINE, "CGEVENT scroll events=1 event1=CGEVENT_POST_INVOKED"]))));
  check("28. aggregation is deterministic", repeats.size === 1);
  check("29. no model, network, clock or subprocess in the parser",
    // RegExp.prototype.exec is a pure string operation; what must be absent is
    // process spawning, network access and any clock.
    !/\b(fetch|anthropic|openai|claude|child_process|spawnSync|spawn\(|execSync|execFileSync|https?:|Math\.random|Date\.now|new Date)/i.test(code)
    && !/\bimport\s*\(|require\s*\(/.test(code),
    "pure string parsing over already-persisted data");

  // ===== 30-40. earlier steps =====
  check("30-40. the delivery chain gained two boundaries and lost none of its shape",
    SCROLL_DELIVERY_CHAIN.length === 8
    && SCROLL_DELIVERY_CHAIN.every((x, i) => x.upstream_boundary === (SCROLL_DELIVERY_CHAIN[i - 1]?.boundary_id ?? null)),
    SCROLL_DELIVERY_CHAIN.map((x) => x.boundary_id).join(" → "));

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
