/**
 * หน้าที่: proves the full real chain Owner spec'd 2026-08-19:
 * "requesting_identity → WriteIntent → registry evidence → gate decision →
 * file-write execution → resulting artifact/change ... ทุก ID ต้อง trace
 * ย้อนกลับได้". Drives the real public contracts of all three new
 * capabilities together (control/ai-write-control/, permissions/write-gate/,
 * execution/file-write/) plus the real software/capability-registrar/
 * index — no mocks, no stubs.
 *
 * How to run: npx tsx execution/file-write/tests/end-to-end.test.ts
 */

import { submitWriteRequest } from "../../../control/ai-write-control/contract";
import type { RawWriteRequest } from "../../../control/ai-write-control/contract";
import { evaluateWriteIntent } from "../../../permissions/write-gate/contract";
import type { WriteGateContext } from "../../../permissions/write-gate/contract";
import { getCapabilityIndex } from "../../../software/capability-registrar/contract";
import { executeFileWrite, listWriteAudit } from "../contract";
import type { EnvelopeIdentity } from "../../../contracts/identity/envelope-identity";
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

const EXTERNAL_AI: EnvelopeIdentity = { identity_id: "e2e-external-ai-01", acting_as_account_id: "acct-e2e", acting_as_tenant_id: "tenant-e2e", software_id: "external-codegen-agent", kind: "ai_agent" };
const SANDBOX_TARGET = "execution/file-write/tests/__sandbox__/end-to-end-output.txt";

function run(): void {
  console.log("=== execution/file-write/tests/end-to-end.test.ts ===");

  const sandboxAbsolutePath = joinPath(repoRootDirname(), SANDBOX_TARGET);
  if (fsCleanup.existsSync(sandboxAbsolutePath)) fsCleanup.unlinkSync(sandboxAbsolutePath);

  // STEP 1: External AI -> AI Write Control -> WriteIntent (real, structural-validation only, no decision made here).
  const raw: RawWriteRequest = {
    operation: "CREATE",
    capability: "e2e-sandbox-capability",
    target_type: "FILE",
    target_path: SANDBOX_TARGET,
    requested_change: "full-chain proof write",
    evidence: [{ source: "e2e test", note: "requester-supplied justification, never trusted as fact by the Gate" }],
  };
  const submitOutcome = submitWriteRequest(raw, EXTERNAL_AI);
  assert(submitOutcome.ok, "step 1: AI Write Control accepts a well-formed request from an ai_agent identity");
  if (!submitOutcome.ok) return;
  const intent = submitOutcome.intent;
  console.log(`STEP 1 OK: WriteIntent ${intent.intent_id} produced from requesting_identity ${intent.requesting_agent.identity_id} (no decision made)`);

  // STEP 2: WriteIntent -> Capability Registry evidence -> Write Gate decision (real registry index, real deterministic rules).
  const context: WriteGateContext = { registryIndex: getCapabilityIndex() };
  const decision = evaluateWriteIntent(intent, context);
  assert(decision.intent_id === intent.intent_id, "step 2: decision traces back to the real intent_id");
  assert(decision.decision === "ALLOW_CREATE", `step 2: sandbox path has no real registered overlap, expected ALLOW_CREATE, got ${decision.decision}`);
  console.log(`STEP 2 OK: WriteGateDecision ${decision.decision_id} = ${decision.decision} (evidence: ${decision.evidence.map((e) => `${e.rule_id}=${e.result}`).join(", ")})`);

  // STEP 3: Write Gate decision -> File-Write Execution -> resulting artifact.
  const writeResult = executeFileWrite(
    {
      correlation_id: intent.correlation_id,
      intent_id: intent.intent_id,
      gate_decision_id: decision.decision_id,
      operation: intent.operation,
      target_type: intent.target_type,
      target_path: intent.target_path,
      content: `end-to-end proof content, requested_change="${intent.requested_change}", written ${new Date().toISOString()}`,
      requesting_identity_id: intent.requesting_agent.identity_id,
    },
    decision,
  );
  assert(writeResult.status === "completed", `step 3: expected completed, got ${writeResult.status} (${writeResult.refusal_code})`);
  assert(fileExistsReal(joinPath(repoRootDirname(), SANDBOX_TARGET)), "step 3: the real artifact exists on disk");
  console.log(`STEP 3 OK: real file written at ${writeResult.resolved_path} (${writeResult.bytes_written} bytes)`);

  // STEP 4: full chain trace-back, every ID independently re-verified against the real durable audit log.
  const audit = listWriteAudit();
  const record = audit.find((e) => e.write_id === writeResult.write_id);
  assert(record !== undefined, "step 4: a real audit record exists for this write");
  assert(record!.requesting_identity_id === EXTERNAL_AI.identity_id, "step 4: audit traces back to the real requesting identity");
  assert(record!.intent_id === intent.intent_id, "step 4: audit traces back to the real WriteIntent");
  assert(record!.gate_decision_id === decision.decision_id, "step 4: audit traces back to the real WriteGateDecision");
  assert(record!.gate_decision_value === "ALLOW_CREATE", "step 4: audit records the real decision value, not just its id");
  assert(record!.resolved_path === joinPath(repoRootDirname(), SANDBOX_TARGET), "step 4: audit records the real resulting artifact path");
  console.log(`STEP 4 OK: full chain independently re-verified — identity ${record!.requesting_identity_id} -> intent ${record!.intent_id} -> decision ${record!.gate_decision_id} (${record!.gate_decision_value}) -> write ${record!.write_id} -> artifact ${record!.resolved_path}`);

  const onDisk = readFileReal(joinPath(repoRootDirname(), SANDBOX_TARGET));
  assert(onDisk.includes(intent.requested_change), "the real on-disk artifact content is consistent with the original requested_change");

  console.log("=== ALL end-to-end.test.ts CASES PASSED — full chain is real, gated, and traceable ===");
}

try {
  run();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}
