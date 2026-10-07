/**
 * หน้าที่: the real test for ../sandboxed-executor.ts — mirrors
 * ./executor.test.ts's structure exactly (same gate-refusal cases), plus
 * the one case that only exists for the sandboxed variant: a real kernel
 * EPERM when the target falls outside the declared `workspace_scope`,
 * proving the jail is a genuine second, physical barrier and not just a
 * relabeled copy of the in-process gate check.
 *
 * How to run: npx tsx execution/file-write/tests/sandboxed-executor.test.ts
 * (requires Node >=18 for ../../control/agent-host's real
 * `/usr/bin/sandbox-exec` child — macOS only, same as
 * ../../control/agent-host/tests/proof.test.ts)
 */

import { executeFileWriteSandboxed } from "../sandboxed-contract";
import type { FileWriteRequest } from "../contract";
import { listWriteAudit } from "../contract";
import { evaluateWriteIntent } from "../../../permissions/write-gate/contract";
import type { WriteGateContext, WriteIntent } from "../../../permissions/write-gate/contract";
import { fileExistsReal, readFileReal, repoRootDirname, joinPath } from "../host-runtime";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };
declare const require: (id: string) => unknown;
interface NodeFsCleanup {
  existsSync(path: string): boolean;
  unlinkSync(path: string): void;
}
const fsCleanup = require("fs") as NodeFsCleanup;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const SANDBOX_SCOPE = "execution/file-write/tests/__sandbox__/";
const SANDBOX_TARGET = "execution/file-write/tests/__sandbox__/sandboxed-executor-test-output.txt";
// Deliberately OUTSIDE SANDBOX_SCOPE — a real capability folder this write must never reach.
const OUTSIDE_TARGET = "execution/file-write/sandboxed-executor-test-INTRUSION.txt";

function baseIntent(overrides: Partial<WriteIntent> = {}): WriteIntent {
  return {
    intent_id: `wi_sbx_test_${Math.random().toString(36).slice(2)}`,
    operation: "CREATE",
    capability: "test-sandbox",
    target_type: "FILE",
    target_path: SANDBOX_TARGET,
    requested_change: "write a real sandboxed test file",
    requesting_agent: { identity_id: "identity-sbx-test", kind: "ai_agent", display_name: "test-ai" },
    evidence: [],
    correlation_id: `corr_sbx_test_${Math.random().toString(36).slice(2)}`,
    submitted_at: new Date().toISOString(),
    ...overrides,
  };
}

function baseRequest(overrides: Partial<FileWriteRequest> = {}): FileWriteRequest {
  return {
    correlation_id: "corr_sbx_test",
    intent_id: "wi_sbx_test",
    gate_decision_id: "decision_sbx_test",
    operation: "CREATE",
    target_type: "FILE",
    target_path: SANDBOX_TARGET,
    content: "real sandboxed content",
    requesting_identity_id: "identity-sbx-test",
    ...overrides,
  };
}

async function run(): Promise<void> {
  console.log("=== execution/file-write/tests/sandboxed-executor.test.ts ===");

  const sandboxAbsolutePath = joinPath(repoRootDirname(), SANDBOX_TARGET);
  if (fsCleanup.existsSync(sandboxAbsolutePath)) fsCleanup.unlinkSync(sandboxAbsolutePath);
  const outsideAbsolutePath = joinPath(repoRootDirname(), OUTSIDE_TARGET);
  if (fsCleanup.existsSync(outsideAbsolutePath)) fsCleanup.unlinkSync(outsideAbsolutePath);

  // 1. no gate decision -> refused, no sandbox even launched.
  {
    const result = await executeFileWriteSandboxed(baseRequest(), undefined, SANDBOX_SCOPE);
    assert(result.status === "refused", "no decision -> refused");
    assert(result.refusal_code === "NO_GATE_DECISION", `expected NO_GATE_DECISION, got ${result.refusal_code}`);
    console.log("PASS: no gate decision -> refused (NO_GATE_DECISION), no sandbox launched");
  }

  // 2. a real ALLOW_CREATE decision, target INSIDE workspace_scope -> real kernel-confined write succeeds.
  {
    const emptyContext: WriteGateContext = { registryIndex: [] };
    const intent = baseIntent({ target_path: SANDBOX_TARGET });
    const decision = evaluateWriteIntent(intent, emptyContext);
    assert(decision.decision === "ALLOW_CREATE", `sanity: expected ALLOW_CREATE, got ${decision.decision}`);

    const request = baseRequest({ intent_id: intent.intent_id, gate_decision_id: decision.decision_id, content: `real sandboxed content ${new Date().toISOString()}` });
    const result = await executeFileWriteSandboxed(request, decision, SANDBOX_SCOPE);
    assert(result.status === "completed", `expected completed, got ${result.status} (${result.refusal_code})`);
    assert(fileExistsReal(sandboxAbsolutePath), "the file genuinely exists on disk after a completed sandboxed write");
    const onDisk = readFileReal(sandboxAbsolutePath);
    assert(onDisk === request.content, "the real on-disk content, written by the CONFINED CHILD PROCESS, exactly matches what was requested");

    const audit = listWriteAudit();
    const matching = audit.find((e) => e.write_id === result.write_id);
    assert(matching !== undefined, "a real audit record exists for this sandboxed write_id");
    assert(matching!.gate_decision_id === decision.decision_id, "audit record traces back to the real gate_decision_id");
    console.log("PASS: ALLOW_CREATE + in-scope target -> real kernel-confined write on disk, real traceable audit record");
  }

  // 3. a real ALLOW_CREATE decision, target OUTSIDE workspace_scope -> the KERNEL refuses, not just app logic.
  {
    const emptyContext: WriteGateContext = { registryIndex: [] };
    const intent = baseIntent({ target_path: OUTSIDE_TARGET });
    const decision = evaluateWriteIntent(intent, emptyContext);
    assert(decision.decision === "ALLOW_CREATE", `sanity: expected ALLOW_CREATE (the in-process gate has no opinion about workspace_scope), got ${decision.decision}`);

    const request = baseRequest({ target_path: OUTSIDE_TARGET, intent_id: intent.intent_id, gate_decision_id: decision.decision_id });
    // workspace_scope stays SANDBOX_SCOPE — the sandbox is only ever told to allow writes there,
    // regardless of what the (deliberately permissive, for this test) gate decision says.
    const result = await executeFileWriteSandboxed(request, decision, SANDBOX_SCOPE);
    assert(result.status === "refused", `an ALLOW decision for an out-of-scope target must still be BLOCKED by the real sandbox — got ${result.status}`);
    assert(result.refusal_code === "FS_ERROR", `expected FS_ERROR (the sandboxed worker's own real EPERM/ENOENT), got ${result.refusal_code}`);
    assert(!fsCleanup.existsSync(outsideAbsolutePath), "the out-of-scope file was genuinely never created on disk — kernel-enforced, not app-level");
    console.log("PASS: ALLOW_CREATE + OUT-OF-SCOPE target -> real kernel EPERM inside the sandbox, file never created (second, independent barrier proven)");
  }

  console.log("=== ALL execution/file-write sandboxed-executor.test.ts CASES PASSED ===");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
