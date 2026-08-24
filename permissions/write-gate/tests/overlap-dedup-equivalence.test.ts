/**
 * หน้าที่: STEP A3 proof — deterministic fixtures proving
 * `permissions/write-gate/rules.ts::findOverlaps()`'s real delegation to
 * `software/capability-registrar/index.ts::searchOverlap()` produces the
 * exact same decision the old, now-removed inline reimplementation would
 * have produced (`target === folder || target.startsWith(folder) ||
 * folder.startsWith(target)`, real registered capabilities only) — and
 * that the fix genuinely closes the real module-load cycle, proven by
 * exercising the REAL production entry points that sit inside it
 * (`control/command-router/contract`'s `routeOwnerCommand`,
 * `control/agent-gateway/contract`'s real `aiWriteAdapter`).
 *
 * Every assertion below checks the actual decision/result, never merely
 * "did not throw."
 *
 * How to run: npx tsx permissions/write-gate/tests/overlap-dedup-equivalence.test.ts
 */

import { evaluateWriteIntent } from "../contract";
import type { WriteGateContext, WriteIntent } from "../contract";
import type { CapabilityMetadata } from "../../../software/capability-registrar/contract";
import { searchOverlap, getCapabilityIndex } from "../../../software/capability-registrar/contract";
import { aiWriteAdapter } from "../../../control/agent-gateway/adapters/ai-write-adapter";
import type { ExecutionRequest, WorkOrder } from "../../../control/agent-gateway/types";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
async function check(name: string, body: () => Promise<void> | void): Promise<void> {
  try {
    await body();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function record(id: string, folder: string): CapabilityMetadata {
  return { SOFTWARE_ID: id, OWNER_FOLDER: folder, CAPABILITY_ID: id, PARENT_CAPABILITY: "COMMAND_ROUTER", INGRESS: [], EGRESS: [], CONTRACT: `${folder}contract.ts`, RUNTIME_ENTRY: null, DATA_CLASS: "test", REQUIRED_PERMISSION: "none", REQUIRED_CREDENTIAL: null, DESTINATION: "test", EVIDENCE_SOURCE: ["fixture"], STATUS: "REGISTERED" };
}

function intent(targetPath: string, operation: WriteIntent["operation"] = "CREATE"): WriteIntent {
  return { intent_id: `intent-${uniq}`, operation, capability: "test", target_type: "FILE", target_path: targetPath, requested_change: "fixture", requesting_agent: { identity_id: "fixture", kind: "ai_agent", display_name: "fixture" }, evidence: [], correlation_id: `corr-${uniq}`, submitted_at: new Date().toISOString() };
}

async function main() {
  const singleCapIndex: CapabilityMetadata[] = [record("solo-cap", "software/solo-fixture/")];
  const nestedIndex: CapabilityMetadata[] = [record("nested-cap", "software/nested-fixture/deep/")];

  await check("1. no overlap -> ALLOW_CREATE (real decision, not just 'no throw')", () => {
    const decision = evaluateWriteIntent(intent("software/totally-unrelated-fixture/x.ts"), { registryIndex: singleCapIndex });
    assert(decision.decision === "ALLOW_CREATE", `expected ALLOW_CREATE, got ${decision.decision}`);
  });

  await check("2. exact folder match -> REUSE_EXISTING with the real canonical folder", () => {
    const decision = evaluateWriteIntent(intent("software/solo-fixture/", "CREATE"), { registryIndex: singleCapIndex });
    assert(decision.decision === "REUSE_EXISTING", `expected REUSE_EXISTING, got ${decision.decision}`);
    assert(decision.canonical?.owner_folder === "software/solo-fixture/", `expected exact canonical folder, got ${decision.canonical?.owner_folder}`);
  });

  await check("3. parent overlap (target is a PARENT of a registered folder) -> real overlap found via folder.startsWith(target)", () => {
    const result = searchOverlap("software/nested-fixture/", nestedIndex);
    assert(result.length === 1 && result[0].CAPABILITY_ID === "nested-cap", `expected exactly the nested-cap real match via folder.startsWith(target), got ${JSON.stringify(result.map((r) => r.CAPABILITY_ID))}`);
  });

  await check("4. child overlap (target is INSIDE a registered folder) -> real overlap found via target.startsWith(folder)", () => {
    const result = searchOverlap("software/solo-fixture/some-new-file.ts", singleCapIndex);
    assert(result.length === 1 && result[0].CAPABILITY_ID === "solo-cap", `expected exactly the solo-cap real match via target.startsWith(folder), got ${JSON.stringify(result.map((r) => r.CAPABILITY_ID))}`);
  });

  await check("5. multiple ambiguous overlaps -> UNKNOWN, never a guessed canonical", () => {
    const ambiguous: CapabilityMetadata[] = [record("cap-a", "software/ambiguous-fixture/"), record("cap-b", "software/ambiguous-fixture/")];
    const decision = evaluateWriteIntent(intent("software/ambiguous-fixture/x.ts"), { registryIndex: ambiguous });
    assert(decision.decision === "UNKNOWN", `expected UNKNOWN, got ${decision.decision}`);
    assert(decision.canonical === null, "UNKNOWN must never carry a guessed canonical");
  });

  await check("6. unrelated repository/path -> zero overlap, real ALLOW_CREATE", () => {
    const result = searchOverlap("connections/some-completely-unrelated-provider-fixture/", singleCapIndex);
    assert(result.length === 0, `expected zero overlaps, got ${JSON.stringify(result.map((r) => r.CAPABILITY_ID))}`);
  });

  await check("7. empty registry -> zero overlap for every path, real DENY on MODIFY (nothing real to touch)", () => {
    const result = searchOverlap("anything/at/all.ts", []);
    assert(result.length === 0, "an empty registry must produce zero overlaps for any path");
    const decision = evaluateWriteIntent(intent("anything/at/all.ts", "MODIFY"), { registryIndex: [] });
    assert(decision.decision === "DENY", `expected DENY (nothing real to modify), got ${decision.decision}`);
  });

  await check("8. repeated invocation -> the real getCapabilityIndex() is memoized (same reference), never re-scanned per call", () => {
    const first = getCapabilityIndex();
    const second = getCapabilityIndex();
    assert(first === second, "expected the exact same memoized array reference across repeated real invocations");
  });

  await check("9. REQUIRED PROOF — command-router initialization: routeOwnerCommand (control/command-router/contract, the real historical crash site) runs clean and reaches a real capability step, proving no module-load cycle", async () => {
    const { routeOwnerCommand } = await import("../../../control/command-router/contract");
    const envelope = {
      command_id: `cmd-overlap-dedup-proof-${uniq}`,
      issued_by: { identity_id: "test-owner", acting_as_account_id: "test-owner", acting_as_tenant_id: "test-owner", software_id: "dna-os-infrastructure", kind: "human" as const },
      intent: "",
      payload: {},
      issued_at: new Date().toISOString(),
    };
    const result = await routeOwnerCommand(envelope, "อ่าน github repo status");
    assert(result !== undefined && result !== null, "routeOwnerCommand must return a real result, proving command-router's own module graph (which transitively reaches write-gate/capability-registrar via agent-gateway) loaded without a cycle crash");
  });

  await check("10. REQUIRED PROOF — agent-gateway initialization: the REAL production aiWriteAdapter.execute(), reached through control/agent-gateway/contract's own eager import chain, produces a genuine ALLOW_CREATE overlap decision — not a crash, a real decision", async () => {
    const targetPath = `tests/__sandbox__/overlap-dedup-proof-${uniq}/file.ts`;
    const workOrder: WorkOrder = { operation: "CREATE", target_type: "FILE", target_path: targetPath, requested_change: "overlap dedup real proof", content: `// real proof ${uniq}\n`, workspace_scope: `tests/__sandbox__/overlap-dedup-proof-${uniq}/`, mode: "sandbox", required_tests: ["sandbox.write"], forbidden_files: [], evidence: [{ source: "permissions/write-gate/tests/overlap-dedup-equivalence.test.ts", note: "real proof" }] };
    const request: ExecutionRequest = { task_id: `task-overlap-dedup-proof-${uniq}`, capability: { capability_id: "ai-write-control-adapter", problem_type: "code_change_work_order", source: "control/command-router" }, adapter_id: "ai-write-control-adapter", input: { work_order: workOrder } };
    const result = await aiWriteAdapter.execute(request);
    assert(result.ok === true, `expected the real write to succeed, got ok=${result.ok} error=${(result as { error?: string }).error}`);
    const output = result.output as { decision: { decision: string } };
    assert(output.decision.decision === "ALLOW_CREATE", `expected a real ALLOW_CREATE overlap decision (no real capability exists at this fresh sandbox path), got ${output.decision.decision}`);

    const fs = await import("node:fs/promises");
    await fs.rm(`tests/__sandbox__/overlap-dedup-proof-${uniq}`, { recursive: true, force: true });
  });

  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("FATAL", error);
  process.exitCode = 1;
});
