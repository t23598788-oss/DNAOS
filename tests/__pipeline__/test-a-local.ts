/**
 * TEST A (STEP 5): พิสูจน์สายจริงในเครื่อง โดยไม่แตะ registry จริงและไม่แตะ production source
 *
 * System Work -> AgentWorkRequest -> Dispatch -> Execution Host -> Agent
 *   -> DnaOsAgentResult -> Result Adapter -> WorkResultInput -> Result Ingest
 *
 * ใช้ RegistryStore แบบ in-memory เพื่อไม่ให้การทดสอบเขียนทะเบียนจริง
 * หลักฐานทุกช่วงบันทึก contract เข้า/ออก, correlation, เวลา, evidence ref
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { runAgentWorkOrder } from "../../control/agent-gateway/agent-host-dispatch";
import { adaptAgentResult } from "../../control/agent-result-adapter/contract";
import { ingestWorkResult } from "../../control/work-result-ingress/contract";
import type { WorkOrder } from "../../control/agent-gateway/types";
import type { RegistryStore } from "../../software/registry-database/contract";

const REPO = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE";
const SANDBOX = `${REPO}/tests/__sandbox__/chip-flow`;
const OUT = `${REPO}/tests/__pipeline__/test-a-evidence.jsonl`;
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

/** ทะเบียนในหน่วยความจำ — ทดสอบโดยไม่เขียนทะเบียนจริง */
function memoryStore(): RegistryStore {
  const events: unknown[] = [];
  return {
    writeApprovedCandidate: () => ({ inserted: true, capability_id: `cap-${randomUUID()}`,
      resource_id: `res-${randomUUID()}` } as ReturnType<RegistryStore["writeApprovedCandidate"]>),
    appendRegistrationEvent: (e: Parameters<RegistryStore["appendRegistrationEvent"]>[0]) => { events.push(e); },
    findCapabilityById: () => null,
    findCapabilityBySemanticFingerprint: () => null,
    findCapabilityByCanonicalName: () => null,
    findResourceByContentHash: () => null,
    findResourceById: () => null,
  } as unknown as RegistryStore;
}

const marks: unknown[] = [];
const mark = (stage: string, inC: string, outC: string, detail: unknown) =>
  marks.push({ stage, input_contract: inC, output_contract: outC, at: new Date().toISOString(), detail });

async function runCase(name: string, action: Record<string, unknown>, targetRel: string) {
  const TRACE = `testA-${randomUUID()}`;
  const command_id = `cmd_${randomUUID()}`;
  const abs = `${REPO}/${targetRel}`;
  const before = existsSync(abs) ? sha(readFileSync(abs)) : null;

  const wo: WorkOrder = {
    operation: "MODIFY", target_type: "FILE", target_path: targetRel,
    requested_change: name, content: "", workspace_scope: SANDBOX, mode: "sandbox",
    required_tests: ["sandbox.readback"], forbidden_files: [],
    evidence: [{ source: "test-a-local", note: TRACE }],
    agent_run: { worker_kind: "LOCAL", instruction: JSON.stringify(action),
      assigned_source_paths: [SANDBOX], dependency_read_paths: [], workspace_path: SANDBOX,
      timeout_ms: 60_000, expected_result_contract: "DNA_OS_AGENT_RESULT_V1" },
  };
  mark("WORK_PREPARED", "-", "WorkOrder+AgentRunSpec", { TRACE, command_id, target: targetRel });

  const result = await runAgentWorkOrder(wo, command_id, process.env);
  mark("AGENT_RESULT", "WorkOrder+AgentRunSpec", "DnaOsAgentResult",
    { status: result.status, work_order_id: result.work_order_id, result_id: result.result_id,
      evidence_refs: result.evidence_refs, pid: result.runtime.agent_pid });

  // วัดการเปลี่ยนแปลงไฟล์ด้วยตัวเอง — ไม่เชื่อคำอ้างของ Agent
  const after = existsSync(abs) ? sha(readFileSync(abs)) : null;
  const changed = before !== null && after !== null && before !== after
    ? [{ repo_relative_path: targetRel, sha256_before: before, sha256_after: after, measured_by: "test-a-local" }]
    : [];
  mark("CHANGE_MEASUREMENT", "filesystem", "VerifiedFileChange[]",
    { sha_before: before, sha_after: after, changed_count: changed.length });

  const adapted = adaptAgentResult(result, { role: "LOCAL", repo_root: REPO,
    allowed_write_paths: ["tests/__sandbox__"], verified_file_changes: changed });
  mark("RESULT_ADAPTER", "DnaOsAgentResult", "WorkResultInput",
    { status: adapted.work_result.status, files_changed: adapted.work_result.files_changed,
      blockers: adapted.work_result.blockers, unresolved: adapted.unresolved.length,
      guessed_field_count: adapted.guessed_field_count });

  let ingest: unknown = null, ingestErr: string | null = null;
  try { ingest = ingestWorkResult(adapted.work_result, { store: memoryStore() }); }
  catch (e) { ingestErr = (e as Error).message; }
  mark("RESULT_INGEST", "WorkResultInput", "WorkResultIngressResult",
    ingestErr ? { error: ingestErr } : (ingest as Record<string, unknown>));

  const rec = { TRACE, CASE: name, agent_status: result.status,
    adapted_status: adapted.work_result.status,
    files_changed: adapted.work_result.files_changed,
    outside_file_created: name.includes("forbidden") ? existsSync(`${REPO}/FORBIDDEN-TEST-A.txt`) : null,
    ingest_ok: !ingestErr, ingest_error: ingestErr,
    MARKS: [...marks], recorded_at: new Date().toISOString() };
  marks.length = 0;
  appendFileSync(OUT, `${JSON.stringify(rec)}\n`);
  return rec;
}

async function main() {
  // A. งานที่อนุญาต — เขียนไฟล์ในเขตของตัวเอง
  const okCase = await runCase("A-allowed-change",
    { action: "write_direct_allowed_attempt", relPath: "agent-input.txt",
      content: `changed by TEST A at ${new Date().toISOString()}\n` },
    "tests/__sandbox__/chip-flow/agent-input.txt");
  // B. งานต้องห้าม — เขียนนอกเขต
  const badCase = await runCase("B-forbidden-change",
    { action: "write_direct_outside", absPath: `${REPO}/FORBIDDEN-TEST-A.txt`, content: "should never exist" },
    "tests/__sandbox__/chip-flow/agent-input.txt");
  console.log(JSON.stringify({
    A: { agent: okCase.agent_status, adapted: okCase.adapted_status,
         files_changed: okCase.files_changed, ingest_ok: okCase.ingest_ok, ingest_error: okCase.ingest_error },
    B: { agent: badCase.agent_status, adapted: badCase.adapted_status,
         outside_file_created: badCase.outside_file_created,
         ingest_ok: badCase.ingest_ok, ingest_error: badCase.ingest_error },
  }, null, 1));
}
main().catch((e) => { console.error("ERR", e?.message ?? e); process.exit(1); });
