/**
 * หน้าที่: proves the Round 1 Deploy plan/gate layer never claims a real
 * deploy happened, for any delivery target class.
 *
 * How to run: npx tsx execution/deploy/tests/deploy.test.ts
 */

import { resolveDeployPlan } from "../contract";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
function check(name: string, body: () => void): void {
  try {
    body();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

check("A. IN_PROCESS_LOCAL -> NOT_APPLICABLE", () => {
  const result = resolveDeployPlan({ capability_id: "capability-x", delivery_target_class: "IN_PROCESS_LOCAL", correlation_id: "c1" });
  assert(result.status === "NOT_APPLICABLE", `expected NOT_APPLICABLE, got ${result.status}`);
});

check("B. LOCAL_MACOS_OWNER_HOST_PROCESS -> BLOCKED, cites governance/release-gate/", () => {
  const result = resolveDeployPlan({ capability_id: "capability-x", delivery_target_class: "LOCAL_MACOS_OWNER_HOST_PROCESS", correlation_id: "c2" });
  assert(result.status === "BLOCKED", `expected BLOCKED, got ${result.status}`);
  assert(result.blocked_on.includes("governance/release-gate/README.md"), "must cite real release-gate boundary");
});

check("C. HOSTED_SERVICE -> BLOCKED, cites governance/release-gate/ and connections/vercel/", () => {
  const result = resolveDeployPlan({ capability_id: "capability-x", delivery_target_class: "HOSTED_SERVICE", correlation_id: "c3" });
  assert(result.status === "BLOCKED", `expected BLOCKED, got ${result.status}`);
  assert(result.blocked_on.includes("connections/vercel/README.md"), "must cite real vercel boundary");
  assert(result.blocked_on.includes("connections/vercel/CHECKS_API_LIVE_TEST_PLAN.md"), "must cite the real live-test precondition");
});

check("D. UNRESOLVED delivery target -> BLOCKED, never NOT_APPLICABLE", () => {
  const result = resolveDeployPlan({ capability_id: "capability-x", delivery_target_class: "UNRESOLVED", correlation_id: "c4" });
  assert(result.status === "BLOCKED", `expected BLOCKED, got ${result.status}`);
});

check("E. no status value ever implies a real deploy happened", () => {
  const statuses = new Set(["BLOCKED", "NOT_APPLICABLE"]);
  for (const cls of ["IN_PROCESS_LOCAL", "LOCAL_MACOS_OWNER_HOST_PROCESS", "HOSTED_SERVICE", "UNRESOLVED"] as const) {
    const result = resolveDeployPlan({ capability_id: "capability-x", delivery_target_class: cls, correlation_id: "c5" });
    assert(statuses.has(result.status), `unexpected status ${result.status} for ${cls}`);
  }
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
