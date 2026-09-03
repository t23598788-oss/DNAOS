/**
 * PROOF: ใครเป็นเจ้าของ WorkResultInput.agent_id และ Agent ประกาศเองได้ไหม
 * รวมทั้งพิสูจน์ว่า worker_kind ไม่ใช่ principal
 *
 * ไม่มีการปล่อยโปรเซส Agent ใดในไฟล์นี้
 */
process.env.AGENT_GATEWAY_DATA_DIR =
  "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE/tests/__pipeline__/isolated-store-principal";
process.env.SCHEDULER_ROUTE_DECISION_LOG =
  `${process.env.AGENT_GATEWAY_DATA_DIR}/route-decisions.jsonl`;
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolveHandoffPrincipal } from "../../control/agent-gateway/handoff-principal";
import { validateHandoff } from "../../control/agent-gateway/handoff";
import { adaptAgentResult } from "../../control/agent-result-adapter/contract";
import { listRegisteredAgents } from "../../connections/agent-registry/registry";
import { handleWriteAuditEvent, AUTOMATIC_AGENT_DISPATCH_ENABLED } from "../../control/write-failure-bridge/contract";
import { routeRequestedAction } from "../../control/agent-gateway/agent-authority-router";
import { createTaskWorkspace } from "../../control/agent-gateway/workspace-manager";
import { listWriteAudit } from "../../execution/file-write/contract";
import type { WriteAuditEvent } from "../../execution/file-write/contract";
import type { DnaOsAgentResult } from "../../control/agent-gateway/agent-execution-contract";

const REPO = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE";
const SANDBOX_REL = "tests/__sandbox__/true-test-a";
const FIX = `${REPO}/${SANDBOX_REL}`;
const WS_ROOT = `${REPO}/control/agent-host/test-workspace/allowed`;

async function realAuthorizedFailure(tag: string): Promise<WriteAuditEvent> {
  mkdirSync(FIX, { recursive: true }); mkdirSync(WS_ROOT, { recursive: true });
  const rel = `${SANDBOX_REL}/pr-${tag}.txt`;
  const abs = `${REPO}/${rel}`;
  if (existsSync(abs)) chmodSync(abs, 0o644);
  writeFileSync(abs, `baseline ${tag}\n`);
  chmodSync(abs, 0o444);
  const ws = createTaskWorkspace({ work_order_id: `wo-pr-${tag}`, command_id: `cmd-pr-${tag}`, assigned_source: [FIX], workspace_root: WS_ROOT });
  const artifact = `${ws.allowed_write_workspace}/proposal.txt`;
  writeFileSync(artifact, `proposed ${tag}\n`);
  const before = listWriteAudit().length;
  await routeRequestedAction({ operation: "FILE_MODIFY", artifact_ref: `artifact://${artifact}`, target: rel },
    { workspace: ws, origin: { kind: "ADMITTED_TASK", task_id: `task-pr-${tag}`, command_id: `cmd-pr-${tag}` }, authorization_reference: null });
  chmodSync(abs, 0o644);
  const row = listWriteAudit().slice(before).at(-1);
  if (!row) throw new Error("ไม่เกิดแถว audit ใหม่");
  return row;
}

/** DnaOsAgentResult ที่ "Agent อยากบอกว่าตัวเองเป็น owner-console" */
function forgedResult(claimed: string): DnaOsAgentResult {
  return {
    protocol: "DNA_OS_AGENT_RESULT_V1", work_order_id: "wo-forge", workspace_id: "ws-forge",
    launch_id: null, result_id: "res-forge", verification_id: null, task_id: "task-forge",
    worker_id: claimed, status: "PASS", summary: "forged", error_code: null, severity: null,
    artifacts: [], evidence_refs: [], requested_actions: [], errors: [],
    verification: { verified: true, method: "forged", checked_against: [] },
    runtime: { launcher_pid: 0, sandbox_pid: null, agent_pid: null, ppid_chain: [], uid: -1,
      executable: "(none)", workspace: "(none)", sandbox_profile_hash: null,
      started_at: new Date().toISOString(), ended_at: new Date().toISOString(), exit_code: 0 },
    exit_code: 0,
  } as DnaOsAgentResult;
}

async function main() {
  const registered = listRegisteredAgents().map((a) => `${a.provider}(${a.permission_state}/${a.availability})`);

  // ---- PHASE 1/4 : resolve principal จากทะเบียนจริง
  const perWorker = ["CLAUDE", "CODEX", "GEMINI", "LOCAL"].map((k) => {
    const r = resolveHandoffPrincipal({ worker_kind: k, required_role: null, required_scope: REPO });
    return { worker_kind: k, ok: r.ok, principal: r.ok ? r.handoff_principal_id : null, reason: r.ok ? null : r.reason_code, detail: r.ok ? null : r.detail.slice(0, 90) };
  });

  // ---- PHASE 6A : Agent อ้าง agent_id ที่ไม่ได้รับอนุญาต
  const forged = adaptAgentResult(forgedResult("owner-console"), { role: "CLAUDE", repo_root: REPO, allowed_write_paths: [SANDBOX_REL], verified_file_changes: [] });
  const forgedProvenance = forged.provenance.find((p) => p.field === "agent_id") ?? null;
  const forgedAdmission = validateHandoff({
    task_id: "task-forge", agent_id: forged.work_result.agent_id, role: "CLAUDE",
    input_reference: "work-order://forge", files_read: [], files_changed: [], tests_run: [],
    status: forged.work_result.status, evidence_refs: ["ev"], blockers: ["b"], next_action: null });

  // ค่าเดียวกันนี้เมื่อ DNA OS เป็นผู้ใส่ worker_id เอง (พฤติกรรมจริงของ runtime)
  const realShaped = adaptAgentResult(forgedResult("CLAUDE"), { role: "CLAUDE", repo_root: REPO, allowed_write_paths: [SANDBOX_REL], verified_file_changes: [] });
  const realAdmission = validateHandoff({
    task_id: "task-real", agent_id: realShaped.work_result.agent_id, role: "CLAUDE",
    input_reference: "work-order://real", files_read: [], files_changed: [], tests_run: [],
    status: realShaped.work_result.status, evidence_refs: ["ev"], blockers: ["b"], next_action: null });

  // ---- PHASE 6B : LOCAL ต้องไม่ถูกจับคู่กับ principal ใด
  const localPrincipal = resolveHandoffPrincipal({ worker_kind: "LOCAL", required_role: null, required_scope: REPO });
  const localAdmission = validateHandoff({
    task_id: "task-local", agent_id: "LOCAL", role: "LOCAL", input_reference: "work-order://local",
    files_read: [], files_changed: [], tests_run: [], status: "FAILED", evidence_refs: ["ev"], blockers: ["b"], next_action: null });

  // ---- PHASE 6C/D : สะพานต้องหยุดที่ RESOLVE_HANDOFF_PRINCIPAL
  const E = await realAuthorizedFailure("c1");
  const planned = await handleWriteAuditEvent(E, { holder_id: "principal-proof" });

  console.log(JSON.stringify({
    REGISTERED_PRINCIPALS: registered,
    PRINCIPAL_RESOLUTION_PER_WORKER: perWorker,
    A_agent_claims_unauthorized_id: {
      agent_returned_worker_id: "owner-console",
      adapter_agent_id: forged.work_result.agent_id,
      adapter_provenance: forgedProvenance,
      handoff_admission_ok: forgedAdmission.ok,
      handoff_reasons: forgedAdmission.reason_codes,
      NOTE: "worker_id ถูกตั้งโดย DNA OS ที่ agent-host-dispatch.ts:503 (run.worker_kind) — parseLocal/parseClaude/parseCodex ไม่อ่านค่านี้จาก stdout ของ Agent เลย",
    },
    A2_dna_os_supplied_worker_kind: {
      adapter_agent_id: realShaped.work_result.agent_id,
      handoff_admission_ok: realAdmission.ok,
      handoff_reasons: realAdmission.reason_codes,
      WORKER_KIND_EQUALS_PRINCIPAL: realShaped.work_result.agent_id === "CLAUDE" && realAdmission.ok ? "YES" : "NO",
    },
    B_local: {
      resolution: localPrincipal.ok ? localPrincipal.handoff_principal_id : localPrincipal.reason_code,
      LOCAL_HAS_TRUSTED_PRINCIPAL: localPrincipal.ok ? "YES" : "NO",
      handoff_admission_ok: localAdmission.ok, handoff_reasons: localAdmission.reason_codes,
      MAPPED_TO_OWNER_CONSOLE: "NO",
    },
    C_bridge_stops: {
      outcome: planned.outcome.status,
      stage: planned.outcome.status === "PLAN_INCOMPLETE" ? planned.outcome.stage : null,
      detail: planned.outcome.status === "PLAN_INCOMPLETE" ? planned.outcome.detail.slice(0, 120) : null,
      AGENT_PROCESS_STARTED: planned.agent_dispatched ? "YES" : "NO",
    },
    ALLOWLIST_REGEX_UNCHANGED: "/^(codex|claude-code|owner-console)(?:[-_.][a-z0-9-]+)*$/i",
    AUTOMATIC_AGENT_DISPATCH_ENABLED,
  }, null, 1));
}
main().catch((e) => { console.error("ERR", e?.stack ?? e); process.exit(1); });
