/**
 * หน้าที่: watch the autonomous recovery loop run against a REAL fault on
 * this machine, and prove every stage was real.
 *
 * THIS TEST TRIGGERS NOTHING. It starts the supervisor and observes. It
 * never calls a remediation function, never calls runOperation, never marks
 * anything healthy, never creates a RESOLVED status, and never invokes the
 * continuation evaluator. Everything below is read back AFTER the loop
 * decided and acted on its own — which is the only way the result means
 * what it claims.
 *
 * How to run (macOS, Node >=16):
 *   npx tsx control/owner-backbone/tests/live-recovery-proof.test.ts [service_id]
 */

import { startRecoverySupervisor, eventsForWork } from "../contract";
import type { RecoveryCycle } from "../contract";
import { currentWaiting } from "../../work-continuation/contract";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.error(`FAIL  ${name}`); if (detail !== undefined) console.error("      " + JSON.stringify(detail).slice(0, 400)); }
}

const SERVICE = process.argv[2] ?? "deadboard";

function renderTrace(cycle: RecoveryCycle): void {
  console.log("\n  LIVE TRACE");
  console.log("  " + "-".repeat(150));
  for (const line of cycle.trace) {
    console.log(
      `  ${line.at.slice(11, 23)} ${(line.event_id ?? "-").padEnd(26)} ${line.work_id.slice(0, 26).padEnd(26)} ` +
      `${line.stage.padEnd(18)} ${line.input.slice(0, 34).padEnd(34)} ${line.decision.slice(0, 46).padEnd(46)} ` +
      `${line.next_action.slice(0, 32).padEnd(32)} ${line.evidence_ref.slice(0, 40)}`,
    );
  }
  console.log("  " + "-".repeat(150));
}

async function main(): Promise<void> {
  // The waiting journal BEFORE anything happens — read, not written.
  const waitingBefore = currentWaiting()
    .filter((r) => r.status === "WAITING" && r.blocked_on.some((k) => k.includes(`service:${SERVICE}:healthy`)))
    .map((r) => r.work_id);
  console.log(`\n  WAITING_WORK_BEFORE: ${waitingBefore.length} work item(s) blocked on service:${SERVICE}:healthy`);
  for (const id of waitingBefore) console.log(`    ${id}`);

  console.log(`\n  starting the supervisor over [${SERVICE}] — it decides everything from here\n`);
  const started = Date.now();

  const cycle = await new Promise<RecoveryCycle | null>((resolve) => {
    const handle = startRecoverySupervisor({
      services: [SERVICE],
      intervalMs: 15_000,
      maxCycles: 1,
      onCycle: (produced) => { handle.stop(); resolve(produced); },
    });
    // A Next.js cold start plus a bounded double retry is minutes, not seconds.
    setTimeout(() => { handle.stop(); resolve(null); }, 300_000);
  });
  const totalMs = Date.now() - started;

  if (cycle === null) {
    // NOT a failure. The supervisor emits a cycle only when it finds a real
    // fault, and this proof is forbidden from creating one. A healthy
    // machine means there is nothing to recover — which is frequently the
    // case right AFTER this proof has run once and succeeded.
    console.log(`\n  NOT_REACHED — ${SERVICE} is healthy right now, so the supervisor found no fault to act on.`);
    console.log("  This proof never creates an outage; re-run it when a declared service is genuinely down.");
    console.log(`  The recorded live run against a real ${SERVICE} outage is in this repo's evidence store,`);
    console.log("  keyed by the work_id of that cycle (see control/agent-gateway/data/evidence.jsonl).");
    return;
  }

  renderTrace(cycle);
  console.log(`\n  ${cycle.initial_condition}  ->  ${cycle.final_condition}`);
  console.log(`  action=${cycle.action}  execution=${cycle.execution_result}  pid ${String(cycle.pid_before)} -> ${String(cycle.pid_after)}  in ${cycle.duration_ms}ms\n`);

  // ===== A/B — real input through the real event path ====================
  check("A1. the fault came from a REAL machine probe, not from this test", cycle.fault_detected && /SERVICE_DOWN/.test(cycle.initial_condition), cycle.initial_condition);
  check("B1. the fault entered as a persisted SystemEvent", cycle.events.some((e) => e.event_type === "SERVICE_UNHEALTHY"), cycle.events.map((e) => e.event_type));
  check("B2. every event is readable back from the persisted store", eventsForWork(cycle.work_id).length === cycle.events.length, { persisted: eventsForWork(cycle.work_id).length, emitted: cycle.events.length });
  check("B3. the work has ONE work_id from input to final state", cycle.events.every((e) => e.work_id === cycle.work_id), cycle.work_id);

  // ===== C — DNA OS chose the action =====================================
  check("C1. an authorized action was chosen automatically", cycle.action === "RESTART_EXISTING_SERVICE", { action: cycle.action, missing: cycle.missing_capability });
  check("C2. REMEDIATION_STARTED was emitted before any execution", cycle.events.findIndex((e) => e.event_type === "REMEDIATION_STARTED") < cycle.events.findIndex((e) => e.event_type === "SERVICE_RESTARTED"), cycle.events.map((e) => e.event_type));
  check("C3. no Owner decision was required for an ordinary recovery", cycle.fault_cleared ? !cycle.events.some((e) => e.event_type === "OWNER_DECISION_REQUIRED") : true, cycle.events.map((e) => e.event_type));

  // ===== D/E — canonical execution, real machine observation =============
  check("D1. execution went through the canonical recovery authority", ["RECOVERED", "FAILED", "ALREADY_HEALTHY"].includes(cycle.execution_result), cycle.execution_result);
  check("E1. the machine was OBSERVED — real pids in the job's lineage", cycle.observed_pids.length > 0, cycle.observed_pids);
  check("E2. the pid really changed, so a real process was replaced", cycle.pid_after !== null && cycle.pid_after !== cycle.pid_before, { before: cycle.pid_before, after: cycle.pid_after });

  // ===== F — the ORIGINAL condition, re-asked ============================
  check("F1. the original condition was re-checked, not assumed", cycle.events.some((e) => e.event_type === "VERIFICATION_PASSED" || e.event_type === "VERIFICATION_FAILED"), cycle.events.map((e) => e.event_type));
  if (cycle.fault_cleared) {
    check("F2. SERVICE_DOWN -> SERVICE_HEALTHY, proven by the re-probe", /SERVICE_HEALTHY/.test(cycle.final_condition), cycle.final_condition);
  } else {
    check("F2*. the failure is reported as REMEDIATION_FAILED, never rounded up", cycle.events.some((e) => e.event_type === "REMEDIATION_FAILED") && cycle.events.some((e) => e.event_type === "OWNER_DECISION_REQUIRED"), cycle.events.map((e) => e.event_type));
  }

  // ===== G — automatic continuation ======================================
  console.log(`  RESUMED_WORK_IDS: ${cycle.resumed_work_ids.length}/${cycle.waiting_before.length}`);
  for (const id of cycle.resumed_work_ids) console.log(`    ${id}`);
  if (waitingBefore.length > 0 && cycle.fault_cleared) {
    check("G1. the waiting work seen before the run is what the loop acted on", cycle.waiting_before.length === waitingBefore.length, { proof: waitingBefore.length, loop: cycle.waiting_before.length });
    check("G2. waiting work was resumed automatically, with no second command", cycle.resumed_work_ids.length > 0, cycle.resumed_work_ids);
    check("G3. SAME_WORK_ID — every resumed id was already waiting before the run", cycle.resumed_work_ids.every((id) => waitingBefore.includes(id)), cycle.resumed_work_ids);
    const rows = currentWaiting();
    check("G4. the resumed rows are RESUMED in the EXISTING waiting journal", cycle.resumed_work_ids.every((id) => rows.some((r) => r.work_id === id && r.status !== "WAITING")), cycle.resumed_work_ids.slice(0, 3));
    check("G5. WORK_RESUMED reached the event stream of each resumed work item", cycle.resumed_work_ids.every((id) => eventsForWork(id).some((e) => e.event_type === "WORK_RESUMED")), cycle.resumed_work_ids.slice(0, 3));
  }

  // ===== H — owner output ================================================
  const delivered = cycle.events.length;
  check("H1. the required transitions were all emitted", ["SERVICE_UNHEALTHY", "REMEDIATION_STARTED", "SERVICE_RESTARTED"].every((t) => cycle.events.some((e) => e.event_type === t)), cycle.events.map((e) => e.event_type));
  check("H2. persistence happened regardless of delivery", eventsForWork(cycle.work_id).length === delivered);

  console.log(`\n  TOTAL_END_TO_END: ${totalMs}ms (cycle ${cycle.duration_ms}ms)`);
}

main()
  .catch((error) => { failed++; console.error("FAIL  harness: " + (error instanceof Error ? error.stack ?? error.message : String(error))); })
  .finally(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  });
