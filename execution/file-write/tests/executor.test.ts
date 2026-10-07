/**
 * หน้าที่: the real test for ../executor.ts. Proves Owner's required
 * cases (2026-08-19): execution with no gate decision -> refused;
 * forged/mismatched decision_id -> refused; a real ALLOW_CREATE decision
 * actually writes a real file and records a real, traceable audit event.
 * Real writes land under this folder's own tests/__sandbox__/ so no other
 * capability's files are ever touched by this test.
 *
 * How to run: npx tsx execution/file-write/tests/executor.test.ts
 */

import { executeFileWrite } from "../contract";
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

const SANDBOX_TARGET = "execution/file-write/tests/__sandbox__/executor-test-output.txt";

function baseIntent(overrides: Partial<WriteIntent> = {}): WriteIntent {
  return {
    intent_id: `wi_exec_test_${Math.random().toString(36).slice(2)}`,
    operation: "CREATE",
    capability: "test-sandbox",
    target_type: "FILE",
    target_path: SANDBOX_TARGET,
    requested_change: "write a real sandbox test file",
    requesting_agent: { identity_id: "identity-exec-test", kind: "ai_agent", display_name: "test-ai" },
    evidence: [],
    correlation_id: `corr_exec_test_${Math.random().toString(36).slice(2)}`,
    submitted_at: new Date().toISOString(),
    ...overrides,
  };
}

function baseRequest(overrides: Partial<FileWriteRequest> = {}): FileWriteRequest {
  return {
    correlation_id: "corr_exec_test",
    intent_id: "wi_exec_test",
    gate_decision_id: "decision_exec_test",
    operation: "CREATE",
    target_type: "FILE",
    target_path: SANDBOX_TARGET,
    content: "real sandbox content",
    requesting_identity_id: "identity-exec-test",
    ...overrides,
  };
}

function run(): void {
  console.log("=== execution/file-write/tests/executor.test.ts ===");

  // Test isolation: this suite's own CREATE case requires the sandbox target to be absent
  // beforehand (a real repeated-CREATE-refusal is a separate, already-covered behavior, not
  // what this run is testing) — cleaned up directly via fs, never through the gated executor.
  const sandboxAbsolutePath = joinPath(repoRootDirname(), SANDBOX_TARGET);
  if (fsCleanup.existsSync(sandboxAbsolutePath)) fsCleanup.unlinkSync(sandboxAbsolutePath);

  // 1. no gate decision -> refused.
  {
    const result = executeFileWrite(baseRequest(), undefined);
    assert(result.status === "refused", "no decision -> refused");
    assert(result.refusal_code === "NO_GATE_DECISION", `expected NO_GATE_DECISION, got ${result.refusal_code}`);
    console.log("PASS: no gate decision -> refused (NO_GATE_DECISION)");
  }

  // 2. forged/mismatched decision_id -> refused.
  {
    const emptyContext: WriteGateContext = { registryIndex: [] };
    const realDecision = evaluateWriteIntent(baseIntent({ target_path: "connections/some-other-real-target/x.ts" }), emptyContext);
    // Request claims a DIFFERENT decision_id than the one actually issued — a forged/stale reference.
    const forgedRequest = baseRequest({ gate_decision_id: "forged-decision-id-that-was-never-issued", intent_id: realDecision.intent_id });
    const result = executeFileWrite(forgedRequest, realDecision);
    assert(result.status === "refused", "mismatched decision_id -> refused");
    assert(result.refusal_code === "GATE_DECISION_MISMATCH", `expected GATE_DECISION_MISMATCH, got ${result.refusal_code}`);
    console.log("PASS: forged/mismatched gate_decision_id -> refused (GATE_DECISION_MISMATCH)");
  }

  // 3. a decision that is not ALLOW_* for this operation -> refused, never proceeds.
  {
    const emptyContext: WriteGateContext = { registryIndex: [] };
    const denyIntent = baseIntent({ target_path: "" }); // malformed -> DENY
    const denyDecision = evaluateWriteIntent(denyIntent, emptyContext);
    assert(denyDecision.decision === "DENY", "sanity: gate really denied this intent");
    const request = baseRequest({ intent_id: denyIntent.intent_id, gate_decision_id: denyDecision.decision_id });
    const result = executeFileWrite(request, denyDecision);
    assert(result.status === "refused" && result.refusal_code === "GATE_DECISION_NOT_ALLOW", "a DENY decision never reaches a real write");
    console.log("PASS: DENY decision -> refused (GATE_DECISION_NOT_ALLOW), no write attempted");
  }

  // 4. a real ALLOW_CREATE decision actually writes a real file and records a traceable audit chain.
  {
    const emptyContext: WriteGateContext = { registryIndex: [] };
    const intent = baseIntent({ target_path: SANDBOX_TARGET });
    const decision = evaluateWriteIntent(intent, emptyContext);
    assert(decision.decision === "ALLOW_CREATE", `sanity: expected ALLOW_CREATE, got ${decision.decision}`);

    const request = baseRequest({ intent_id: intent.intent_id, gate_decision_id: decision.decision_id, content: `real content written ${new Date().toISOString()}` });
    const result = executeFileWrite(request, decision);
    assert(result.status === "completed", `expected completed, got ${result.status} (${result.refusal_code})`);
    assert(result.resolved_path !== null, "a real resolved_path is returned");
    assert(fileExistsReal(joinPath(repoRootDirname(), SANDBOX_TARGET)), "the file genuinely exists on disk after a completed write");
    const onDisk = readFileReal(joinPath(repoRootDirname(), SANDBOX_TARGET));
    assert(onDisk === request.content, "the real on-disk content exactly matches what was requested");

    // Full chain trace-back: audit log has a record whose IDs match this exact write.
    const audit = listWriteAudit();
    const matching = audit.find((e) => e.write_id === result.write_id);
    assert(matching !== undefined, "a real audit record exists for this write_id");
    assert(matching!.intent_id === intent.intent_id, "audit record traces back to the real intent_id");
    assert(matching!.gate_decision_id === decision.decision_id, "audit record traces back to the real gate_decision_id");
    assert(matching!.requesting_identity_id === "identity-exec-test", "audit record traces back to the real requesting_identity_id");
    console.log("PASS: valid ALLOW_CREATE decision -> real file written on disk, real traceable audit record");
  }

  console.log("=== ALL execution/file-write executor.test.ts CASES PASSED ===");
}

try {
  run();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}
