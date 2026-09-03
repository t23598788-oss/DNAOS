/**
 * หน้าที่: prove that DNA OS can state what it knows and what it does not know
 * about one execution, and pick a next state by rule — without ever converting
 * "I do not know why" into a diagnosis (Owner, 2026-09-02).
 *
 * THE FAILURE MODE THIS EXISTS TO BLOCK. A FAILED effect is enormously
 * suggestive. From `COMPLETED` + `scrollY 0 → 0` a reader wants to conclude the
 * scroll primitive is broken, or the wheel never reached the page, or focus was
 * wrong. Each of those is a claim about a boundary nothing observed. Cases 2
 * and 3 fail if any cause is asserted; case 21 fails if a component is ever
 * named. The evidence supports exactly one sentence — the expected observable
 * effect did not occur — and the classifier must not produce a second.
 *
 * THE OTHER TWO TEMPTATIONS. Retrying is not diagnosis, so case 10 requires
 * that no bare FAILED can reach RETRY_ALLOWED. And the Owner is not a
 * diagnostic engine: case 11 requires that an unknown cause alone never
 * escalates, while case 12 requires escalation exactly where a real policy —
 * a lease flag only an Owner grant can set — says the Owner alone can lift it.
 *
 * Input: none — evidence rows and the procedure registry are constructed in
 * memory, so no execution and no OS action occur.
 * Output: exit code 0 (all passed) or 1.
 * Dependency ที่อนุญาต: ../outcome-classification, ../expectation, node built-ins.
 * สิ่งที่ห้ามแตะ: ห้ามแก้เทสต์นี้ให้ยอมรับสาเหตุที่เดาเอา, ห้าม seed
 * diagnostic procedure ลง registry จริงเพื่อให้ผ่าน.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyOutcome, type OutcomeClassification } from "../outcome-classification";
import type { DiagnosticProcedure } from "../diagnostic-procedure";
import { readDiagnosticProcedures } from "../outcome-classification-store";
import { buildExpectation } from "../expectation";
import type { ExecutionEvidence } from "../executor";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const clock = () => new Date("2026-09-02T14:00:00.000Z");
const SCROLL = buildExpectation({ operation: "scroll" }, () => new Date("2026-09-02T13:59:00.000Z"));

/** The full DNAOS_SANDBOX_TITLE_V1 key set — Step 7 rejects a lone key whose provenance is unverified. */
const CONTRACT_STATE = { clicks: "0", dbls: "0", st: "SANDBOX READY", in: "", sy: "0", dl: "72", af: "body", mx: "1861", wc: "0", wdy: "0", wdm: "0", wt: "" };
const seen = (state: Record<string, string>) => ({ acquired: true, observed_at: "2026-09-02T13:59:30.000Z", source: "ACCESSIBILITY_WINDOW_TITLE", state: { ...CONTRACT_STATE, ...state }, unavailable_reason: null }) as never;
const unseen = (reason: string) => ({ acquired: false, observed_at: null, source: "ACCESSIBILITY_WINDOW_TITLE", state: null, unavailable_reason: reason }) as never;

const evidence = (o: Partial<ExecutionEvidence>): ExecutionEvidence => ({
  evidence_id: "cue-test", work_order_id: "wo-test", execution_owner: "control/computer-use-executor",
  executor_pid: 1, executor_process_title: "node", requester: "tests", authority_id: "a",
  operation: "scroll" as never, target: "screen", capability_id: "capability-0de653bb-c968-4168-85c6-9d67beef2b5a",
  authorized: true, authorization_reason: "AUTHORIZED", executed: true, result_status: "COMPLETED",
  started_at: "2026-09-02T13:59:00.000Z", completed_at: "2026-09-02T13:59:31.000Z",
  expectation: SCROLL, observation_before: seen({ sy: "0" }), observation_after: seen({ sy: "0" }),
  outcome: { dispatch_evidence: { ok: true, summary: "scroll via CGEvent", evidence: ["mouse_helper=OK", "OK scroll 0,600"], idempotent_replay: false }, artifact_references: [], presentation_state: null, focus_restoration_verified: null, next_action: null },
  effect_verdict: { status: "FAILED", reason_code: "EXPECTATION_NOT_MET", evaluated_at: "2026-09-02T13:59:31.000Z", deciding_observable: "scrollY", deciding_relation: "CHANGES", observed_before_value: "0", observed_after_value: "0", expectation_operation: "scroll", expectation_created_at: "2026-09-02T13:59:00.000Z", observation_before_at: "2026-09-02T13:59:30.000Z", observation_after_at: "2026-09-02T13:59:30.000Z" },
  ...o,
} as ExecutionEvidence);

const verdictOf = (status: string, reason: string) => ({ status, reason_code: reason, evaluated_at: "2026-09-02T13:59:31.000Z", deciding_observable: null, deciding_relation: null, observed_before_value: null, observed_after_value: null, expectation_operation: "scroll", expectation_created_at: "2026-09-02T13:59:00.000Z", observation_before_at: null, observation_after_at: null }) as never;

const c = (e: ExecutionEvidence, p: readonly DiagnosticProcedure[] = []) => classifyOutcome(e, p, clock);

(async () => {
  // ================= 1. VERIFIED =================
  const verified = c(evidence({ effect_verdict: verdictOf("VERIFIED", "EXPECTATION_MET") }));
  check("1. VERIFIED effect produces no defect and no boundary",
    verified.defect_status === "NO_DEFECT_INDICATED" && verified.failure_boundary === "NONE"
    && verified.next_state === "EFFECT_COMPLETE" && verified.root_cause === null && verified.unknown_facts.length === 0);

  // ================= 2 & 3. FAILED does not produce a cause =================
  const failed = c(evidence({}));
  check("2. FAILED effect asserts no root cause",
    failed.root_cause === null && failed.defect_status === "CAUSE_UNKNOWN" && failed.root_cause_class === "UNDETERMINED",
    `defect_status=${failed.defect_status} root_cause_class=${failed.root_cause_class}`);
  check("3. FAILED + unknown cause keeps every unknown first-class",
    failed.unknown_facts.includes("root_cause") && failed.unknown_facts.includes("defective_component")
    && failed.unknown_facts.includes("input_reached_target_application")
    && failed.unknown_facts.includes("target_default_action_occurred")
    && failed.unknown_facts.includes("focus_state_caused_outcome")
    && failed.unknown_facts.includes("timing_caused_outcome")
    && failed.unknown_facts.includes("repair_required"));
  check("3b. the boundary states the span, not a member of it",
    failed.failure_boundary === "UNLOCALIZED_BETWEEN_DISPATCH_AND_TARGET_EFFECT",
    "delivery / target receipt / target handling were never observed, so none is claimed");

  // ================= 4. UNPROVEN stays UNPROVEN =================
  const unproven = c(evidence({ observation_after: unseen("read failed"), effect_verdict: verdictOf("UNPROVEN", "AFTER_OBSERVATION_UNAVAILABLE") }));
  check("4. UNPROVEN does not become FAILED, and is an evidence gap not a defect",
    unproven.defect_status === "INSUFFICIENT_EVIDENCE" && unproven.root_cause_class === "MISSING_EVIDENCE"
    && unproven.failure_boundary === "AFTER_OBSERVATION" && unproven.next_state === "STOP_UNPROVEN");

  // ================= 5 & 6. dispatch does not steer the classification =================
  check("5. dispatch COMPLETED does not suppress the FAILED effect",
    failed.known_facts["dispatch_status"] === "COMPLETED" && failed.known_facts["effect_verdict"] === "FAILED"
    && failed.next_state !== "EFFECT_COMPLETE");
  const dispatchFailed = c(evidence({ result_status: "FAILED" }));
  check("6. dispatch FAILED localizes to DISPATCH and still fabricates no target diagnosis",
    dispatchFailed.failure_boundary === "DISPATCH" && dispatchFailed.root_cause === null
    && dispatchFailed.unknown_facts.includes("input_reached_target_application"));

  // ================= 7. evidence gap =================
  const gap = c(evidence({ observation_before: unseen("no read"), effect_verdict: verdictOf("UNPROVEN", "BEFORE_OBSERVATION_UNAVAILABLE") }));
  check("7. missing observation produces an evidence-gap classification",
    gap.defect_status === "INSUFFICIENT_EVIDENCE" && gap.failure_boundary === "BEFORE_OBSERVATION"
    && gap.next_state_reason === "EVIDENCE_GAP_NO_REGISTERED_ACQUISITION_PATH");
  const missingObservable = c(evidence({ effect_verdict: verdictOf("UNPROVEN", "REQUIRED_OBSERVABLE_MISSING") }));
  check("7b. an observable the source cannot provide is a VERIFICATION-boundary gap",
    missingObservable.failure_boundary === "VERIFICATION" && missingObservable.defect_status === "INSUFFICIENT_EVIDENCE");

  // ================= 8 & 9. procedures are selected, never invented =================
  // Step 7 made the procedure contract explicit: a procedure declares the
  // unknown it resolves and the evidence it needs, and selection matches on
  // those rather than on a boundary label.
  const registered: DiagnosticProcedure[] = [{
    procedure_id: "proc-test-delivery-probe", canonical_name: "TEST_FIXTURE_PROBE",
    capability_id: "capability-0de653bb-c968-4168-85c6-9d67beef2b5a", operation: "scroll",
    resolves_unknown: ["input_reached_target_application"],
    requires_evidence: [
      { observable: "wc", location: "OBSERVATION_BEFORE", must_be_acquired: true },
      { observable: "wc", location: "OBSERVATION_AFTER", must_be_acquired: true },
    ],
    requires_state_contract: "DNAOS_SANDBOX_TITLE_V1",
    origination: "SYSTEM", diagnostic_boundary: "TARGET_RECEIPT",
    input_contract: ["EXECUTION_EVIDENCE"], output_contract: ["DIAGNOSTIC_FINDING"],
    authority_requirement: "NONE", physical_action: "NONE", status: "REGISTERED",
    registered_by: "tests/fixture", entry_point: "tests://fixture",
  }];
  const withProc = c(evidence({}), registered);
  check("8. a registered procedure for this boundary selects DIAGNOSE",
    withProc.next_state === "DIAGNOSE" && withProc.diagnostic_procedure === "proc-test-delivery-probe"
    && withProc.diagnostic_procedure_source === "tests/fixture" && withProc.owner_required === false);
  check("8b. selecting a procedure still asserts no cause",
    withProc.root_cause === null && withProc.defect_status === "CAUSE_UNKNOWN");
  check("9. with no registered procedure the classifier invents none",
    failed.diagnostic_procedure === null && failed.next_state === "BLOCKED"
    && failed.next_state_reason === "NO_REGISTERED_DIAGNOSTIC_PROCEDURE");
  const wrongOp: DiagnosticProcedure[] = [{ ...registered[0]!, operation: "click" }];
  check("9b. a procedure registered for another operation is not borrowed",
    c(evidence({}), wrongOp).next_state === "BLOCKED");
  const wrongCapability: DiagnosticProcedure[] = [{ ...registered[0]!, capability_id: "capability-00000000-0000-0000-0000-000000000000" }];
  check("9c. a procedure registered against another capability is not borrowed",
    c(evidence({}), wrongCapability).next_state === "BLOCKED");

  // ================= 10. no generic retry =================
  const allStates = new Set<string>();
  for (const status of ["FAILED", "UNPROVEN", "VERIFIED"]) {
    for (const reason of ["EXPECTATION_NOT_MET", "EXPECTATION_MET", "EXPECTATION_UNAVAILABLE", "BEFORE_OBSERVATION_UNAVAILABLE", "AFTER_OBSERVATION_UNAVAILABLE", "REQUIRED_OBSERVABLE_MISSING", "OBSERVABLE_NOT_COMPARABLE", "UNSUPPORTED_EXPECTATION"]) {
      for (const dispatch of ["COMPLETED", "FAILED", "BLOCKED", null]) {
        allStates.add(c(evidence({ result_status: dispatch, effect_verdict: verdictOf(status, reason) })).next_state);
      }
    }
  }
  check("10. no evidence shape reaches RETRY_ALLOWED or REPAIR_ALLOWED without a registered policy",
    !allStates.has("RETRY_ALLOWED") && !allStates.has("REPAIR_ALLOWED"),
    `states reachable from evidence alone: ${[...allStates].sort().join(", ")}`);

  // ================= 11 & 12. the Owner boundary =================
  check("11. an unknown cause alone never escalates to the Owner",
    failed.owner_required === false && failed.next_state !== "OWNER_DECISION_REQUIRED"
    && unproven.owner_required === false && gap.owner_required === false);
  const ownerOnly = c(evidence({ authorized: false, executed: false, authorization_reason: "HIGH_RISK_NOT_EXPLICITLY_AUTHORIZED: login (L3) ต้องมี lease.high_risk_explicit", effect_verdict: undefined }));
  check("12. a policy that only an Owner grant can satisfy does escalate",
    ownerOnly.owner_required === true && ownerOnly.next_state === "OWNER_DECISION_REQUIRED"
    && ownerOnly.next_state_reason === "OWNER_ONLY_AUTHORITY_REQUIRED" && ownerOnly.failure_boundary === "AUTHORITY");
  const callerError = c(evidence({ authorized: false, executed: false, authorization_reason: "TARGET_MISMATCH: lease.target=x != screen", effect_verdict: undefined }));
  check("12b. an ordinary authority denial stays inside system authority",
    callerError.owner_required === false && callerError.failure_boundary === "AUTHORITY" && callerError.next_state === "BLOCKED");
  const badIdentity = c(evidence({ authorized: false, executed: false, authorization_reason: "CAPABILITY_ID_MALFORMED", effect_verdict: undefined }));
  check("12c. an identity refusal localizes to IDENTITY and indicates no defect",
    badIdentity.failure_boundary === "IDENTITY" && badIdentity.defect_status === "NO_DEFECT_INDICATED");

  // ================= 13. determinism =================
  const answers = new Set<string>();
  for (let i = 0; i < 200; i += 1) answers.add(JSON.stringify(c(evidence({}))));
  check("13. classification is deterministic across repeated evaluation", answers.size === 1, `distinct=${answers.size}`);

  // ================= 14. no model =================
  const src = readFileSync(join(process.cwd(), "control/computer-use-executor/outcome-classification.ts"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
  check("14. no model, network, subprocess or randomness in the classifier",
    !/\b(fetch|anthropic|openai|claude|spawn|exec|execFile|http|Math\.random)\b/i.test(code));
  check("14b. the classifier is pure — it reads no file and no clock of its own",
    !/readFileSync|writeFileSync|appendFileSync|Date\.now/.test(code));

  // ================= 15-19. earlier steps unchanged =================
  const execSrc = readFileSync(join(process.cwd(), "control/computer-use-executor/executor.ts"), "utf8");
  check("15-19. Step 6 did not touch the locked execution path",
    !execSrc.includes("outcome-classification") && !execSrc.includes("classifyOutcome"),
    "classification is a consequence drawn from evidence, not a step inside execution");

  // ================= 20. legacy =================
  const legacy = JSON.parse('{"evidence_id":"cue-legacy","work_order_id":"w","execution_owner":"control/computer-use-executor","executor_pid":1,"executor_process_title":"node","requester":"x","authority_id":"a","operation":"scroll","target":"screen","authorized":true,"authorization_reason":"AUTHORIZED","executed":true,"result_status":"COMPLETED","started_at":"2026-09-01T00:00:00.000Z","completed_at":"2026-09-01T00:00:01.000Z"}') as ExecutionEvidence;
  const legacyClass = c(legacy);
  check("20. legacy evidence classifies without inventing what it never recorded",
    legacyClass.defect_status === "INSUFFICIENT_EVIDENCE" && legacyClass.failure_boundary === "UNLOCALIZED"
    && legacyClass.next_state === "STOP_UNPROVEN" && legacyClass.root_cause === null
    && legacyClass.known_facts["effect_verdict"] === undefined);

  // ================= 21. nothing anywhere names a cause or a component =================
  const everyClassification: OutcomeClassification[] = [verified, failed, unproven, dispatchFailed, gap, withProc, ownerOnly, callerError, badIdentity, legacyClass];
  check("21. no classification names a component, a cause, or a repair",
    everyClassification.every((x) => x.root_cause === null)
    && !/scroll primitive|browser|wheel|CSS|mouse.helper|focus was|broken|because/i.test(JSON.stringify(everyClassification.map((x) => ({ ...x, known_facts: undefined })))),
    "the records carry classifications, never explanations");

  // ================= 22. the real registry is empty, and that is the honest state =================
  // Step 6 asserted this registry was empty, which was then true. Steps 7 and 11
  // each registered exactly one procedure, both of which read already-persisted
  // evidence and touch nothing. The invariant that survives is the one that
  // mattered: only deliberately registered procedures can ever be selected, and
  // every one of them is action-free and authority-free.
  const registry = readDiagnosticProcedures();
  const expected = ["proc-wheel-receipt-from-existing-observation-v1", "proc-window-server-routing-context-v1"];
  check("22. the real registry contains only what was deliberately registered",
    registry.length === expected.length
    && expected.every((id) => registry.some((r) => r.procedure_id === id))
    && registry.every((r) => r.physical_action === "NONE" && r.authority_requirement === "NONE"),
    registry.map((r) => r.canonical_name).join(", "));

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
