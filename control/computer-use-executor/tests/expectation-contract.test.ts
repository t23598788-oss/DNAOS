/**
 * หน้าที่: prove that DNA OS knows what an action was supposed to observably do
 * BEFORE that action runs, that the answer is typed and finite, and that it can
 * never be back-filled from what was seen afterwards (Owner, 2026-09-02).
 *
 * THE INVERSION THIS FORBIDS. Without a pre-execution expectation the only way
 * to judge an AFTER observation is for a reader — human or model — to decide
 * afterwards what should have happened. The record's meaning would then depend
 * on who read it. Cases 1, 3, 4 and 16 close that: the expectation is stamped
 * before the adapter is entered, the adapter cannot reach it, an observation
 * cannot be passed into its construction, and the persisted value equals a
 * snapshot taken before execution.
 *
 * THE STRONGER PROOF IS THE SHAPE, NOT THE CLOCK. `buildExpectation` accepts an
 * operation and pre-execution declarations and nothing else — no parameter can
 * hold an Observation, and ../expectation.ts imports no observation module.
 * Case 17 asserts that at source level, so the ordering survives a future edit
 * that a timestamp comparison alone would not catch.
 *
 * WHAT THIS STEP STILL REFUSES. No comparison between expectation and
 * observation happens anywhere here, and case 13 fails if any verdict
 * vocabulary reaches a persisted row. An expectation is what to look for, not a
 * finding.
 *
 * Input: none — authority, adapter and observer are injected, so no OS action
 * and no real accessibility read occur.
 * Output: exit code 0 (all passed) or 1.
 * Dependency ที่อนุญาต: ../executor, ../expectation, ../observation, node built-ins.
 * สิ่งที่ห้ามแตะ: ห้ามแก้เทสต์นี้ให้ยอมรับเกณฑ์แบบข้อความอิสระ หรือ expectation
 * ที่สร้างหลัง action.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { EXECUTION_ROUTE_CAPABILITY_ID, executeComputerUse, type ExecutionEvidence } from "../executor";
import { buildExpectation, validateExpectation, type ExpectationAvailable } from "../expectation";
// Observation types come from ../observation — expectation.ts deliberately has none.
import type { Observation, ObservationTarget } from "../observation";
import { conditionMet } from "../tools/acceptance-verifier";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const dir = mkdtempSync(join(tmpdir(), "dna-os-expectation-test-"));
const evidenceDir = relative(process.cwd(), dir);
const rows = (): ExecutionEvidence[] =>
  readFileSync(join(dir, "execution-evidence.jsonl"), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as ExecutionEvidence);

const OUTCOME = { ok: true, status: "COMPLETED", summary: "scroll via CGEvent", evidence: ["ui_action=scroll", "mouse_helper=OK", "OK scroll 0,600"], artifacts: [], next_action: null, idempotent_replay: false, presentation: null, focus_restored: null } as const;
/** The observer stamps its own read from the run's clock — a fixed literal would
 *  compare the fixture rather than the real ordering. */
const READING = (sy: string, at: string): Observation => ({ acquired: true, observed_at: at, source: "ACCESSIBILITY_WINDOW_TITLE", state: { sy, clicks: "0" }, unavailable_reason: null }) as never;

const base = {
  authority_id: "authority-test",
  requester: "control/computer-use-executor/tests",
  operation: "scroll" as never,
  target: "screen",
  capability_id: EXECUTION_ROUTE_CAPABILITY_ID as string,
  observation_target: { pid: 4242 } as ObservationTarget,
  scope_needed: ["screen"],
  ui: { app: "chrome", target: "screen", scope: "screen", delta: { dx: 0, dy: 600 } },
};

/** A clock that advances one second per read, so ordering between stamps is unambiguous. */
function tickingClock(): () => Date {
  let t = Date.parse("2026-09-02T10:00:00.000Z");
  return () => { const d = new Date(t); t += 1000; return d; };
}

(async () => {
  // ================= 1. built before the action, proven against the adapter =================
  let adapterEnteredAt = "";
  const clock = tickingClock();
  await executeComputerUse({ ...base, work_order_id: "wo-exp-order" } as never, {
    validateAuthority: () => ({ ok: true }) as never,
    runUiWorkOrder: async () => { adapterEnteredAt = clock().toISOString(); return OUTCOME as never; },
    observe: () => READING("0", clock().toISOString()),
    now: clock,
    newEvidenceId: () => "cue-exp-order",
    evidenceDir,
    platform: "darwin",
  } as never);
  const ordered = rows().find((r) => r.evidence_id === "cue-exp-order")!;
  const createdAt = (ordered.expectation as ExpectationAvailable).created_at;
  check("1. expectation was constructed before the adapter was entered",
    !!createdAt && !!adapterEnteredAt && Date.parse(createdAt) < Date.parse(adapterEnteredAt),
    `expectation=${createdAt} adapter=${adapterEnteredAt}`);
  check("1b. expectation exists before the AFTER observation was read",
    Date.parse(createdAt) < Date.parse(ordered.observation_after!.observed_at ?? "2099-01-01T00:00:00.000Z")
    || ordered.observation_after!.acquired === false);

  // ================= 2. survives persistence and readback =================
  const inMemory = buildExpectation({ operation: "scroll" }, () => new Date(Date.parse(createdAt)));
  check("2. persisted expectation is byte-identical to the contract's own output",
    JSON.stringify(ordered.expectation) === JSON.stringify(inMemory),
    JSON.stringify(ordered.expectation));

  // ================= 3 & 4. AFTER cannot alter or produce expectation =================
  // The observer returns wildly different states on the two reads. If any part
  // of the expectation were derived from an observation, the persisted value
  // would differ from one built with no observation in existence at all.
  let read = 0;
  await executeComputerUse({ ...base, work_order_id: "wo-exp-afterproof" } as never, {
    validateAuthority: () => ({ ok: true }) as never,
    runUiWorkOrder: async () => OUTCOME as never,
    observe: () => READING(read++ === 0 ? "0" : "999999", "2026-09-02T00:00:00.000Z"),
    now: tickingClock(),
    newEvidenceId: () => "cue-exp-afterproof",
    evidenceDir,
    platform: "darwin",
  } as never);
  const afterProof = rows().find((r) => r.evidence_id === "cue-exp-afterproof")!;
  const stripTime = (e: unknown) => JSON.stringify(e).replace(/"created_at":"[^"]*"/, '"created_at":"*"');
  check("3. AFTER observation did not alter the expectation",
    stripTime(afterProof.expectation) === stripTime(ordered.expectation));
  check("4. no observed value appears anywhere in the expectation",
    !JSON.stringify(afterProof.expectation).includes("999999") && !JSON.stringify(afterProof.expectation).includes("sy\":\"0"),
    JSON.stringify(afterProof.expectation));

  // ================= 5. missing expectation stays explicitly unavailable =================
  const noRule = buildExpectation({ operation: "pointer_move" });
  check("5. an operation with no deterministic rule is explicitly unavailable, not invented",
    noRule.available === false && (noRule as { unavailable_reason: string }).unavailable_reason.startsWith("NO_DETERMINISTIC_RULE"));
  const noText = buildExpectation({ operation: "type", ui: {} });
  check("5b. type without a declared value yields no expectation rather than a guess",
    noText.available === false && (noText as { unavailable_reason: string }).unavailable_reason.startsWith("NO_DECLARED_TEXT"));
  await executeComputerUse({ ...base, work_order_id: "wo-exp-nomove", operation: "pointer_move" as never, ui: { app: "chrome", scope: "screen", coordinate: { x: 1, y: 1 } } } as never, {
    validateAuthority: () => ({ ok: true }) as never,
    runUiWorkOrder: async () => OUTCOME as never,
    observe: () => READING("0", "2026-09-02T00:00:00.000Z"),
    now: tickingClock(), newEvidenceId: () => "cue-exp-nomove", evidenceDir,
    platform: "darwin",
  } as never);
  const nomove = rows().find((r) => r.evidence_id === "cue-exp-nomove")!;
  check("5c. absent expectation did not block execution or change authority",
    nomove.expectation!.available === false && nomove.authorized === true && nomove.executed === true,
    `authorized=${nomove.authorized} executed=${nomove.executed}`);

  // ================= 6. no free-form success criterion =================
  check("6. a natural-language criterion is not a valid expectation",
    validateExpectation({ available: true, operation: "scroll", created_at: new Date().toISOString(), conditions: [{ observable: "scrollY", observed_as: "sy", relation: "the page should move down a bit", expected_value: null, expected_pattern: null, origin: "OPERATION_CONTRACT" }] }).ok === false);
  check("6b. a raw regex smuggled in as a pattern is rejected",
    validateExpectation({ available: true, operation: "key", created_at: new Date().toISOString(), conditions: [{ observable: "state", observed_as: "st", relation: "MATCHES", expected_value: null, expected_pattern: "/KEY:/i", origin: "OPERATION_CONTRACT" }] }).ok === false);
  check("6c. every produced condition uses only closed-vocabulary values",
    (["click", "double_click", "scroll", "drag", "key"] as const).every((op) => validateExpectation(buildExpectation({ operation: op })).ok));

  // ================= 7. malformed expectation fails validation =================
  const malformed: Array<[string, unknown]> = [
    ["unknown observable", { available: true, operation: "scroll", created_at: new Date().toISOString(), conditions: [{ observable: "vibes", observed_as: "vb", relation: "CHANGES", expected_value: null, expected_pattern: null, origin: "OPERATION_CONTRACT" }] }],
    ["EQUALS without a value", { available: true, operation: "type", created_at: new Date().toISOString(), conditions: [{ observable: "input", observed_as: "in", relation: "EQUALS", expected_value: null, expected_pattern: null, origin: "REQUEST_DECLARATION" }] }],
    ["disallowed origin", { available: true, operation: "scroll", created_at: new Date().toISOString(), conditions: [{ observable: "scrollY", observed_as: "sy", relation: "CHANGES", expected_value: null, expected_pattern: null, origin: "AI_INFERENCE" }] }],
    ["unavailable without a reason", { available: false, operation: "focus", created_at: new Date().toISOString() }],
    ["no conditions", { available: true, operation: "scroll", created_at: new Date().toISOString(), conditions: [] }],
    ["observed key mismatch", { available: true, operation: "scroll", created_at: new Date().toISOString(), conditions: [{ observable: "scrollY", observed_as: "clicks", relation: "CHANGES", expected_value: null, expected_pattern: null, origin: "OPERATION_CONTRACT" }] }],
  ];
  check("7. every malformed expectation is rejected with a reason",
    malformed.every(([, v]) => validateExpectation(v).ok === false),
    malformed.filter(([, v]) => validateExpectation(v).ok).map(([n]) => n).join(", ") || "all rejected");
  check("7b. AI_INFERENCE is not an accepted origin", validateExpectation(malformed[2]![1]).ok === false);

  // ================= 8. no model is invoked =================
  const source = readFileSync(join(process.cwd(), "control/computer-use-executor/expectation.ts"), "utf8");
  check("8. the contract calls no model, no network, no subprocess",
    !/\b(fetch|anthropic|openai|claude|spawn|exec|execFile|http)\b/i.test(source.split("\n").filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//") && !l.trimStart().startsWith("/*")).join("\n")),
    "expectation.ts is pure and dependency-free apart from the operation type");

  // ================= 9-12. earlier steps intact =================
  const o = ordered.outcome!;
  check("9. Step 1 outcome preservation intact",
    o.dispatch_evidence.ok === true && o.dispatch_evidence.evidence.includes("OK scroll 0,600") && o.presentation_state === null);
  check("10. Step 2 capability identity intact", ordered.capability_id === EXECUTION_ROUTE_CAPABILITY_ID);
  check("11. Step 3 BEFORE/AFTER observation intact",
    ordered.observation_before?.acquired === true && ordered.observation_after?.acquired === true && ordered.observation_before?.state?.["sy"] === "0");
  check("12. COMPLETED still means dispatch only", ordered.result_status === "COMPLETED" && o.dispatch_evidence.evidence.includes("mouse_helper=OK"));

  // ================= 13. no verdict was created =================
  // Step 5 added `effect_verdict` as a separate field with its own evidence
  // requirements. The expectation must remain free of any conclusion: it says
  // what to look for, and nothing about whether it was found.
  check("13. the expectation itself states no conclusion",
    !/"PASS"|"FAIL"|NOT_PROVEN|verdict|proven|effect_success|effect_verified|satisfied|matched/i.test(JSON.stringify({ ...ordered, effect_verdict: undefined })),
    "expectation and observations carry no finding");

  // ================= 14. legacy rows =================
  const legacy = JSON.parse('{"evidence_id":"cue-legacy","work_order_id":"w","execution_owner":"control/computer-use-executor","executor_pid":1,"executor_process_title":"node","requester":"x","authority_id":"a","operation":"scroll","target":"screen","authorized":true,"authorization_reason":"AUTHORIZED","executed":true,"result_status":"COMPLETED","started_at":"2026-09-01T00:00:00.000Z","completed_at":"2026-09-01T00:00:01.000Z"}') as ExecutionEvidence;
  check("14. legacy evidence readable; expectation simply absent",
    legacy.result_status === "COMPLETED" && legacy.expectation === undefined && legacy.observation_before === undefined);

  // ================= 15. denied execution fabricates nothing =================
  const denied = await executeComputerUse({ ...base, work_order_id: "wo-exp-denied" } as never, {
    validateAuthority: () => ({ ok: false, reason_code: "TARGET_MISMATCH", detail: "no" }) as never,
    runUiWorkOrder: async () => { throw new Error("adapter must not run"); },
    observe: () => { throw new Error("observer must not run"); },
    now: tickingClock(), newEvidenceId: () => "cue-exp-denied", evidenceDir,
    platform: "darwin",
  } as never);
  const deniedRow = rows().find((r) => r.evidence_id === "cue-exp-denied")!;
  check("15. denied execution records no expectation and no result",
    deniedRow.executed === false && deniedRow.expectation!.available === false
    && (deniedRow.expectation as { unavailable_reason: string }).unavailable_reason === "NO_EXPECTATION_CONSTRUCTED_FOR_THIS_EXECUTION"
    && deniedRow.outcome === null && denied.outcome === null);

  // ================= 16. the rules are the ones that already existed =================
  // Until Step 5 these rules were literal expressions inside conditionMet, and
  // this case grepped for them. Step 5 made this contract their single owner and
  // conditionMet a caller, so the check is now behavioural: the verifier agrees
  // with the expectation on the cases the rules exist to separate.
  // ../tests/verifier-equivalence.test.ts proves that agreement exhaustively.
  const St = (o: Record<string, unknown>) => ({ clicks: 0, dbls: 0, state: "", input: "", scrollY: 0, dragLeft: 0, activeElement: "body", maxScrollY: 2400, wheelCount: 0, wheelDeltaY: 0, wheelMode: 0, wheelTarget: "", ...o }) as never;
  const scroll = buildExpectation({ operation: "scroll" }) as ExpectationAvailable;
  const dbl = buildExpectation({ operation: "double_click" }) as ExpectationAvailable;
  check("16. scroll's expectation is the verifier's own existing rule",
    scroll.conditions.length === 1 && scroll.conditions[0]!.observable === "scrollY" && scroll.conditions[0]!.relation === "CHANGES"
    && conditionMet("scroll", St({ scrollY: 0 }), St({ scrollY: 600 })) === true
    && conditionMet("scroll", St({ scrollY: 600 }), St({ scrollY: 600 })) === false);
  check("16b. double_click carries BOTH halves of the existing rule, not just the counter",
    dbl.conditions.length === 2 && dbl.conditions.some((c) => c.observable === "dbls" && c.relation === "INCREASE")
    && dbl.conditions.some((c) => c.relation === "MATCHES" && c.expected_pattern === "DOUBLECLICK_STATE")
    && conditionMet("double_click", St({ dbls: 0 }), St({ dbls: 1, state: "DOUBLECLICK #1" })) === true
    && conditionMet("double_click", St({ dbls: 0 }), St({ dbls: 1, state: "CLICK #3" })) === false);
  const focusClick = buildExpectation({ operation: "click", intent_declaration: { intent: "focus", target: "testinput" } }) as ExpectationAvailable;
  check("16c. click+focus expects BECOMES, matching the verifier's before!=target requirement",
    focusClick.conditions[0]!.observable === "activeElement" && focusClick.conditions[0]!.relation === "BECOMES"
    && focusClick.conditions[0]!.expected_value === "testinput" && focusClick.conditions[0]!.origin === "REQUEST_DECLARATION");

  // ================= 17. the ordering is enforced by shape, not only by clock =================
  const expCode = source.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
  check("17. the expectation contract cannot receive an observation at all",
    !expCode.includes("./observation") && !/\bObservation\b/.test(expCode) && !/\bimport\b[^\n]*observation/i.test(expCode),
    "expectation.ts imports no observation module and names no observation type in code");
  const execSrc = readFileSync(join(process.cwd(), "control/computer-use-executor/executor.ts"), "utf8");
  check("17b. in the executor, expectation is built before both the observer and the adapter",
    execSrc.indexOf("buildExpectation(") < execSrc.indexOf("const observationBefore")
    && execSrc.indexOf("buildExpectation(") < execSrc.indexOf("await deps.runUiWorkOrder(order)"));

  rmSync(dir, { recursive: true, force: true });
  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
