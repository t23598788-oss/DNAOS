/**
 * หน้าที่: PHASE 8 proof — ../write-result-registration.ts's
 * `toRegistrationCandidate()`/`isTemporaryWorkspaceArtifact()`.
 *
 * Proves: (1) failed/refused writes, DENY/REUSE_EXISTING/UNKNOWN
 * decisions, missing evidence, and temporary workspace artifacts are all
 * honestly refused registration — never falsely registered; (2) a
 * genuinely eligible write DOES become a real RegistrationCandidate that
 * the real, unmodified registration pipeline genuinely registers — the
 * "no orphan" mechanism is proven real, not merely typed; (3) the real
 * production adapter (`control/agent-gateway/adapters/ai-write-adapter.ts`),
 * exercised through its own real `aiWriteAdapter.execute()`, correctly
 * reports NOT eligible for the ONLY WorkOrder shape this system can
 * currently produce (sandbox-confined) — proving today's real system
 * never falsely registers a temporary sandbox artifact.
 *
 * How to run: npx tsx control/ai-write-control/tests/write-result-registration.test.ts
 */

import { isTemporaryWorkspaceArtifact, toRegistrationCandidate } from "../contract";
import type { WriteResultForRegistration } from "../contract";
import { runRegistrationPipeline } from "../../registration-pipeline/contract";
import { createLocalFileStore } from "../../../software/registry-database/adapters/local-file-store";
import { findResourceById } from "../../../software/registry-database/contract";
import { aiWriteAdapter } from "../../agent-gateway/adapters/ai-write-adapter";
import type { ExecutionRequest, WorkOrder } from "../../agent-gateway/types";

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
const EVIDENCE = "control/ai-write-control/tests/write-result-registration.test.ts";

function baseInput(overrides: Partial<WriteResultForRegistration> = {}): WriteResultForRegistration {
  return {
    write: { write_id: `write-${uniq}`, correlation_id: `corr-${uniq}`, intent_id: `intent-${uniq}`, gate_decision_id: `decision-${uniq}`, status: "completed", refusal_code: null, resolved_path: `/tmp/does-not-matter-${uniq}`, bytes_written: 42, completed_at: new Date().toISOString() },
    decision: { decision: "ALLOW_CREATE", intent_id: `intent-${uniq}`, reason_codes: ["POLICY_MATCH"], evidence: [], canonical: null, decision_id: `decision-${uniq}`, correlation_id: `corr-${uniq}`, decided_at: new Date().toISOString() },
    target_path: `software/write-result-registration-fixture/real-${uniq}.ts`,
    requesting_identity_id: "agent-gateway-ai-write",
    requested_change: "test fixture — proves the file-write orphan gap is closed",
    evidence: [{ source: EVIDENCE, note: "test fixture" }],
    ...overrides,
  };
}

async function main() {
  await check("A. a genuine completed write + real ALLOW_CREATE decision + a real, non-sandbox target_path -> eligible, real RegistrationCandidate shape", () => {
    const result = toRegistrationCandidate(baseInput());
    assert(result.eligible, `expected eligible, got ${result.eligible ? "" : result.reason}`);
    assert(result.eligible && result.candidate.resource_type === "SOURCE_REFERENCE", "expected a SOURCE_REFERENCE candidate");
    assert(result.eligible && result.candidate.kind === "resource", "expected kind=resource");
  });

  await check("B. write.status=refused -> never registered", () => {
    const result = toRegistrationCandidate(baseInput({ write: { ...baseInput().write, status: "refused", refusal_code: "FS_ERROR" } }));
    assert(!result.eligible, "a refused write must never be eligible");
    assert(result.reason.includes("refused") || result.reason.includes("write.status"), `expected an honest refusal reason, got ${result.reason}`);
  });

  await check("C. decision.decision=DENY -> never registered", () => {
    const result = toRegistrationCandidate(baseInput({ decision: { ...baseInput().decision, decision: "DENY" } }));
    assert(!result.eligible, "a DENY decision must never be eligible");
  });

  await check("D. decision.decision=REUSE_EXISTING -> never registered (this write did not create anything new)", () => {
    const result = toRegistrationCandidate(baseInput({ decision: { ...baseInput().decision, decision: "REUSE_EXISTING" } }));
    assert(!result.eligible, "a REUSE_EXISTING decision must never be eligible for a NEW registration");
  });

  await check("E. a temporary workspace artifact (tests/__sandbox__/...) -> honestly never registered as a canonical capability", () => {
    assert(isTemporaryWorkspaceArtifact("tests/__sandbox__/some-agent/file.ts"), "expected the real sandbox root to be classified as temporary");
    const result = toRegistrationCandidate(baseInput({ target_path: "tests/__sandbox__/some-agent/file.ts" }));
    assert(!result.eligible, "a sandbox artifact must never be eligible");
    assert(result.reason.includes("temporary workspace artifact"), `expected the honest sandbox reason, got ${result.reason}`);
  });

  await check("F. no real evidence supplied -> never registered", () => {
    const result = toRegistrationCandidate(baseInput({ evidence: [] }));
    assert(!result.eligible, "a write with zero evidence must never be eligible");
  });

  await check("G. REQUIRED PROOF — an eligible candidate, run through the real, unmodified registration pipeline, produces a genuine REGISTERED resource, closing the orphan gap for real", () => {
    const store = createLocalFileStore();
    const eligibility = toRegistrationCandidate(baseInput());
    assert(eligibility.eligible, "setup must be eligible");
    const result = runRegistrationPipeline(eligibility.eligible ? eligibility.candidate : (null as never), store, `corr-g-${uniq}`);
    assert(result.status === "REGISTERED", `expected REGISTERED, got ${result.status}: ${JSON.stringify(result)}`);
    const resource = findResourceById((result as { resource_id: string }).resource_id, store);
    assert(resource !== null, "the real resource must be findable in the real store — no orphan");
  });

  await check("H. REAL PRODUCTION PROOF — the real ai-write-adapter, exercised through its own real execute(), correctly reports NOT eligible for the only WorkOrder shape this system can currently produce (sandbox-confined) — never a false registration of today's real writes", async () => {
    const targetPath = `tests/__sandbox__/write-result-registration-proof-${uniq}/file.ts`;
    const workOrder: WorkOrder = {
      operation: "CREATE",
      target_type: "FILE",
      target_path: targetPath,
      requested_change: "real end-to-end proof of the orphan-gap boundary",
      content: `// real end-to-end proof ${uniq}\n`,
      workspace_scope: `tests/__sandbox__/write-result-registration-proof-${uniq}/`,
      mode: "sandbox",
      required_tests: ["sandbox.write"],
      forbidden_files: [],
      evidence: [{ source: EVIDENCE, note: "real end-to-end proof" }],
    };
    const request: ExecutionRequest = {
      task_id: `task-write-result-registration-proof-${uniq}`,
      capability: { capability_id: "ai-write-control-adapter", problem_type: "code_change_work_order", source: "control/command-router" },
      adapter_id: "ai-write-control-adapter",
      input: { work_order: workOrder },
    };
    const result = await aiWriteAdapter.execute(request);
    assert(result.ok === true, `expected the real sandbox write itself to succeed, got ok=${result.ok} error=${(result as { error?: string }).error}`);
    const output = result.output as { registration_eligibility: string; registration: unknown };
    assert(output.registration_eligibility.includes("temporary workspace artifact"), `expected an honest sandbox-artifact refusal, got ${output.registration_eligibility}`);
    assert(output.registration === null, "today's real, only-possible sandbox write must never produce a real registration");

    // Clean up the real file this real adapter really wrote.
    const fs = await import("node:fs/promises");
    await fs.rm(`tests/__sandbox__/write-result-registration-proof-${uniq}`, { recursive: true, force: true });
  });

  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("FATAL", error);
  process.exitCode = 1;
});
