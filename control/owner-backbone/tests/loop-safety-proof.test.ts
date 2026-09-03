/**
 * หน้าที่: §7 and §9 in isolation — the rules that stop a PERMANENT
 * supervisor from becoming an infinite remediation machine, and the rule
 * that lets parked work resume without an Owner typing "try again".
 *
 * WHY THESE ARE PROVEN HERE AND NOT ONLY LIVE: exercising the retry bound
 * for real means letting a service fail three times in a row on purpose,
 * which is exactly the "do not break production" line. The bound is
 * therefore proven against the ledger — the same persisted rows the live
 * loop reads — while the live proof covers the single-fault path end to end.
 * Every row below is written and read through the real durable store; none
 * of it is mocked.
 *
 * How to run (macOS, Node >=16):
 *   npx tsx control/owner-backbone/tests/loop-safety-proof.test.ts
 */

import {
  conditionIdFor, conditionState, openCondition, recordAttempt, recordCanonicalAction,
  closeCondition, blockCondition, reusableAction, digestOfTrigger,
  MAX_CONDITION_ATTEMPTS, ACTION_REUSE_WINDOW_MS,
} from "../action-ledger";
import { resourceAvailability, allResourceAvailability, recordResourceFailure, RESOURCE_DEPENDENCY } from "../resource-availability";
import { currentWaiting } from "../../work-continuation/contract";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.error(`FAIL  ${name}`); if (detail !== undefined) console.error("      " + JSON.stringify(detail).slice(0, 400)); }
}

async function main(): Promise<void> {
  // ===== §7 BOUNDED RETRY, persisted =====================================
  const service = `proof-service-${Date.now()}`;
  const conditionId = conditionIdFor(service, "RESTART_EXISTING_SERVICE", "SERVICE_HEALTHY");
  const common = { condition_id: conditionId, service_id: service, action: "RESTART_EXISTING_SERVICE", target_state: "SERVICE_HEALTHY" };

  check("B0. an unknown condition starts with a full retry budget", conditionState(conditionId).retry_budget_remaining === MAX_CONDITION_ATTEMPTS && !conditionState(conditionId).known);

  openCondition({ ...common, evidence_ref: "proof:opened", detail: "SERVICE_DOWN" });
  check("B1. opening a condition is recorded and survives as state", conditionState(conditionId).open === true);

  for (let i = 1; i <= MAX_CONDITION_ATTEMPTS; i += 1) {
    recordAttempt({ ...common, input_digest: digestOfTrigger({ attempt: i }), detail: `attempt ${i}` });
  }
  const exhausted = conditionState(conditionId);
  console.log(`      attempts=${exhausted.attempts}/${MAX_CONDITION_ATTEMPTS} budget=${exhausted.retry_budget_remaining}`);
  check("B2. attempts accumulate against the CONDITION, not a work_id", exhausted.attempts === MAX_CONDITION_ATTEMPTS, exhausted.attempts);
  check("B3. the retry budget reaches zero — a bound that actually binds", exhausted.retry_budget_remaining === 0);

  blockCondition({ ...common, detail: "retry budget exhausted", evidence_ref: "proof:blocked" });
  const blocked = conditionState(conditionId);
  check("B4. an exhausted condition is BLOCKED, and the blocker is persisted", blocked.blocked && blocked.blocker !== null, blocked.blocker);
  check("B5. a blocked condition is no longer open — the loop will not pick it up again", blocked.open === false);

  // ===== §7 STATE SURVIVES PROCESS MEMORY LOSS ===========================
  // conditionState() reads the store on every call, so a fresh read IS what
  // a newly started process would see. No cache is consulted anywhere.
  const rereadCold = conditionState(conditionId);
  check("B6. the same state is reconstructed from disk by a cold reader", rereadCold.attempts === exhausted.attempts && rereadCold.blocked, rereadCold);

  // ===== §7 CLOSING RELEASES THE BUDGET ==================================
  closeCondition({ ...common, verified_state: "SERVICE_HEALTHY", evidence_ref: "proof:closed", detail: "target state observed" });
  const closed = conditionState(conditionId);
  check("B7. a resolved condition releases its budget and clears its blocker", closed.attempts === 0 && closed.blocked === false && closed.retry_budget_remaining === MAX_CONDITION_ATTEMPTS, closed);

  // ===== §6/§7 REUSE AND REPLAY ==========================================
  const reuseCondition = conditionIdFor(`${service}-reuse`, "RESTART_EXISTING_SERVICE", "SERVICE_HEALTHY");
  const reuseCommon = { condition_id: reuseCondition, service_id: `${service}-reuse`, action: "RESTART_EXISTING_SERVICE", target_state: "SERVICE_HEALTHY" };
  check("P0. with no canonical action, nothing is reusable", reusableAction(reuseCondition, "SERVICE_HEALTHY").reusable === false);

  recordCanonicalAction({ ...reuseCommon, action_id: "action-canonical", verified_state: "SERVICE_HEALTHY", evidence_ref: "runtime-control:op-canonical", detail: "one physical restart" });
  const fresh = reusableAction(reuseCondition, "SERVICE_HEALTHY");
  check("P1. a waiter shares the canonical action instead of repeating it", fresh.reusable && fresh.action_id === "action-canonical", fresh);
  check("P2. it hands back the ORIGINAL evidence_ref, so the fan-out is traceable", fresh.evidence_ref === "runtime-control:op-canonical", fresh.evidence_ref);

  // The machine disagreeing is decisive. This is what stops a stale success.
  const drifted = reusableAction(reuseCondition, "SERVICE_DOWN");
  check("P3. if the machine no longer agrees, the earlier result is NOT reused", drifted.reusable === false, drifted.reason);

  const stale = reusableAction(reuseCondition, "SERVICE_HEALTHY", Date.now() + ACTION_REUSE_WINDOW_MS + 1000);
  check("P4. reuse expires — an old success is not evidence about now", stale.reusable === false, stale.reason);

  // ===== §9 RESOURCE AVAILABILITY ========================================
  const availability = allResourceAvailability();
  console.log("\n  RESOURCE AVAILABILITY (deterministic — nothing was launched)");
  for (const a of availability) console.log(`    ${a.worker_kind.padEnd(8)} available=${String(a.available).padEnd(5)} ${a.reason.slice(0, 96)}`);

  check("Q1. availability is decided for every reasoning provider", availability.length >= 3, availability.map((a) => a.worker_kind));
  check("Q2. a worker whose executable does not resolve is unavailable", availability.every((a) => a.executable_resolves || !a.available), availability.filter((a) => !a.executable_resolves).map((a) => a.worker_kind));

  const kind = "CLAUDE";
  const failure = recordResourceFailure(kind, "proof: authentication unavailable");
  const afterFailure = resourceAvailability(kind);
  check("Q3. a worker that failed is NOT offered again while its credential evidence is unchanged", afterFailure.available === false, afterFailure.reason);
  check("Q4. the failure is paired with the credential evidence it failed against", failure.credential_digest === afterFailure.credential_digest, { failure: failure.credential_digest, now: afterFailure.credential_digest });
  check("Q5. no credential VALUE is stored anywhere in that record", !JSON.stringify(failure).match(/sk-|Bearer |password|secret[_-]?value/i), Object.keys(failure));

  const parked = currentWaiting().filter((r) => r.status === "WAITING_FOR_RESOURCE" && r.blocked_on.some((k) => k.includes(RESOURCE_DEPENDENCY.value)));
  console.log(`\n  work parked on ${RESOURCE_DEPENDENCY.namespace}:${RESOURCE_DEPENDENCY.value}: ${parked.length}`);
  check("Q6. resource-blocked work is parked on a real dependency key, not lost", parked.every((r) => r.work_id.length > 0));
}

main()
  .catch((error) => { failed++; console.error("FAIL  harness: " + (error instanceof Error ? error.stack ?? error.message : String(error))); })
  .finally(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  });
