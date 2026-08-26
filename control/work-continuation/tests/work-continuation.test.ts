/**
 * หน้าที่: the real proof for `control/work-continuation/`. Drives the REAL
 * exported contract — reverse index, evaluator, and the append-only store on a
 * real temp file — and covers the Owner's six required runtime cases A–F.
 *
 * The cases that matter most are B (only affected work is evaluated, never a
 * full scan) and E (a replayed event does not execute twice). Those two are the
 * difference between an evidence-triggered system and a polling one.
 *
 * Run: npx tsx control/work-continuation/tests/work-continuation.test.ts
 */

import { buildIndex, affectedWorkIds, evaluate, digestOf, MAX_RESUME_ATTEMPTS,
         appendWaiting, currentWaiting, loadWaiting } from "../contract";
import type { DependencyEvent, WaitingWork } from "../contract";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

declare const process: { exitCode?: number };
declare const console: { log(...a: unknown[]): void };

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n      ${JSON.stringify(detail)}`); }
}

function work(over: Partial<WaitingWork> = {}): WaitingWork {
  return {
    work_id: "work-1", current_phase: "BUILD", status: "WAITING",
    blocked_on: ["evidence:E91"], required_evidence: ["evidence:E91"],
    required_resources: [], required_capabilities: [], required_runtime_state: [], required_external_state: [],
    resume_condition: "ALL_AVAILABLE", exact_state: null,
    next_action: "run the deploy verification suite",
    resolved_work_context_ref: "resolution-abc", last_verified_revision: "rev-1",
    evidence_refs: [], resume_attempt_count: 0, last_resume_reason: null,
    last_input_digest: null, last_result_digest: null,
    required_worker_class: "DETERMINISTIC_TEST", recorded_at: "2026-08-26T00:00:00.000Z",
    ...over,
  };
}
const ev = (over: Partial<DependencyEvent> = {}): DependencyEvent => ({
  key: "evidence:E91", value: null, source: "verification",
  evidence_ref: "ledger:line-42", occurred_at: "2026-08-26T01:00:00.000Z", ...over,
});
const NONE = new Set<string>();

function main(): void {
  // ---- CASE A: blocked work persists, worker exits, later evidence resumes the SAME work_id ----
  const dir = mkdtempSync(join(tmpdir(), "wc-"));
  const path = join(dir, "waiting.jsonl");
  appendWaiting(work({ work_id: "work-A" }), path);
  const reloaded = currentWaiting(path);                       // simulates a brand-new process
  check("A1. waiting work survives a process boundary (durable, no agent memory)",
    reloaded.length === 1 && reloaded[0].work_id === "work-A");
  const evalA = evaluate(reloaded[0], ev(), NONE, "rev-1", null);
  check("A2. the arriving evidence makes it RESUME_ELIGIBLE", evalA.verdict === "RESUME_ELIGIBLE", evalA);
  check("A3. the SAME work_id is preserved — no new work item", evalA.work_id === "work-A");

  // ---- CASE B: 100 blocked works, one event matches only 2 → only those 2 evaluated ----
  const many: WaitingWork[] = [];
  for (let i = 0; i < 100; i += 1) many.push(work({ work_id: `w${i}`, blocked_on: [`evidence:OTHER-${i}`] }));
  many[7]  = work({ work_id: "w7",  blocked_on: ["evidence:E91"] });
  many[63] = work({ work_id: "w63", blocked_on: ["evidence:E91", "resource:R8"] });
  const idx = buildIndex(many, "2026-08-26T00:00:00.000Z");
  const hit = affectedWorkIds(idx, ev());
  check("B1. one event selects EXACTLY the 2 waiting items, out of 100",
    hit.length === 2 && hit.includes("w7") && hit.includes("w63"), hit);
  check("B2. selection is a single index lookup — the other 98 are never touched",
    idx.waiting.get("evidence:E91")!.length === 2 && idx.indexed_work === 100);
  check("B3. an unrelated key selects nothing", affectedWorkIds(idx, ev({ key: "evidence:NOBODY" })).length === 0);

  // ---- CASE C: resource/agent unavailable → work stays durable, resumes when one appears ----
  const waitingRes = work({ work_id: "work-C", status: "WAITING_FOR_RESOURCE",
    blocked_on: ["capability:worker:DETERMINISTIC_TEST"], resume_condition: "ANY_AVAILABLE" });
  const stillNoAgent = evaluate(waitingRes, ev({ key: "evidence:UNRELATED" }), NONE, "rev-1", null);
  check("C1. with no compatible resource the work stays blocked, never dropped",
    stillNoAgent.verdict === "STILL_BLOCKED", stillNoAgent);
  const agentAppears = evaluate(waitingRes, ev({ key: "capability:worker:DETERMINISTIC_TEST", source: "registry" }), NONE, "rev-1", null);
  check("C2. a compatible resource appearing wakes it, same work_id",
    agentAppears.verdict === "RESUME_ELIGIBLE" && agentAppears.work_id === "work-C", agentAppears);

  // ---- CASE D: resolution went stale while waiting ----
  const stale = evaluate(work({ last_verified_revision: "rev-1" }), ev(), NONE, "rev-9", null);
  check("D1. a moved resolution digest yields STALE_RESOLUTION, not RESUME_ELIGIBLE",
    stale.verdict === "STALE_RESOLUTION", stale);
  check("D2. the verdict names both revisions so DNA OS re-resolves deterministically",
    stale.reason.includes("rev-1") && stale.reason.includes("rev-9"), stale.reason);
  check("D3. an unchanged resolution does NOT trigger staleness",
    evaluate(work(), ev(), NONE, "rev-1", null).verdict === "RESUME_ELIGIBLE");

  // ---- CASE E: the same event replayed twice must not execute twice ----
  const first = evaluate(work({ work_id: "work-E" }), ev(), NONE, "rev-1", null);
  check("E1. first delivery is eligible", first.verdict === "RESUME_ELIGIBLE");
  const afterRun = work({ work_id: "work-E", resume_attempt_count: 1,
    last_input_digest: first.input_digest, last_result_digest: "result-1" });
  const replay = evaluate(afterRun, ev(), NONE, "rev-1", "result-1");
  check("E2. REPLAY of the identical event with an unchanged result is refused",
    replay.verdict === "STILL_BLOCKED", replay);
  check("E3. the refusal names the digest, so it is auditable not mysterious",
    replay.reason.includes(first.input_digest), replay.reason);
  const changedResult = evaluate(afterRun, ev(), NONE, "rev-1", "result-2");
  check("E4. the same event IS allowed again once the result actually changed",
    changedResult.verdict === "RESUME_ELIGIBLE", changedResult);
  const differentEvidence = evaluate(afterRun, ev({ evidence_ref: "ledger:line-99" }), NONE, "rev-1", "result-1");
  check("E5. a genuinely different trigger is not suppressed by the replay rule",
    differentEvidence.verdict === "RESUME_ELIGIBLE", differentEvidence);

  // ---- CASE F: chain reaction — resumed work's output wakes the next work ----
  const chain = [work({ work_id: "WORK_B", blocked_on: ["evidence:X"] }),
                 work({ work_id: "WORK_C", blocked_on: ["resource:Y"] })];
  const cIdx = buildIndex(chain, "t");
  const wakeB = affectedWorkIds(cIdx, ev({ key: "evidence:X" }));
  check("F1. WORK_A's evidence:X wakes WORK_B only", wakeB.length === 1 && wakeB[0] === "WORK_B", wakeB);
  const wakeC = affectedWorkIds(cIdx, ev({ key: "resource:Y", source: "registry" }));
  check("F2. WORK_B's resource:Y then wakes WORK_C — same index, no manual orchestration",
    wakeC.length === 1 && wakeC[0] === "WORK_C", wakeC);
  check("F3. WORK_C's own wake is eligible",
    evaluate(chain[1], ev({ key: "resource:Y" }), NONE, "rev-1", null).verdict === "RESUME_ELIGIBLE");

  // ---- resume conditions ----
  const two = work({ blocked_on: ["evidence:A", "evidence:B"] });
  check("G1. ALL_AVAILABLE stays blocked while one key is missing",
    evaluate(two, ev({ key: "evidence:A" }), NONE, "rev-1", null).verdict === "STILL_BLOCKED");
  check("G2. ALL_AVAILABLE resumes once the last key arrives",
    evaluate(two, ev({ key: "evidence:B" }), new Set(["evidence:A"]), "rev-1", null).verdict === "RESUME_ELIGIBLE");
  check("G3. ANY_AVAILABLE resumes on the first key",
    evaluate(work({ blocked_on: ["evidence:A", "evidence:B"], resume_condition: "ANY_AVAILABLE" }),
      ev({ key: "evidence:A" }), NONE, "rev-1", null).verdict === "RESUME_ELIGIBLE");
  const exact = work({ blocked_on: ["runtime:port:5178"], resume_condition: "EXACT_STATE",
    exact_state: { key: "runtime:port:5178", equals: "LISTENING" } });
  check("G4. EXACT_STATE requires the exact value",
    evaluate(exact, ev({ key: "runtime:port:5178", value: "CLOSED" }), NONE, "rev-1", null).verdict === "STILL_BLOCKED");
  check("G5. EXACT_STATE resumes on the exact value",
    evaluate(exact, ev({ key: "runtime:port:5178", value: "LISTENING" }), NONE, "rev-1", null).verdict === "RESUME_ELIGIBLE");

  // ---- OWNER_DECISION and financial authority ----
  const owner = work({ resume_condition: "OWNER_DECISION", blocked_on: ["owner:decision:buy-seat"] });
  check("H1. OWNER_DECISION is never satisfied by an event",
    evaluate(owner, ev({ key: "owner:decision:buy-seat", source: "registry" }), NONE, "rev-1", null).verdict === "OWNER_DECISION_REQUIRED");
  check("H2. not even when every key is already satisfied — no AI financial authority",
    evaluate(owner, ev({ key: "owner:decision:buy-seat" }), new Set(["owner:decision:buy-seat"]), "rev-1", null).verdict === "OWNER_DECISION_REQUIRED");

  // ---- loop safety bound ----
  check("I1. exhausted retry budget escalates to the Owner rather than looping",
    evaluate(work({ resume_attempt_count: MAX_RESUME_ATTEMPTS }), ev(), NONE, "rev-1", null).verdict === "OWNER_DECISION_REQUIRED");
  check("I2. terminal rows are never re-woken",
    evaluate(work({ status: "RESUMED" }), ev(), NONE, "rev-1", null).verdict === "STILL_BLOCKED");
  check("I3. terminal rows are excluded from the index entirely",
    buildIndex([work({ work_id: "done", status: "RESUMED" })], "t").indexed_work === 0);

  // ---- append-only persistence ----
  appendWaiting(work({ work_id: "work-A", status: "RESUMED", resume_attempt_count: 1 }), path);
  check("J1. a correction is APPENDED, history is not rewritten", loadWaiting(path).length === 2);
  check("J2. the current row is the LAST one for that work_id",
    currentWaiting(path).find((r) => r.work_id === "work-A")!.status === "RESUMED");
  check("J3. digestOf is stable for equal input", digestOf({ a: 1 }) === digestOf({ a: 1 }));
  check("J4. digestOf separates different input", digestOf({ a: 1 }) !== digestOf({ a: 2 }));
  rmSync(dir, { recursive: true, force: true });
}

main();
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
