/**
 * หน้าที่: the real test for ../internal-state-adapter.ts — plain
 * assert-based, matching this repo's `npx tsx <file>` convention. Proves:
 * (1) initializeCircuitFromRepo() reflects real, currently-true facts
 * from capability-registry.ts / current-capability-map.json (e.g.
 * VALIDATOR NOT_YET_REAL, IDENTITY/ACCOUNT/WORKSPACE/ENTRY_CONTEXT READY
 * since the 2026-08-16 Account/Workspace gap closure); (2) a real, deliberately
 * unreachable research-engine base URL is reflected as BLOCKED without
 * crashing the adapter or the process — this is a REAL health check
 * against a REAL (empty) port, never a mocked function, exercising the
 * exact same offline-handling discipline as round 2's research-engine
 * connection.
 *
 * How to run: npx tsx dna-os-circuit/adapter/tests/internal-state-adapter.test.ts
 */

import { CircuitState } from "../../runtime/circuit-state";
import { initializeCircuitFromRepo, refreshResearchEngineHealth } from "../internal-state-adapter";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function run(): Promise<void> {
  console.log("=== dna-os-circuit/adapter/internal-state-adapter.test.ts ===");

  // 1. initializeCircuitFromRepo reflects real, verified repo facts.
  {
    const state = new CircuitState();
    await initializeCircuitFromRepo(state);

    const validator = state.getNode("VALIDATOR");
    assert(validator !== undefined && validator.status === "NOT_YET_REAL", `expected VALIDATOR NOT_YET_REAL (no validator module exists in this repo), got ${validator?.status}`);

    const identity = state.getNode("IDENTITY");
    assert(identity !== undefined && identity.status === "READY", `expected IDENTITY READY (permissions/access-control/identity-registry.ts is now a real store), got ${identity?.status}`);

    const account = state.getNode("ACCOUNT");
    assert(account !== undefined && account.status === "READY", `expected ACCOUNT READY (permissions/software-scope/account-registry.ts is a real store), got ${account?.status}`);

    const workspace = state.getNode("WORKSPACE");
    assert(workspace !== undefined && workspace.status === "READY", `expected WORKSPACE READY (permissions/software-scope/workspace-registry.ts is a real store), got ${workspace?.status}`);

    const entryContext = state.getNode("ENTRY_CONTEXT");
    assert(entryContext !== undefined && entryContext.status === "READY", `expected ENTRY_CONTEXT READY (control/entry-context/contract.ts resolveEntryContext is real), got ${entryContext?.status}`);

    const permission = state.getNode("PERMISSION");
    assert(permission !== undefined && permission.status === "READY", `expected PERMISSION READY (permission-reasoner is CONNECTED in capability-registry.ts), got ${permission?.status}`);

    const execution = state.getNode("EXECUTION");
    assert(execution !== undefined && execution.status === "READY", `expected EXECUTION READY (execution is CONNECTED in capability-registry.ts), got ${execution?.status}`);

    console.log("PASS: initializeCircuitFromRepo reflects real capability-registry.ts / contracts facts");
  }

  // 2. a real, deliberately unreachable research-engine base URL resolves to BLOCKED without throwing.
  {
    const state = new CircuitState();
    await initializeCircuitFromRepo(state);

    // Port 8788 is not the real research-engine port (8787) and nothing is expected to listen on it in this test environment — a real TCP connection attempt that will really fail, not a mock.
    let threw = false;
    try {
      await refreshResearchEngineHealth(state, "http://localhost:8788");
    } catch {
      threw = true;
    }
    assert(!threw, "expected refreshResearchEngineHealth to never throw, even when the real health check fails (fail-closed to BLOCKED, not an exception)");

    const processRuntime = state.getNode("EXEC_PROCESS_RUNTIME");
    assert(processRuntime !== undefined && processRuntime.status === "BLOCKED", `expected EXEC_PROCESS_RUNTIME BLOCKED when the real research-engine health check against an unreachable port fails, got ${processRuntime?.status}`);
    assert(processRuntime!.note !== null && processRuntime!.note.includes("OFFLINE"), `expected an honest BLOCKED note mentioning offline, got ${JSON.stringify(processRuntime!.note)}`);

    console.log("PASS: a real unreachable research-engine endpoint is reflected as BLOCKED without crashing the adapter");
  }

  console.log("=== ALL internal-state-adapter.test.ts CASES PASSED ===");
}

run().catch((error) => {
  console.error("FAIL:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
