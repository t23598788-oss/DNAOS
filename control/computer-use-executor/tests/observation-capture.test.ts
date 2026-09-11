/**
 * หน้าที่: prove that a Computer Use execution records what the target actually
 * looked like immediately before and immediately after the action — and that a
 * reading which did not happen is never written as if it had (Owner, 2026-09-02).
 *
 * WHAT THIS TEST REFUSES TO ALLOW. An observation is not a verdict. `before
 * scrollY=0` and `after scrollY=600` are two readings, nothing more; this step
 * makes no comparison and reaches no conclusion, and case 9 fails if any
 * verdict vocabulary appears in a persisted row. Dispatch evidence must also
 * stay dispatch evidence: "OK scroll 0,600" is the adapter saying it SENT a
 * wheel event, and case 7 fails if it ever migrates into an observation.
 *
 * THE DANGEROUS SHORTCUT, GUARDED BY CASES 5 AND 6. When a reading cannot be
 * acquired it would be easy to store a zeroed state. That state would later be
 * indistinguishable from a real reading in which nothing had changed — the
 * strongest possible false evidence. Unacquired observations therefore carry
 * `state: null` and a reason.
 *
 * Input: none — authority, adapter and observer are injected, so no OS action
 * and no real accessibility read occur.
 * Output: exit code 0 (all passed) or 1.
 * Dependency ที่อนุญาต: ../executor, ../observation, node built-ins.
 * สิ่งที่ห้ามแตะ: ห้ามแก้เทสต์นี้ให้ยอมรับ state ที่ไม่ได้อ่านมาจริง.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { EXECUTION_ROUTE_CAPABILITY_ID, executeComputerUse, type ExecutionEvidence } from "../executor";
import { NOT_OBSERVED, observeWindowTitleState, type Observation } from "../observation";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const dir = mkdtempSync(join(tmpdir(), "dna-os-observation-test-"));
const evidenceDir = relative(process.cwd(), dir);
const rows = (): ExecutionEvidence[] =>
  readFileSync(join(dir, "execution-evidence.jsonl"), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as ExecutionEvidence);

const OUTCOME = { ok: true, status: "COMPLETED", summary: "scroll via CGEvent", evidence: ["ui_action=scroll", "mouse_helper=OK", "OK scroll 0,600"], artifacts: [], next_action: null, idempotent_replay: false, presentation: null, focus_restored: null } as const;

const obs = (state: Record<string, string>, at: string): Observation =>
  ({ acquired: true, observed_at: at, source: "ACCESSIBILITY_WINDOW_TITLE", state, unavailable_reason: null });
const cannotRead = (reason: string): Observation =>
  ({ acquired: false, observed_at: null, source: "ACCESSIBILITY_WINDOW_TITLE", state: null, unavailable_reason: reason });

const base = {
  authority_id: "authority-test",
  requester: "control/computer-use-executor/tests",
  operation: "scroll" as never,
  target: "screen",
  capability_id: EXECUTION_ROUTE_CAPABILITY_ID as string,
  observation_target: { pid: 4242 },
  scope_needed: ["screen"],
  ui: { app: "chrome", target: "screen", scope: "screen", delta: { dx: 0, dy: 600 } },
};

function deps(id: string, readings: Observation[]) {
  let i = 0;
  return {
    validateAuthority: () => ({ ok: true }) as never,
    runUiWorkOrder: async () => OUTCOME as never,
    observe: () => readings[Math.min(i++, readings.length - 1)]!,
    now: () => new Date(),
    newEvidenceId: () => id,
    evidenceDir,
    platform: "darwin",
  } as never;
}

(async () => {
  // ---- both readings acquired ----
  const before = obs({ scrollY: "0", clicks: "3" }, "2026-09-02T00:00:00.000Z");
  const after = obs({ scrollY: "600", clicks: "3" }, "2026-09-02T00:00:01.000Z");
  await executeComputerUse({ ...base, work_order_id: "wo-obs-both" } as never, deps("cue-obs-both", [before, after]));
  const both = rows().find((r) => r.evidence_id === "cue-obs-both")!;

  check("1. BEFORE observation survives readback", both.observation_before?.acquired === true && both.observation_before?.state?.["scrollY"] === "0");
  check("2. AFTER observation survives readback", both.observation_after?.acquired === true && both.observation_after?.state?.["scrollY"] === "600");
  check("3. observed values preserved exactly, both keys, no coercion",
    JSON.stringify(both.observation_before?.state) === JSON.stringify(before.state)
    && JSON.stringify(both.observation_after?.state) === JSON.stringify(after.state));
  check("4. provenance and timestamps survive",
    both.observation_before?.source === "ACCESSIBILITY_WINDOW_TITLE"
    && both.observation_before?.observed_at === "2026-09-02T00:00:00.000Z"
    && both.observation_after?.observed_at === "2026-09-02T00:00:01.000Z");

  // ---- BEFORE unavailable, AFTER acquired ----
  await executeComputerUse({ ...base, work_order_id: "wo-obs-nobefore" } as never,
    deps("cue-obs-nobefore", [cannotRead("TARGET_PUBLISHES_NO_STATE: probe"), after]));
  const noBefore = rows().find((r) => r.evidence_id === "cue-obs-nobefore")!;
  check("5. unavailable BEFORE is not written as an empty observed state",
    noBefore.observation_before?.acquired === false
    && noBefore.observation_before?.state === null
    && (noBefore.observation_before?.unavailable_reason ?? "").startsWith("TARGET_PUBLISHES_NO_STATE"),
    `state=${JSON.stringify(noBefore.observation_before?.state)}`);

  // ---- BEFORE acquired, AFTER unavailable: BEFORE must not be erased ----
  await executeComputerUse({ ...base, work_order_id: "wo-obs-noafter" } as never,
    deps("cue-obs-noafter", [before, cannotRead("ACCESSIBILITY_READ_FAILED: probe")]));
  const noAfter = rows().find((r) => r.evidence_id === "cue-obs-noafter")!;
  check("6. unavailable AFTER is not written as empty, and valid BEFORE is kept",
    noAfter.observation_after?.acquired === false
    && noAfter.observation_after?.state === null
    && noAfter.observation_before?.acquired === true
    && noAfter.observation_before?.state?.["scrollY"] === "0");
  check("6b. COMPLETED with no AFTER reading stays dispatch status only",
    noAfter.result_status === "COMPLETED" && noAfter.observation_after?.acquired === false);

  // ---- semantics guards ----
  check("7. dispatch evidence stayed dispatch evidence",
    both.outcome!.dispatch_evidence.evidence.includes("OK scroll 0,600")
    && !JSON.stringify(both.observation_before).includes("OK scroll")
    && !JSON.stringify(both.observation_after).includes("mouse_helper"));
  check("8. COMPLETED unchanged in meaning and value", both.result_status === "COMPLETED");
  // `focus_restoration_verified` is Step 1's, and is the adapter's own producer
  // fact about focus — not a verdict about this action's effect. What must not
  // appear is a conclusion drawn FROM the two readings.
  // Since Step 4 the row also carries a pre-execution expectation. That is what
  // to look for, not a finding, so it is excluded here and guarded by
  // ./expectation-contract.test.ts; what must still be absent is any conclusion.
  // Step 5 added `effect_verdict` as its own field. The readings themselves must
  // still carry no conclusion — an observation states what was seen, never what
  // it means.
  check("9. no verdict was drawn from the two readings",
    !/verdict|proven|effect_verified|"PASS"|"FAILED"|satisfied|matched/i.test(JSON.stringify({ ...both, expectation: undefined, effect_verdict: undefined }))
    && !/verified|verdict|pass|fail|proven|expect/i.test(JSON.stringify([both.observation_before, both.observation_after])),
    "persisted row carries no conclusion");

  // ---- earlier steps intact ----
  check("10. Step 1 outcome preservation intact",
    both.outcome!.dispatch_evidence.ok === true && both.outcome!.presentation_state === null && both.outcome!.next_action === null);
  check("11. Step 2 capability identity intact", both.capability_id === EXECUTION_ROUTE_CAPABILITY_ID);

  // ---- legacy ----
  const legacy = JSON.parse('{"evidence_id":"cue-legacy","work_order_id":"w","execution_owner":"control/computer-use-executor","executor_pid":1,"executor_process_title":"node","requester":"x","authority_id":"a","operation":"scroll","target":"screen","authorized":true,"authorization_reason":"AUTHORIZED","executed":true,"result_status":"COMPLETED","started_at":"2026-09-01T00:00:00.000Z","completed_at":"2026-09-01T00:00:01.000Z"}') as ExecutionEvidence;
  check("12. legacy evidence readable; observations simply absent",
    legacy.result_status === "COMPLETED" && legacy.observation_before === undefined && legacy.observation_after === undefined);

  // ---- denied path must not imply an action was observed ----
  const denied = await executeComputerUse({ ...base, work_order_id: "wo-obs-denied" } as never, {
    validateAuthority: () => ({ ok: false, reason_code: "TARGET_MISMATCH", detail: "no" }) as never,
    runUiWorkOrder: async () => { throw new Error("adapter must not run"); },
    observe: () => { throw new Error("observer must not run when authority denies"); },
    now: () => new Date(), newEvidenceId: () => "cue-obs-denied", evidenceDir,
    platform: "darwin",
  } as never);
  const deniedRow = rows().find((r) => r.evidence_id === "cue-obs-denied")!;
  check("13. denied execution records NOT_OBSERVED, never a reading",
    deniedRow.executed === false && deniedRow.observation_before?.source === "NONE" && deniedRow.observation_before?.state === null && denied.outcome === null);

  // ---- Step 2 gate still first ----
  await executeComputerUse({ ...base, work_order_id: "wo-obs-badid", capability_id: "not-an-id" } as never, {
    validateAuthority: () => { throw new Error("authority must not be reached"); },
    runUiWorkOrder: async () => { throw new Error("adapter must not run"); },
    observe: () => { throw new Error("observer must not run before identity is settled"); },
    now: () => new Date(), newEvidenceId: () => "cue-obs-badid", evidenceDir,
    platform: "darwin",
  } as never);
  const badId = rows().find((r) => r.evidence_id === "cue-obs-badid")!;
  check("14. malformed capability still fails closed before any observation",
    badId.authorization_reason === "CAPABILITY_ID_MALFORMED" && badId.observation_before?.source === "NONE");

  // ---- the acquisition path itself refuses to invent ----
  const noTarget = observeWindowTitleState({});
  check("15. observer refuses without a target rather than guessing one",
    noTarget.acquired === false && noTarget.state === null && (noTarget.unavailable_reason ?? "").startsWith("NO_OBSERVATION_TARGET"));
  check("15b. no observer wired -> NOT_OBSERVED, distinct from a failed read",
    NOT_OBSERVED.source === "NONE" && NOT_OBSERVED.unavailable_reason === "NO_OBSERVER_FOR_THIS_EXECUTION");

  rmSync(dir, { recursive: true, force: true });
  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
