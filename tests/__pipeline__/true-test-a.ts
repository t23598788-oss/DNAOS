/**
 * TRUE TEST A: เริ่มจากประตูหน้าจริง (submitTask) ไม่ใช่จาก runAgentWorkOrder
 * แยก state ด้วย AGENT_GATEWAY_DATA_DIR ที่มีอยู่แล้ว — ไม่แตะ store ของจริง
 */
process.env.AGENT_GATEWAY_DATA_DIR =
  "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE/tests/__pipeline__/isolated-store";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { submitTask, getTask, loadEvidenceForTask, runAgentWorkOrder, runCorrectiveLoop, aiWriteAdapter }
  from "../../control/agent-gateway/contract";
import { adaptAgentResult } from "../../control/agent-result-adapter/contract";
import { ingestWorkResult } from "../../control/work-result-ingress/contract";
import type { WorkOrder } from "../../control/agent-gateway/types";
import type { RegistryStore } from "../../software/registry-database/contract";

const REPO = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE";
const SANDBOX_REL = "tests/__sandbox__/true-test-a";
const FIX = `${REPO}/${SANDBOX_REL}`;
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const memStore = () => ({
  writeApprovedCandidate: () => ({ ok: true }), appendRegistrationEvent: () => {},
  findCapabilityById: () => null, findCapabilityBySemanticFingerprint: () => null,
  findCapabilityByCanonicalName: () => null, findResourceByContentHash: () => null,
  findResourceById: () => null,
} as unknown as RegistryStore);

async function oneCase(name: string, action: Record<string, unknown>) {
  mkdirSync(FIX, { recursive: true });
  const target = `${FIX}/input.txt`;
  if (!existsSync(target)) writeFileSync(target, "fixture v1\n");
  const before = sha(readFileSync(target));

  const wo: WorkOrder = {
    operation: "MODIFY", target_type: "FILE", target_path: `${SANDBOX_REL}/input.txt`,
    requested_change: name, content: "fixture v2 — content ที่ระบบอนุมัติให้เขียน\n",
    workspace_scope: SANDBOX_REL, mode: "sandbox",
    required_tests: ["sandbox.readback"], forbidden_files: [`${REPO}/control`],
    evidence: [{ source: "true-test-a", note: name }],
    agent_run: { worker_kind: "LOCAL", instruction: JSON.stringify(action),
      assigned_source_paths: [FIX], dependency_read_paths: [], workspace_path: FIX,
      timeout_ms: 60_000, expected_result_contract: "DNA_OS_AGENT_RESULT_V1" },
  };

  // --- ประตูหน้าจริง ---
  const task = await submitTask(`TRUE TEST A: ${name}`,
    { user_id: "owner", workspace_id: "test", conversation_id: `c-${Date.now()}`, parent_task_id: null },
    "true-test-a", [aiWriteAdapter], wo,
    // เจ้าของงานจริงจากทะเบียน: real_file_write_after_authorization
    // -> execution/file-write (executeFileWrite) ตัวเดียวที่เป็น EXACT_OWNER
    { target_capability_id: "real_file_write_after_authorization" } as never);
  const evAfterSubmit = loadEvidenceForTask(task.task_id);
  const policyEv = evAfterSubmit.find((e) => e.kind === "policy_decision");






  const after = sha(readFileSync(target));
  const t2 = getTask(task.task_id);
  const ev = loadEvidenceForTask(task.task_id);
  const ai = ev.find((e) => (e.payload as { agent_input?: unknown })?.agent_input);
  const pol = ev.find((e) => e.kind === "policy_decision");
  const ver = ev.filter((e) => e.kind === "verification").pop();
  const agentExec = ev.find((e) => e.source?.includes("admitted-agent-execution"));
  return { name, submit_status: task.status, task_status_now: t2?.status ?? null,
    sha_changed: before !== after,
    agent_exec: agentExec?.payload ?? null,
    verification: ver?.payload ?? null,
    auth_match: !!(ai && pol
      && (ai.payload as { agent_input: { authorization_reference: string } }).agent_input.authorization_reference === pol.evidence_id),
    agent_input_task_id: ai?.task_id ?? null,
    
    
     
    
    
    
    forbidden_created: existsSync(`${REPO}/FORBIDDEN-TRUE-A.txt`) };
    
}

async function main() {
  rmSync(`${REPO}/tests/__pipeline__/isolated-store`, { recursive: true, force: true });
  const a1 = await oneCase("A1-allowed-change",
    { action: "write_direct_allowed_attempt", relPath: "input.txt", content: `v2 ${new Date().toISOString()}\n` });
  const a2 = await oneCase("A2-unauthorized-read",
    { action: "read_outside", absPath: `${REPO}/control/agent-gateway/gateway.ts` });
  const a3 = await oneCase("A3-unauthorized-write",
    { action: "write_direct_outside", absPath: `${REPO}/FORBIDDEN-TRUE-A.txt`, content: "no" });
  console.log(JSON.stringify({ a1, a2, a3 }, null, 1));
}
main().catch((e) => { console.error("ERR", e?.message ?? e); process.exit(1); });
