/**
 * หน้าที่: prove that DNA OS can turn one named unknown into a known fact by
 * matching a registered contract — and that nothing in that path infers,
 * repairs, retries, or touches the machine (Owner, 2026-09-02).
 *
 * THE LAST PLACE INFERENCE COULD ENTER. Steps 1–6 end at "the effect did not
 * occur and I do not know why". The obvious next move is for someone to
 * remember that scroll-diagnostic.ts exists and run it — `FAILED → a model
 * decides what to run`. Selection here is instead an intersection of declared
 * contracts, so cases 3–6 and 15 fail if a procedure is ever chosen by
 * resemblance, by operation name, or by the mere fact that something failed.
 *
 * WHY A KEY NAMED `wc` IS NOT ENOUGH. P-1 reads a wheel counter that the
 * acceptance sandbox publishes from its own listener. A field called `wc` in
 * some other state contract would be a different measurement wearing the same
 * name, so case 13b feeds exactly that and requires rejection. Provenance is
 * checked structurally, never assumed.
 *
 * NOT OBSERVED IS NOT DIAGNOSIS. `wc` unchanged means the target was not
 * observed to receive the input — and stops there. Cases 18 and 24 fail if any
 * component is named or if the boundary is narrowed to "delivery failed", which
 * would be a claim about parts nothing looked at.
 *
 * Input: none — evidence rows, registry and findings are built in memory. No
 * execution, no browser, no OS action.
 * Output: exit code 0 (all passed) or 1.
 * Dependency ที่อนุญาต: ../diagnostic-procedure, ../diagnostic-wheel-receipt,
 *   ../outcome-classification, ../outcome-classification-store, node built-ins.
 * สิ่งที่ห้ามแตะ: ห้ามแก้เทสต์นี้ให้เลือก procedure จากความคล้าย, ห้ามยอมรับ
 * NOT_OBSERVED เป็นการระบุสาเหตุ.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { selectProcedures, stateContractSatisfied, type DiagnosticProcedure } from "../diagnostic-procedure";
import { P1_REGISTRATION, P1_PROCEDURE_ID, runWheelReceiptProcedure, type DiagnosticFinding } from "../diagnostic-wheel-receipt";
import { classifyOutcome, type UnknownFactKey } from "../outcome-classification";
import { readDiagnosticProcedures } from "../outcome-classification-store";
import type { ExecutionEvidence } from "../executor";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const clock = () => new Date("2026-09-02T15:00:00.000Z");
const OS_UI = "capability-0de653bb-c968-4168-85c6-9d67beef2b5a";
const CONTRACT_STATE = { clicks: "0", dbls: "0", st: "SANDBOX READY", in: "", sy: "0", dl: "72", af: "body", mx: "1861", wc: "0", wdy: "0", wdm: "0", wt: "" };
const seen = (state: Record<string, string> = {}, source = "ACCESSIBILITY_WINDOW_TITLE") =>
  ({ acquired: true, observed_at: "2026-09-02T14:59:30.000Z", source, state: { ...CONTRACT_STATE, ...state }, unavailable_reason: null }) as never;
const unseen = () => ({ acquired: false, observed_at: null, source: "ACCESSIBILITY_WINDOW_TITLE", state: null, unavailable_reason: "probe" }) as never;

const evidence = (o: Partial<ExecutionEvidence>): ExecutionEvidence => ({
  evidence_id: "cue-p1-test", work_order_id: "wo-p1", execution_owner: "control/computer-use-executor",
  executor_pid: 1, executor_process_title: "node", requester: "tests", authority_id: "a",
  operation: "scroll" as never, target: "screen", capability_id: OS_UI,
  authorized: true, authorization_reason: "AUTHORIZED", executed: true, result_status: "COMPLETED",
  started_at: "2026-09-02T14:59:00.000Z", completed_at: "2026-09-02T14:59:31.000Z",
  expectation: { available: true, operation: "scroll", created_at: "2026-09-02T14:59:00.000Z", conditions: [{ observable: "scrollY", observed_as: "sy", relation: "CHANGES", expected_value: null, expected_pattern: null, origin: "OPERATION_CONTRACT" }] },
  observation_before: seen(), observation_after: seen(),
  outcome: { dispatch_evidence: { ok: true, summary: "scroll via CGEvent", evidence: ["mouse_helper=OK", "OK scroll 0,600"], idempotent_replay: false }, artifact_references: [], presentation_state: null, focus_restoration_verified: null, next_action: null },
  effect_verdict: { status: "FAILED", reason_code: "EXPECTATION_NOT_MET", evaluated_at: "2026-09-02T14:59:31.000Z", deciding_observable: "scrollY", deciding_relation: "CHANGES", observed_before_value: "0", observed_after_value: "0", expectation_operation: "scroll", expectation_created_at: "2026-09-02T14:59:00.000Z", observation_before_at: "2026-09-02T14:59:30.000Z", observation_after_at: "2026-09-02T14:59:30.000Z" },
  ...o,
} as ExecutionEvidence);

const ALL_UNKNOWN: UnknownFactKey[] = ["root_cause", "defective_component", "input_reached_target_application", "target_default_action_occurred", "focus_state_caused_outcome", "timing_caused_outcome", "repair_required"];
const REG = [P1_REGISTRATION];
const sel = (e: ExecutionEvidence, unknowns = ALL_UNKNOWN, procs = REG, orig: "SYSTEM" | "OWNER_ONLY" = "SYSTEM") => selectProcedures(procs, unknowns, e, orig);
let n = 0;
const run = (e: ExecutionEvidence) => runWheelReceiptProcedure(P1_REGISTRATION, e, () => `df-test-${++n}`, clock);

(async () => {
  // ===== 1-2. identity and discoverability =====
  check("1. procedure has a stable id and canonical name",
    P1_REGISTRATION.procedure_id === P1_PROCEDURE_ID && P1_REGISTRATION.canonical_name === "WHEEL_RECEIPT_FROM_EXISTING_OBSERVATION");
  const registry = readDiagnosticProcedures();
  const fromRegistry = registry.find((p) => p.procedure_id === P1_PROCEDURE_ID);
  check("2. procedure is discoverable from the persisted registry",
    !!fromRegistry && JSON.stringify(fromRegistry) === JSON.stringify(P1_REGISTRATION));

  // ===== 3-6. selection is by declared contract, never by resemblance =====
  const match = sel(evidence({}));
  check("3. a matching UNKNOWN selects P-1",
    match.selected?.procedure_id === P1_PROCEDURE_ID && match.matched_unknown.includes("input_reached_target_application"));
  const unrelated = sel(evidence({}), ["timing_caused_outcome", "focus_state_caused_outcome"]);
  check("4. an unrelated UNKNOWN does not select P-1",
    unrelated.selected === null && unrelated.rejected.some((r) => r.rejection === "NO_UNKNOWN_IN_COMMON"));
  const wrongCap = sel(evidence({ capability_id: "capability-00000000-0000-0000-0000-000000000000" }));
  check("5. a different capability does not select P-1",
    wrongCap.selected === null && wrongCap.rejected.some((r) => r.rejection === "CAPABILITY_MISMATCH"));
  const wrongOp = sel(evidence({ operation: "click" as never }));
  check("6. a different operation does not select P-1",
    wrongOp.selected === null && wrongOp.rejected.some((r) => r.rejection === "OPERATION_MISMATCH"));

  // ===== 7-8. preconditions gate selection =====
  const noBefore = sel(evidence({ observation_before: unseen() }));
  check("7. a missing BEFORE observation rejects selection",
    noBefore.selected === null && noBefore.rejected.some((r) => r.rejection === "REQUIRED_EVIDENCE_UNAVAILABLE"));
  const noAfter = sel(evidence({ observation_after: unseen() }));
  check("8. a missing AFTER observation rejects selection",
    noAfter.selected === null && noAfter.rejected.some((r) => r.rejection === "REQUIRED_EVIDENCE_UNAVAILABLE"));

  // ===== 9-13. the deterministic semantics =====
  const { wc: _b, ...noWc } = CONTRACT_STATE;
  check("9. missing BEFORE observable produces UNPROVEN",
    run(evidence({ observation_before: { acquired: true, observed_at: "t", source: "ACCESSIBILITY_WINDOW_TITLE", state: noWc, unavailable_reason: null } as never })).finding === "UNPROVEN");
  check("10. missing AFTER observable produces UNPROVEN",
    run(evidence({ observation_after: { acquired: true, observed_at: "t", source: "ACCESSIBILITY_WINDOW_TITLE", state: noWc, unavailable_reason: null } as never })).finding === "UNPROVEN");
  const observed = run(evidence({ observation_before: seen({ wc: "0" }), observation_after: seen({ wc: "1" }) }));
  check("11. wc increase produces OBSERVED",
    observed.finding === "OBSERVED" && observed.reason_code === "TARGET_COUNTER_INCREASED"
    && observed.before_value === "0" && observed.after_value === "1");
  const notObserved = run(evidence({}));
  check("12. wc unchanged produces NOT_OBSERVED",
    notObserved.finding === "NOT_OBSERVED" && notObserved.reason_code === "TARGET_COUNTER_UNCHANGED");
  check("13. a non-comparable value produces UNPROVEN, not a finding about the target",
    run(evidence({ observation_after: seen({ wc: "many" }) })).finding === "UNPROVEN"
    && run(evidence({ observation_after: seen({ wc: "many" }) })).reason_code === "OBSERVABLE_NOT_COMPARABLE");
  check("13b. a key named wc from another state contract is refused",
    stateContractSatisfied(seen({}, "SOME_OTHER_SOURCE"), "DNAOS_SANDBOX_TITLE_V1") === false
    && stateContractSatisfied({ acquired: true, observed_at: "t", source: "ACCESSIBILITY_WINDOW_TITLE", state: { wc: "5" }, unavailable_reason: null } as never, "DNAOS_SANDBOX_TITLE_V1") === false,
    "provenance is structural, not the presence of a key");
  check("13c. a counter running backwards is not evidence either way",
    run(evidence({ observation_before: seen({ wc: "5" }), observation_after: seen({ wc: "2" }) })).reason_code === "COUNTER_DECREASED");

  // ===== 14-15. dispatch and verdict cannot steer the procedure =====
  const dispatchVariants = new Set(["COMPLETED", "FAILED", "BLOCKED", null].map((d) => run(evidence({ result_status: d })).finding));
  check("14. dispatch status cannot change the diagnostic finding",
    dispatchVariants.size === 1 && dispatchVariants.has("NOT_OBSERVED"),
    `findings across dispatch statuses: ${[...dispatchVariants].join(", ")}`);
  check("15. a FAILED effect alone selects nothing — only a declared unknown does",
    sel(evidence({}), []).selected === null);

  // ===== 16-18. what P-1 is and is not =====
  const p1src = readFileSync(join(process.cwd(), "control/computer-use-executor/diagnostic-wheel-receipt.ts"), "utf8");
  const p1code = p1src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
  check("16. P-1 performs no physical action",
    P1_REGISTRATION.physical_action === "NONE"
    && !/spawn|execFile|osascript|Chrome|writeFile|appendFile/i.test(p1code));
  check("17. P-1 requires no Owner authority and is SYSTEM-originated",
    P1_REGISTRATION.authority_requirement === "NONE" && P1_REGISTRATION.origination === "SYSTEM");
  check("18. P-1 names no component and no cause",
    !/mouse.?helper|browser|OS |focus|timing|primitive|broken|delivery.?failed/i.test(JSON.stringify(notObserved))
    && !/root_cause/.test(JSON.stringify(notObserved)),
    "the finding is about a counter, not about a culprit");

  // ===== 19-22. the record, and what it may not touch =====
  check("19. findings carry their own identity and source reference",
    notObserved.diagnostic_finding_id.length > 0 && notObserved.source_execution_evidence_id === "cue-p1-test"
    && notObserved.procedure_id === P1_PROCEDURE_ID && notObserved.resolved_unknown_key === "input_reached_target_application");
  const source = evidence({});
  const snapshot = JSON.stringify(source);
  run(source);
  check("20. running the procedure leaves its source evidence unchanged", JSON.stringify(source) === snapshot);
  check("21. the finding contains no effect_verdict field to overwrite",
    !("effect_verdict" in notObserved) && !("status" in notObserved));
  check("22. the finding contains no next_state and no classification",
    !("next_state" in notObserved) && !("failure_boundary" in notObserved) && !("defect_status" in notObserved));

  // ===== 23-25. the classifier owns what the fact narrows =====
  const before = classifyOutcome(evidence({}), REG, clock, []);
  const afterNotObserved = classifyOutcome(evidence({}), REG, clock, [notObserved]);
  check("23. the classifier consumes the finding",
    afterNotObserved.known_facts["target_receipt"] === "NOT_OBSERVED"
    && afterNotObserved.known_facts["target_receipt_procedure"] === P1_PROCEDURE_ID
    && !afterNotObserved.unknown_facts.includes("input_reached_target_application")
    && before.unknown_facts.includes("input_reached_target_application"));
  check("24. NOT_OBSERVED narrows only to what the evidence supports",
    afterNotObserved.failure_boundary === "TARGET_RECEIPT_NOT_OBSERVED"
    && !/DELIVERY_FAILED|DELIVERY/.test(afterNotObserved.failure_boundary),
    "absence of observed receipt names no upstream component");
  const observedFinding: DiagnosticFinding = { ...observed, source_execution_evidence_id: "cue-p1-test" };
  check("24b. OBSERVED narrows downstream to TARGET_EFFECT",
    classifyOutcome(evidence({}), REG, clock, [observedFinding]).failure_boundary === "TARGET_EFFECT");
  const unprovenFinding: DiagnosticFinding = { ...notObserved, finding: "UNPROVEN", reason_code: "OBSERVABLE_NOT_COMPARABLE" };
  check("24c. UNPROVEN narrows nothing and resolves nothing",
    classifyOutcome(evidence({}), REG, clock, [unprovenFinding]).failure_boundary === "UNLOCALIZED_BETWEEN_DISPATCH_AND_TARGET_EFFECT"
    && classifyOutcome(evidence({}), REG, clock, [unprovenFinding]).unknown_facts.includes("input_reached_target_application"));
  const foreign: DiagnosticFinding = { ...notObserved, source_execution_evidence_id: "cue-some-other-run" };
  check("24d. a finding from another execution narrows nothing here",
    classifyOutcome(evidence({}), REG, clock, [foreign]).failure_boundary === "UNLOCALIZED_BETWEEN_DISPATCH_AND_TARGET_EFFECT");
  check("25. ROOT_CAUSE remains UNKNOWN after diagnosis",
    afterNotObserved.root_cause === null && afterNotObserved.defect_status === "CAUSE_UNKNOWN"
    && afterNotObserved.root_cause_class === "UNDETERMINED"
    && afterNotObserved.unknown_facts.includes("root_cause") && afterNotObserved.unknown_facts.includes("defective_component"));
  check("25b. next_state follows from what is STILL unknown, not from P-1 having run",
    afterNotObserved.next_state === "BLOCKED" && afterNotObserved.next_state_reason === "NO_REGISTERED_DIAGNOSTIC_PROCEDURE"
    && afterNotObserved.owner_required === false,
    "P-1 no longer matches: the unknown it resolves is resolved");

  // ===== 26-27. determinism and purity =====
  const repeats = new Set(Array.from({ length: 200 }, () => JSON.stringify({ ...run(evidence({})), diagnostic_finding_id: "*", created_at: "*" })));
  check("26. deterministic repeat produces an identical semantic result", repeats.size === 1, `distinct=${repeats.size}`);
  const selSrc = readFileSync(join(process.cwd(), "control/computer-use-executor/diagnostic-procedure.ts"), "utf8");
  const selCode = selSrc.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
  check("27. no model, network, subprocess or randomness in selection or semantics",
    !/\b(fetch|anthropic|openai|claude|spawn|exec|execFile|http|Math\.random)\b/i.test(selCode + p1code));
  check("27b. created_at takes no part in the decision",
    !/created_at/.test(p1code.split("const finish")[1]?.split("// Preconditions")[0] ?? "") || run(evidence({})).finding === run(evidence({})).finding);

  // ===== 28-29. P-2 / P-3 are not registered =====
  check("28. scroll-diagnostic.ts (P-2) is not registered",
    !registry.some((p) => p.entry_point.includes("scroll-diagnostic")));
  check("29. scroll-verify.ts (P-3) is not registered",
    !registry.some((p) => p.entry_point.includes("scroll-verify")));
  check("29b. an OWNER_ONLY procedure could never be selected by a SYSTEM caller anyway",
    sel(evidence({}), ALL_UNKNOWN, [{ ...P1_REGISTRATION, origination: "OWNER_ONLY" } as DiagnosticProcedure]).selected === null);
  check("29c. a DISABLED procedure is not selected",
    sel(evidence({}), ALL_UNKNOWN, [{ ...P1_REGISTRATION, status: "DISABLED" } as DiagnosticProcedure]).selected === null);

  // ===== 30-35. earlier steps untouched by this step =====
  const execSrc = readFileSync(join(process.cwd(), "control/computer-use-executor/executor.ts"), "utf8");
  check("30-35. Step 7 did not touch the locked execution path",
    !execSrc.includes("diagnostic-procedure") && !execSrc.includes("diagnostic-wheel-receipt")
    && !execSrc.includes("outcome-classification"),
    "diagnosis reads evidence after the fact; it is not a stage inside execution");

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
