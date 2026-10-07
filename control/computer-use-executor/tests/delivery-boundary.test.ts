/**
 * หน้าที่: prove that DNA OS can name the boundaries a scroll really crosses,
 * say which of them it can watch, and derive from evidence how far the action
 * is known to have got — without any unwatched boundary becoming a failed one
 * (Owner, 2026-09-02).
 *
 * THE JUMP THIS BLOCKS. From "the target was not observed to receive the input"
 * it is one short, wrong step to "delivery failed", and one more to "the mouse
 * helper is broken". Cases 4, 5 and 12 fail if any boundary nobody measured is
 * reported as anything but UNKNOWN, and case 12 fails if a component is named.
 *
 * THE MEASUREMENT THAT LOOKS REAL AND IS NOT. `OK scroll 0,600` reads like
 * proof that a CGEvent reached the OS. In mouse-helper.swift the poster is
 * `e?.post(tap:)` returning Void and the OK line prints unconditionally after
 * it, so the string proves the helper reached that print and nothing further.
 * Case 3 requires CGEVENT_POST to stay UNKNOWN even with that line present —
 * the single most tempting false positive in this chain.
 *
 * CONTIGUITY MATTERS. "Last proven reached" walks forward only while each
 * boundary is confirmed; a confirmed boundary on the far side of an unknown gap
 * does not prove the gap was crossed. Case 1b holds that.
 *
 * Input: none — evidence rows and findings are built in memory. No execution,
 * no browser, no OS action.
 * Output: exit code 0 (all passed) or 1.
 * Dependency ที่อนุญาต: ../delivery-boundary, ../diagnostic-*, ../outcome-classification, node built-ins.
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่ม boundary ที่ไม่มี producer จริง, ห้ามยอมรับ
 * UNOBSERVABLE ว่าเป็น FAILED.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SCROLL_DELIVERY_CHAIN, buildDeliveryKnowledgeMap, chainFor, type DeliveryBoundaryId } from "../delivery-boundary";
import { P1_REGISTRATION, runWheelReceiptProcedure, type DiagnosticFinding } from "../diagnostic-wheel-receipt";
import { selectProcedures } from "../diagnostic-procedure";
import { classifyOutcome } from "../outcome-classification";
import { readDiagnosticProcedures } from "../outcome-classification-store";
import type { ExecutionEvidence } from "../executor";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const OS_UI = "capability-0de653bb-c968-4168-85c6-9d67beef2b5a";
const CONTRACT_STATE = { clicks: "0", dbls: "0", st: "SANDBOX READY", in: "", sy: "0", dl: "72", af: "body", mx: "1861", wc: "0", wdy: "0", wdm: "0", wt: "" };
const seen = (state: Record<string, string> = {}) =>
  ({ acquired: true, observed_at: "2026-09-02T14:59:30.000Z", source: "ACCESSIBILITY_WINDOW_TITLE", state: { ...CONTRACT_STATE, ...state }, unavailable_reason: null }) as never;

const evidence = (o: Partial<ExecutionEvidence>): ExecutionEvidence => ({
  evidence_id: "cue-db-test", work_order_id: "wo-db", execution_owner: "control/computer-use-executor",
  executor_pid: 1, executor_process_title: "node", requester: "tests", authority_id: "a",
  operation: "scroll" as never, target: "screen", capability_id: OS_UI,
  authorized: true, authorization_reason: "AUTHORIZED", executed: true, result_status: "COMPLETED",
  started_at: "2026-09-02T14:59:00.000Z", completed_at: "2026-09-02T14:59:31.000Z",
  expectation: { available: true, operation: "scroll", created_at: "2026-09-02T14:59:00.000Z", conditions: [{ observable: "scrollY", observed_as: "sy", relation: "CHANGES", expected_value: null, expected_pattern: null, origin: "OPERATION_CONTRACT" }] },
  observation_before: seen(), observation_after: seen(),
  outcome: { dispatch_evidence: { ok: true, summary: "scroll via CGEvent", evidence: ["ui_action=scroll", "scope=screen", "risk=LOW", "reasons=none", "mouse_helper=OK", "OK scroll 0,600"], idempotent_replay: false }, artifact_references: [], presentation_state: null, focus_restoration_verified: null, next_action: null },
  effect_verdict: { status: "FAILED", reason_code: "EXPECTATION_NOT_MET", evaluated_at: "2026-09-02T14:59:31.000Z", deciding_observable: "scrollY", deciding_relation: "CHANGES", observed_before_value: "0", observed_after_value: "0", expectation_operation: "scroll", expectation_created_at: "2026-09-02T14:59:00.000Z", observation_before_at: "2026-09-02T14:59:30.000Z", observation_after_at: "2026-09-02T14:59:30.000Z" },
  ...o,
} as ExecutionEvidence);

let n = 0;
const finding = (e: ExecutionEvidence) => runWheelReceiptProcedure(P1_REGISTRATION, e, () => `df-db-${++n}`, () => new Date("2026-09-02T16:00:00.000Z"));
const reachOf = (map: ReturnType<typeof buildDeliveryKnowledgeMap>, id: DeliveryBoundaryId) => map!.boundaries.find((b) => b.boundary_id === id)!;

(async () => {
  const base = evidence({});
  const f = finding(base);
  const map = buildDeliveryKnowledgeMap(base, [f]);

  // ===== 1-2. the chain itself =====
  const ids = SCROLL_DELIVERY_CHAIN.map((b) => b.boundary_id);
  check("1. boundary ordering is deterministic and internally linked",
    JSON.stringify(ids) === JSON.stringify(["EXECUTOR_DISPATCH", "ADAPTER_ADMISSION", "HELPER_PROCESS_INVOCATION", "CGEVENT_CONSTRUCTION", "CGEVENT_POST_INVOCATION", "WINDOW_SERVER_ROUTING", "TARGET_RECEIPT", "TARGET_DEFAULT_ACTION"])
    && SCROLL_DELIVERY_CHAIN.every((b, i) => b.upstream_boundary === (ids[i - 1] ?? null) && b.downstream_boundary === (ids[i + 1] ?? null))
    && JSON.stringify(buildDeliveryKnowledgeMap(base, [f])) === JSON.stringify(map));
  check("1b. last_proven_reached is contiguous, not the furthest lucky hit",
    map!.last_proven_reached === "HELPER_PROCESS_INVOCATION",
    "TARGET_DEFAULT_ACTION is measured but sits beyond an unknown gap, so it proves nothing about the gap");
  check("2. every boundary names a real producer in this path",
    SCROLL_DELIVERY_CHAIN.every((b) => b.producer.length > 0)
    && SCROLL_DELIVERY_CHAIN.every((b) => /executor\.ts|adapter-contract\.ts|mouse-helper|window server|acceptance-sandbox|browser default/.test(b.producer)),
    SCROLL_DELIVERY_CHAIN.map((b) => b.boundary_id).join(" → "));

  // ===== 3-5. the distinctions that carry the whole step =====
  check("3. dispatch COMPLETED proves only the dispatch-side boundaries",
    reachOf(map, "EXECUTOR_DISPATCH").reach === "REACHED"
    && reachOf(map, "ADAPTER_ADMISSION").reach === "REACHED"
    && reachOf(map, "HELPER_PROCESS_INVOCATION").reach === "REACHED"
    && reachOf(map, "CGEVENT_CONSTRUCTION").reach === "UNKNOWN"
    && reachOf(map, "CGEVENT_POST_INVOCATION").reach === "UNKNOWN",
    "this row predates the instrumentation; \"OK scroll 0,600\" is not CGEvent evidence");
  check("4. TARGET_RECEIPT NOT_OBSERVED does not make any upstream boundary a failure",
    reachOf(map, "TARGET_RECEIPT").reach === "NOT_OBSERVED"
    && reachOf(map, "CGEVENT_CONSTRUCTION").reach === "UNKNOWN"
    && reachOf(map, "CGEVENT_POST_INVOCATION").reach === "UNKNOWN"
    && reachOf(map, "WINDOW_SERVER_ROUTING").reach === "UNKNOWN"
    && map!.first_not_observed === "TARGET_RECEIPT");
  check("5. UNKNOWN stays distinct from NOT_OBSERVED",
    map!.first_unknown === "CGEVENT_CONSTRUCTION" && map!.first_not_observed === "TARGET_RECEIPT"
    && (map!.first_unknown as string) !== (map!.first_not_observed as string));

  // ===== 6-7. observability is a property of measurement, not of outcome =====
  check("6. every OBSERVABLE boundary declares an evidence source and keys",
    SCROLL_DELIVERY_CHAIN.filter((b) => b.status === "OBSERVABLE")
      .every((b) => b.observable_keys.length > 0 && b.evidence_sources.length > 0 && !b.evidence_sources.includes("NONE")));
  check("7. a non-observable boundary can never produce a reach finding",
    SCROLL_DELIVERY_CHAIN.filter((b) => b.status !== "OBSERVABLE")
      .every((b) => reachOf(map, b.boundary_id).reach === "UNKNOWN")
    && SCROLL_DELIVERY_CHAIN.filter((b) => b.status !== "OBSERVABLE").every((b) => b.unobservable_reason !== null));
  // Step 12 made both CGEvent halves observable for NEW executions; the window
  // server has no producer at all and keeps its own distinct reason.
  check("7b. the CGEvent halves are now observable; the window server still is not",
    SCROLL_DELIVERY_CHAIN.find((b) => b.boundary_id === "CGEVENT_CONSTRUCTION")!.status === "OBSERVABLE"
    && SCROLL_DELIVERY_CHAIN.find((b) => b.boundary_id === "CGEVENT_POST_INVOCATION")!.status === "OBSERVABLE"
    && SCROLL_DELIVERY_CHAIN.find((b) => b.boundary_id === "WINDOW_SERVER_ROUTING")!.unobservable_reason === "NO_CAPTURE_ON_THIS_PATH");

  // ===== 8-9. the chain is not borrowed =====
  check("8. another capability cannot use the scroll boundary chain",
    chainFor("capability-00000000-0000-0000-0000-000000000000", "scroll") === null
    && buildDeliveryKnowledgeMap(evidence({ capability_id: "capability-00000000-0000-0000-0000-000000000000" })) === null);
  check("9. another operation cannot use the scroll boundary chain",
    chainFor(OS_UI, "click") === null && buildDeliveryKnowledgeMap(evidence({ operation: "click" as never })) === null);

  // ===== 10. existing evidence first =====
  check("10. the whole map is derived from already-persisted evidence",
    map!.boundaries.length === 8 && SCROLL_DELIVERY_CHAIN.every((b) => b.authority_requirement === "NONE"),
    "no new action, no lease, no Owner needed to produce this map");

  // ===== 11-15. what a candidate procedure may and may not do =====
  const registry = readDiagnosticProcedures();
  const sel = selectProcedures(registry, ["input_reached_target_application"], base, "SYSTEM");
  check("11. a procedure is selected only by a declared UNKNOWN it resolves",
    sel.selected?.procedure_id === P1_REGISTRATION.procedure_id
    && selectProcedures(registry, ["timing_caused_outcome"], base, "SYSTEM").selected === null);
  const revised = classifyOutcome(base, registry, () => new Date("2026-09-02T16:00:00.000Z"), [f]);
  check("12. no candidate or finding infers a root cause or names a component",
    revised.root_cause === null && f.finding === "NOT_OBSERVED"
    && !/mouse.?helper|window server|CGEvent|browser|broken|defective|delivery.?failed/i.test(JSON.stringify([f, revised.failure_boundary]))
    // The unknown list still NAMES the open question, which is the opposite of answering it.
    && revised.unknown_facts.includes("defective_component"),
    "the map localizes; it does not blame");
  check("13. nothing in this path can choose a repair",
    revised.next_state !== "REPAIR_ALLOWED" && revised.unknown_facts.includes("repair_required"));
  check("14. nothing in this path can choose a retry", revised.next_state !== "RETRY_ALLOWED");
  check("15. an unknown cause alone does not require the Owner",
    revised.owner_required === false && revised.next_state === "BLOCKED");
  check("16. an OWNER_ONLY candidate cannot execute as SYSTEM",
    selectProcedures([{ ...P1_REGISTRATION, origination: "OWNER_ONLY" }], ["input_reached_target_application"], base, "SYSTEM").selected === null);

  // ===== 17-18. model-terminated diagnostics are not registerable =====
  check("17. neither model-terminated tool is in the registry",
    !registry.some((p) => /scroll-diagnostic|scroll-verify/.test(p.entry_point)));
  const p2 = readFileSync(join(process.cwd(), "control/computer-use-executor/tools/scroll-diagnostic.ts"), "utf8");
  check("17b. P-2 still terminates in a model reading its output",
    /ให้ Claude อ่านไฟล์นี้/.test(p2),
    "its conclusion is produced by a reader, not by a deterministic rule");
  check("18. every registered procedure declares a deterministic output contract",
    registry.every((p) => p.output_contract.includes("DIAGNOSTIC_FINDING") && p.physical_action === "NONE"));

  // ===== 19. no model =====
  const src = readFileSync(join(process.cwd(), "control/computer-use-executor/delivery-boundary.ts"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n")
    // Strip string literals: a `producer` field naming another module's execFile
    // is documentation of that module, not a call from this one.
    .replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/`(?:[^`\\]|\\.)*`/g, "``");
  check("19. no model, network, subprocess or randomness in the boundary model",
    !/\b(fetch|anthropic|openai|claude|spawn|exec|execFile|http|Math\.random|readFileSync)\b/i.test(code)
    && !/\bimport\s*\(/.test(code));

  // ===== 20-26. earlier steps untouched =====
  const execSrc = readFileSync(join(process.cwd(), "control/computer-use-executor/executor.ts"), "utf8");
  check("20-26. Step 8 did not touch the locked execution path",
    !execSrc.includes("delivery-boundary") && !execSrc.includes("diagnostic-"),
    "the boundary model reads evidence after the fact");

  // ===== variants: the map follows evidence, not hope =====
  const helperFailed = buildDeliveryKnowledgeMap(evidence({
    result_status: "FAILED",
    outcome: { dispatch_evidence: { ok: false, summary: "scroll failed", evidence: ["ui_action=scroll", "scope=screen", "risk=LOW", "mouse_helper=FAILED"], idempotent_replay: false }, artifact_references: [], presentation_state: null, focus_restoration_verified: null, next_action: null },
  } as Partial<ExecutionEvidence>), []);
  check("A. a failed helper invocation is NOT_OBSERVED at its own boundary and stops the chain there",
    reachOf(helperFailed, "HELPER_PROCESS_INVOCATION").reach === "NOT_OBSERVED"
    && helperFailed!.last_proven_reached === "ADAPTER_ADMISSION"
    && helperFailed!.first_not_observed === "HELPER_PROCESS_INVOCATION");
  const received = evidence({ observation_after: seen({ wc: "1" }) });
  const receivedMap = buildDeliveryKnowledgeMap(received, [finding(received)]);
  check("B. an observed receipt marks TARGET_RECEIPT reached without back-filling the gap",
    reachOf(receivedMap, "TARGET_RECEIPT").reach === "REACHED"
    && reachOf(receivedMap, "CGEVENT_CONSTRUCTION").reach === "UNKNOWN"
    && receivedMap!.last_proven_reached === "HELPER_PROCESS_INVOCATION");
  check("C. with no diagnostic finding, TARGET_RECEIPT is UNKNOWN rather than assumed",
    reachOf(buildDeliveryKnowledgeMap(base, []), "TARGET_RECEIPT").reach === "UNKNOWN");
  const foreign: DiagnosticFinding = { ...f, source_execution_evidence_id: "cue-other-run" };
  check("D. a finding from another execution does not fill this map",
    reachOf(buildDeliveryKnowledgeMap(base, [foreign]), "TARGET_RECEIPT").reach === "UNKNOWN");

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
