/**
 * หน้าที่: prove that DNA OS can decide, with no model anywhere in the path,
 * whether the effect declared before an action actually occurred — and that it
 * says UNPROVEN rather than FAILED whenever it could not look (Owner,
 * 2026-09-02).
 *
 * THE DISTINCTION EVERYTHING RESTS ON. "The counter did not move" and "the
 * counter could not be read" are different facts. Collapse them and a broken
 * observer becomes indistinguishable from a broken target, which is the
 * false-evidence failure this whole track exists to prevent. Cases 4, 5, 6 and
 * 8 assert UNPROVEN for every way the evidence can be insufficient; case 2
 * asserts FAILED only when every required reading really was acquired.
 *
 * THE OTHER FALSE POSITIVE, STILL REFUSED. Dispatch has never meant effect.
 * Case 7 puts COMPLETED next to an unmet expectation and requires FAILED; case
 * 10 feeds `mouse_helper=OK` and `OK scroll 0,600` into the observation state
 * as if they were readings, and requires that they satisfy nothing.
 *
 * DETERMINISM IS TESTED, NOT ASSUMED. Case 21 runs the same inputs 200 times
 * plus a shuffled condition order and requires one identical answer every time.
 *
 * Input: none — authority, adapter and observer are injected, so no OS action
 * and no real accessibility read occur.
 * Output: exit code 0 (all passed) or 1.
 * Dependency ที่อนุญาต: ../executor, ../effect-verdict, ../expectation, ../observation, node built-ins.
 * สิ่งที่ห้ามแตะ: ห้ามแก้เทสต์นี้ให้ยอมรับ COMPLETED เป็นหลักฐานผล, และห้ามยุบ
 * UNPROVEN เข้ากับ FAILED.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { EXECUTION_ROUTE_CAPABILITY_ID, executeComputerUse, type ExecutionEvidence } from "../executor";
import { evaluateEffect } from "../effect-verdict";
import { buildExpectation, type ExpectationRecord } from "../expectation";
import type { Observation, ObservationTarget } from "../observation";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const dir = mkdtempSync(join(tmpdir(), "dna-os-verdict-test-"));
const evidenceDir = relative(process.cwd(), dir);
const rows = (): ExecutionEvidence[] =>
  readFileSync(join(dir, "execution-evidence.jsonl"), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as ExecutionEvidence);

const OUTCOME = (status = "COMPLETED") => ({ ok: status === "COMPLETED", status, summary: "scroll via CGEvent", evidence: ["ui_action=scroll", "mouse_helper=OK", "OK scroll 0,600"], artifacts: [], next_action: null, idempotent_replay: false, presentation: null, focus_restored: null }) as never;

const seen = (state: Record<string, string>, at = "2026-09-02T00:00:00.000Z"): Observation =>
  ({ acquired: true, observed_at: at, source: "ACCESSIBILITY_WINDOW_TITLE", state, unavailable_reason: null });
const unseen = (reason: string): Observation =>
  ({ acquired: false, observed_at: null, source: "ACCESSIBILITY_WINDOW_TITLE", state: null, unavailable_reason: reason });

const SCROLL = buildExpectation({ operation: "scroll" });
const clock = () => new Date("2026-09-02T12:00:00.000Z");
const v = (e: ExpectationRecord | undefined, b: Observation | undefined, a: Observation | undefined) => evaluateEffect(e, b, a, clock);

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
const run = (id: string, readings: Observation[], status = "COMPLETED", extra: Record<string, unknown> = {}) =>
  executeComputerUse({ ...base, work_order_id: `wo-${id}`, ...extra } as never, {
    validateAuthority: () => ({ ok: true }) as never,
    runUiWorkOrder: async () => OUTCOME(status),
    observe: (() => { let i = 0; return () => readings[Math.min(i++, readings.length - 1)]!; })(),
    now: () => new Date(), newEvidenceId: () => id, evidenceDir,
  } as never);

(async () => {
  // ================= 1. expectation met =================
  check("1. expectation met with valid observations -> VERIFIED",
    v(SCROLL, seen({ sy: "0" }), seen({ sy: "600" })).status === "VERIFIED"
    && v(SCROLL, seen({ sy: "0" }), seen({ sy: "600" })).reason_code === "EXPECTATION_MET");

  // ================= 2. expectation not met =================
  const notMet = v(SCROLL, seen({ sy: "0" }), seen({ sy: "0" }));
  check("2. expectation not met with valid observations -> FAILED",
    notMet.status === "FAILED" && notMet.reason_code === "EXPECTATION_NOT_MET"
    && notMet.deciding_observable === "scrollY" && notMet.observed_before_value === "0" && notMet.observed_after_value === "0");

  // ================= 3. expectation unavailable =================
  const noExp = v(buildExpectation({ operation: "pointer_move" }), seen({ sy: "0" }), seen({ sy: "600" }));
  check("3. expectation unavailable -> UNPROVEN, never VERIFIED from a state that moved",
    noExp.status === "UNPROVEN" && noExp.reason_code === "EXPECTATION_UNAVAILABLE");
  check("3b. undefined expectation (legacy row) -> UNPROVEN",
    v(undefined, seen({ sy: "0" }), seen({ sy: "600" })).status === "UNPROVEN");

  // ================= 4 & 5. observation unavailable =================
  const noBefore = v(SCROLL, unseen("ACCESSIBILITY_READ_FAILED: probe"), seen({ sy: "600" }));
  check("4. BEFORE unavailable when required -> UNPROVEN",
    noBefore.status === "UNPROVEN" && noBefore.reason_code === "BEFORE_OBSERVATION_UNAVAILABLE");
  const noAfter = v(SCROLL, seen({ sy: "0" }), unseen("TARGET_PUBLISHES_NO_STATE: probe"));
  check("5. AFTER unavailable when required -> UNPROVEN",
    noAfter.status === "UNPROVEN" && noAfter.reason_code === "AFTER_OBSERVATION_UNAVAILABLE");
  check("5b. a relation that needs no BEFORE is not blocked by a missing BEFORE",
    v(buildExpectation({ operation: "type", ui: { text: "9070" } }), unseen("no read"), seen({ in: "9070" })).status === "VERIFIED");

  // ================= 6. required observable missing =================
  const missing = v(SCROLL, seen({ clicks: "0" }), seen({ clicks: "0" }));
  check("6. observable absent from an acquired reading -> UNPROVEN, not FAILED",
    missing.status === "UNPROVEN" && missing.reason_code === "REQUIRED_OBSERVABLE_MISSING");
  const notComparable = v(SCROLL, seen({ sy: "top" }), seen({ sy: "bottom" }));
  check("6b. non-numeric value where the locked rule compares numbers -> UNPROVEN",
    notComparable.status === "UNPROVEN" && notComparable.reason_code === "OBSERVABLE_NOT_COMPARABLE");
  const dbl = buildExpectation({ operation: "double_click" });
  check("6c. one unevaluable condition beside a false one is UNPROVEN, not FAILED",
    v(dbl, seen({ dbls: "0" }), seen({ dbls: "0" })).status === "UNPROVEN",
    "dbls present but `st` missing — the evidence to call it FAILED was never acquired");

  // ================= 7 & 8. dispatch never decides =================
  await run("cue-v-completed-notmet", [seen({ sy: "0" }), seen({ sy: "0" })]);
  const r7 = rows().find((r) => r.evidence_id === "cue-v-completed-notmet")!;
  check("7. COMPLETED + expectation not met -> FAILED, not VERIFIED",
    r7.result_status === "COMPLETED" && r7.effect_verdict!.status === "FAILED");
  await run("cue-v-completed-unseen", [unseen("read failed"), unseen("read failed")]);
  const r8 = rows().find((r) => r.evidence_id === "cue-v-completed-unseen")!;
  check("8. COMPLETED + observation unavailable -> UNPROVEN, not VERIFIED",
    r8.result_status === "COMPLETED" && r8.effect_verdict!.status === "UNPROVEN" && r8.effect_verdict!.reason_code === "BEFORE_OBSERVATION_UNAVAILABLE");

  // ================= 9. a failed dispatch is not rescued by unrelated state =================
  await run("cue-v-faileddispatch", [seen({ sy: "0", clicks: "0" }), seen({ sy: "0", clicks: "9" })], "FAILED");
  const r9 = rows().find((r) => r.evidence_id === "cue-v-faileddispatch")!;
  check("9. FAILED dispatch does not become VERIFIED from an unrelated observable moving",
    r9.result_status === "FAILED" && r9.effect_verdict!.status === "FAILED" && r9.effect_verdict!.deciding_observable === "scrollY");

  // ================= 10. dispatch evidence cannot satisfy a condition =================
  const dispatchAsState = v(SCROLL, seen({ sy: "0" }), seen({ sy: "0", evidence: "mouse_helper=OK", summary: "OK scroll 0,600" }));
  check("10. dispatch strings placed in the state satisfy nothing",
    dispatchAsState.status === "FAILED",
    "the evaluator reads only the declared observable");
  const verdictSrc = readFileSync(join(process.cwd(), "control/computer-use-executor/effect-verdict.ts"), "utf8");
  const verdictCode = verdictSrc.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
  check("10b. the evaluator cannot even reach dispatch data",
    !/outcome|result_status|dispatch|mouse_helper|COMPLETED/i.test(verdictCode),
    "no outcome or dispatch symbol exists in effect-verdict.ts code");

  // ================= 11. no model =================
  check("11. no model, network or subprocess in the verdict path",
    !/\b(fetch|anthropic|openai|claude|spawn|exec|execFile|http|Math\.random)\b/i.test(verdictCode));

  // ================= 12. verdict only after AFTER =================
  let afterReadAt = 0, verdictOrder = 0, tick = 0;
  const orderClock = () => { tick += 1; verdictOrder = tick; return new Date(Date.parse("2026-09-02T13:00:00.000Z") + tick * 1000); };
  await executeComputerUse({ ...base, work_order_id: "wo-order" } as never, {
    validateAuthority: () => ({ ok: true }) as never,
    runUiWorkOrder: async () => OUTCOME(),
    observe: () => { afterReadAt = ++tick; return seen({ sy: String(afterReadAt) }, `2026-09-02T13:00:0${afterReadAt}.000Z`); },
    now: orderClock, newEvidenceId: () => "cue-v-order", evidenceDir,
  } as never);
  const r12 = rows().find((r) => r.evidence_id === "cue-v-order")!;
  check("12. verdict was evaluated after the AFTER observation was acquired",
    Date.parse(r12.effect_verdict!.evaluated_at) > Date.parse(r12.observation_after!.observed_at!),
    `verdict=${r12.effect_verdict!.evaluated_at} after=${r12.observation_after!.observed_at}`);
  const execSrc = readFileSync(join(process.cwd(), "control/computer-use-executor/executor.ts"), "utf8");
  check("12b. in source order the verdict follows the adapter and the AFTER read",
    execSrc.indexOf("evaluateEffect(expectation, observationBefore") > execSrc.indexOf("const observationAfter")
    && execSrc.indexOf("evaluateEffect(expectation, observationBefore") > execSrc.indexOf("await deps.runUiWorkOrder(order)"));

  // ================= 13. persistence / readback =================
  await run("cue-v-readback", [seen({ sy: "0" }), seen({ sy: "600" })]);
  const r13 = rows().find((r) => r.evidence_id === "cue-v-readback")!;
  check("13. verdict persists and reads back exactly",
    r13.effect_verdict!.status === "VERIFIED" && r13.effect_verdict!.reason_code === "EXPECTATION_MET"
    && r13.effect_verdict!.expectation_created_at === (r13.expectation as { created_at: string }).created_at
    && r13.effect_verdict!.observation_after_at === r13.observation_after!.observed_at);
  check("13b. the whole chain is on one row",
    !!r13.work_order_id && !!r13.capability_id && !!r13.expectation && !!r13.observation_before && !!r13.outcome && !!r13.observation_after && !!r13.effect_verdict);

  // ================= 14-17. earlier steps intact =================
  check("14. Step 1 outcome preservation intact",
    r13.outcome!.dispatch_evidence.ok === true && r13.outcome!.dispatch_evidence.evidence.includes("OK scroll 0,600"));
  check("15. Step 2 capability identity intact", r13.capability_id === EXECUTION_ROUTE_CAPABILITY_ID);
  check("16. Step 3 observation intact",
    r13.observation_before!.state!["sy"] === "0" && r13.observation_after!.state!["sy"] === "600");
  check("17. Step 4 expectation intact",
    (r13.expectation as { available: boolean }).available === true && r13.expectation!.operation === "scroll");

  // ================= 18. legacy =================
  const legacy = JSON.parse('{"evidence_id":"cue-legacy","work_order_id":"w","execution_owner":"control/computer-use-executor","executor_pid":1,"executor_process_title":"node","requester":"x","authority_id":"a","operation":"scroll","target":"screen","authorized":true,"authorization_reason":"AUTHORIZED","executed":true,"result_status":"COMPLETED","started_at":"2026-09-01T00:00:00.000Z","completed_at":"2026-09-01T00:00:01.000Z"}') as ExecutionEvidence;
  check("18. legacy evidence readable; verdict simply absent, not assumed",
    legacy.result_status === "COMPLETED" && legacy.effect_verdict === undefined && legacy.expectation === undefined);

  // ================= 19. identity still fails closed, before anything runs =================
  await executeComputerUse({ ...base, work_order_id: "wo-badid", capability_id: "nope" } as never, {
    validateAuthority: () => { throw new Error("authority must not be reached"); },
    runUiWorkOrder: async () => { throw new Error("adapter must not run"); },
    observe: () => { throw new Error("observer must not run"); },
    now: () => new Date(), newEvidenceId: () => "cue-v-badid", evidenceDir,
  } as never);
  const r19 = rows().find((r) => r.evidence_id === "cue-v-badid")!;
  check("19. malformed capability fails closed and claims no effect",
    r19.authorization_reason === "CAPABILITY_ID_MALFORMED" && r19.executed === false && r19.effect_verdict!.status === "UNPROVEN");

  // ================= 20. denied execution =================
  const denied = await executeComputerUse({ ...base, work_order_id: "wo-denied" } as never, {
    validateAuthority: () => ({ ok: false, reason_code: "TARGET_MISMATCH", detail: "no" }) as never,
    runUiWorkOrder: async () => { throw new Error("adapter must not run"); },
    observe: () => { throw new Error("observer must not run"); },
    now: () => new Date(), newEvidenceId: () => "cue-v-denied", evidenceDir,
  } as never);
  const r20 = rows().find((r) => r.evidence_id === "cue-v-denied")!;
  check("20. denied execution fabricates neither VERIFIED nor FAILED",
    r20.executed === false && r20.effect_verdict!.status === "UNPROVEN"
    && r20.effect_verdict!.reason_code === "EXPECTATION_UNAVAILABLE" && denied.outcome === null);

  // ================= 21. determinism =================
  const answers = new Set<string>();
  for (let i = 0; i < 200; i += 1) {
    answers.add(JSON.stringify(evaluateEffect(SCROLL, seen({ sy: "0", clicks: "1" }), seen({ sy: "600", clicks: "1" }), clock)));
  }
  const multi = buildExpectation({ operation: "double_click" }) as unknown as { conditions: unknown[] };
  const reordered = { ...multi, conditions: [...multi.conditions].reverse() } as unknown as ExpectationRecord;
  const forward = v(multi as unknown as ExpectationRecord, seen({ dbls: "0", st: "x" }), seen({ dbls: "1", st: "DOUBLECLICK #1" })).status;
  const backward = v(reordered, seen({ dbls: "0", st: "x" }), seen({ dbls: "1", st: "DOUBLECLICK #1" })).status;
  check("21. DETERMINISTIC_REPEAT_VERDICT = SAME (200 identical runs, order-independent)",
    answers.size === 1 && forward === backward && forward === "VERIFIED",
    `distinct answers=${answers.size}`);

  // ================= 22. an execution verdict is not a capability proof =================
  check("22. the verdict record makes no capability-level claim",
    !("capability_status" in r13.effect_verdict!) && !/PROVEN|capability_proof/i.test(JSON.stringify(r13.effect_verdict)));

  rmSync(dir, { recursive: true, force: true });
  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
