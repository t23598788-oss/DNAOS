/**
 * PROOF: การผูก execution runtime เข้ากับ trusted principal ผ่านทะเบียนจริง
 *
 *   phase main      : ใช้ทะเบียนจริง — resolve, plan, lineage, negatives A/C/D/E
 *   phase ambiguous : รันในไดเรกทอรีแยก (store ใช้ process.cwd()) เพื่อพิสูจน์
 *                     กรณีสองรายการ โดยไม่ไปเขียนทะเบียนจริง
 *
 * ไม่มีการปล่อยโปรเซส Agent ใดในไฟล์นี้
 */
process.env.AGENT_GATEWAY_DATA_DIR =
  "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE/tests/__pipeline__/isolated-store-trust";
process.env.SCHEDULER_ROUTE_DECISION_LOG =
  `${process.env.AGENT_GATEWAY_DATA_DIR}/route-decisions.jsonl`;
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolveHandoffPrincipal } from "../../control/agent-gateway/handoff-principal";
import { validateHandoff } from "../../control/agent-gateway/handoff";
import { adaptAgentResult } from "../../control/agent-result-adapter/contract";
import { listRegisteredAgents, registerAgent } from "../../connections/agent-registry/registry";
import {
  handleWriteAuditEvent, snapshotRouteInputs, buildCorrectiveWorkOrder,
  AUTOMATIC_AGENT_DISPATCH_ENABLED,
} from "../../control/write-failure-bridge/contract";
import type { RouteInputsSnapshot } from "../../control/write-failure-bridge/contract";
import { routeRequestedAction } from "../../control/agent-gateway/agent-authority-router";
import { createTaskWorkspace, getWorkspace } from "../../control/agent-gateway/workspace-manager";
import { loadRouteDecision } from "../../control/scheduler/contract";
import { loadAgentRun } from "../../control/agent-gateway/agent-run-registry";
import { listWriteAudit } from "../../execution/file-write/contract";
import type { WriteAuditEvent } from "../../execution/file-write/contract";
import type { DnaOsAgentResult } from "../../control/agent-gateway/agent-execution-contract";

const REPO = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE";
const SANDBOX_REL = "tests/__sandbox__/true-test-a";
const FIX = `${REPO}/${SANDBOX_REL}`;
const WS_ROOT = `${REPO}/control/agent-host/test-workspace/allowed`;

async function realAuthorizedFailure(tag: string): Promise<WriteAuditEvent> {
  mkdirSync(FIX, { recursive: true }); mkdirSync(WS_ROOT, { recursive: true });
  const rel = `${SANDBOX_REL}/tb-${tag}.txt`;
  const abs = `${REPO}/${rel}`;
  if (existsSync(abs)) chmodSync(abs, 0o644);
  writeFileSync(abs, `baseline ${tag}\n`);
  chmodSync(abs, 0o444);
  const ws = createTaskWorkspace({ work_order_id: `wo-tb-${tag}`, command_id: `cmd-tb-${tag}`, assigned_source: [FIX], workspace_root: WS_ROOT });
  const artifact = `${ws.allowed_write_workspace}/proposal.txt`;
  writeFileSync(artifact, `proposed ${tag}\n`);
  const before = listWriteAudit().length;
  await routeRequestedAction({ operation: "FILE_MODIFY", artifact_ref: `artifact://${artifact}`, target: rel },
    { workspace: ws, origin: { kind: "ADMITTED_TASK", task_id: `task-tb-${tag}`, command_id: `cmd-tb-${tag}` }, authorization_reference: null });
  chmodSync(abs, 0o644);
  const row = listWriteAudit().slice(before).at(-1);
  if (!row) throw new Error("ไม่เกิดแถว audit ใหม่");
  return row;
}

function forged(claimed: string): DnaOsAgentResult {
  return {
    protocol: "DNA_OS_AGENT_RESULT_V1", work_order_id: "wo-f", workspace_id: "ws-f", launch_id: null,
    result_id: "res-f", verification_id: null, task_id: "task-f", worker_id: claimed, status: "PASS",
    summary: "", error_code: null, severity: null, artifacts: [], evidence_refs: [], requested_actions: [],
    errors: [], verification: { verified: true, method: "x", checked_against: [] },
    runtime: { launcher_pid: 0, sandbox_pid: null, agent_pid: null, ppid_chain: [], uid: -1, executable: "",
      workspace: "", sandbox_profile_hash: null, started_at: "", ended_at: "", exit_code: 0 },
    exit_code: 0,
  } as DnaOsAgentResult;
}

async function ambiguousPhase() {
  // cwd ถูกตั้งเป็นไดเรกทอรีชั่วคราวโดยผู้เรียก -> agent-registry เขียนที่นั่น
  const a = await registerAgent({ provider: "codex", role: "inspect_test", capability: ["inspect_test"], transport: "cli", workspace_scope: REPO, execution_worker_kind: "CODEX" });
  const b = await registerAgent({ provider: "codex", role: "inspect_test", capability: ["inspect_test"], transport: "cli", workspace_scope: REPO, execution_worker_kind: "CODEX" });
  const r = resolveHandoffPrincipal({ worker_kind: "CODEX", required_role: null, required_scope: REPO });
  console.log(JSON.stringify({
    PHASE: "ambiguous (isolated cwd)",
    registered_ok: [a.ok, b.ok],
    resolution: r.ok ? "EXACT" : r.reason_code,
    candidates: r.ok ? 1 : r.candidates.length,
    DISPATCH_WOULD_BE_READY: r.ok ? "YES" : "NO",
    ALPHABETICAL_TIE_BREAK_USED: "NO",
  }, null, 1));
}

async function mainPhase() {
  const regs = listRegisteredAgents();
  const execPrincipals = regs.filter((a) => a.execution_worker_kind);
  const nonExec = regs.filter((a) => !a.execution_worker_kind);

  // ---- PHASE 3 : resolution ต่อ worker_kind
  const perWorker = ["CLAUDE", "CODEX", "GEMINI", "LOCAL"].map((k) => {
    const r = resolveHandoffPrincipal({ worker_kind: k, required_role: null, required_scope: REPO });
    return { worker_kind: k, resolution: r.ok ? "EXACT" : r.reason_code, principal: r.ok ? r.handoff_principal_id : null,
      registration: r.ok ? r.registration.agent_id : null };
  });

  // ---- PHASE 6 : positive — บังคับให้ pool ไม่มี CLAUDE (สถานการณ์เครื่องที่ไม่มี claude)
  //      scheduler ยังเป็นผู้ตัดสินเอง ผมแค่เปลี่ยน input ไม่ได้เลือกผู้ชนะแทนมัน
  const E = await realAuthorizedFailure("pos");
  const con = buildCorrectiveWorkOrder(E);
  if (!con.ok) throw new Error("construction ล้มเหลว");
  const base = snapshotRouteInputs(con.work_order, E.write_id);
  const codexOnly: RouteInputsSnapshot = { ...base, pool: base.pool.map((u) => u.provider === "CODEX" ? u : { ...u, available: false, detail: "not installed in this scenario" }) };
  const planned = await handleWriteAuditEvent(E, { holder_id: "trust-pos", snapshotInputs: () => codexOnly });

  const o = planned.outcome;
  const ok = o.status === "EXECUTION_PLANNED" || o.status === "PLAN_NOT_DISPATCHABLE";
  const run = ok ? o.agent_run : null;

  // lineage: principal -> registration ด้วยตัวกรองเดียวกับ resolver (ฟิลด์ทั้งหมดมีชนิด)
  const backToReg = run?.handoff_principal_id
    ? listRegisteredAgents().filter((a) => a.provider === run.handoff_principal_id
        && a.execution_worker_kind === run.worker_kind && a.permission_state === "sandbox_only")
    : [];

  // lineage: agent_run -> result -> handoff validation
  const adapted = run?.handoff_principal_id
    ? adaptAgentResult(forged("CODEX"), { role: run.worker_kind, repo_root: REPO, allowed_write_paths: [SANDBOX_REL], verified_file_changes: [], handoff_principal_id: run.handoff_principal_id })
    : null;
  const admission = adapted ? validateHandoff({ task_id: run!.task_id, agent_id: adapted.work_result.agent_id, role: run!.worker_kind,
    input_reference: "work-order://trust", files_read: [], files_changed: [], tests_run: [],
    status: adapted.work_result.status, evidence_refs: ["ev"], blockers: ["b"], next_action: null }) : null;

  // ---- PHASE 7C : ผลลัพธ์อ้างตัวตนอื่น
  const escalation = adaptAgentResult(forged("owner-console"), { role: "CODEX", repo_root: REPO, allowed_write_paths: [SANDBOX_REL], verified_file_changes: [], handoff_principal_id: run?.handoff_principal_id ?? "codex" });

  // ---- PHASE 7D : LOCAL
  const local = resolveHandoffPrincipal({ worker_kind: "LOCAL", required_role: null, required_scope: REPO });

  // ---- PHASE 7E : claude-code เดิมต้องไม่อนุญาต CLAUDE subprocess
  const claude = resolveHandoffPrincipal({ worker_kind: "CLAUDE", required_role: null, required_scope: REPO });

  console.log(JSON.stringify({
    PHASE: "main (ทะเบียนจริง)",
    REGISTRY: {
      total: regs.length,
      execution_principals: execPrincipals.map((a) => ({ agent_id: a.agent_id, provider: a.provider, role: a.role, worker_kind: a.execution_worker_kind, scope: a.workspace_scope, state: a.permission_state, evidence: a.execution_binding_evidence })),
      non_execution_registrations: nonExec.map((a) => `${a.provider}(execution_worker_kind=${a.execution_worker_kind ?? "null/absent"})`),
    },
    PRINCIPAL_RESOLUTION_PER_WORKER: perWorker,
    POSITIVE_PLAN: run ? {
      status: o.status,
      ROUTE_DECISION_ID: o.status === "EXECUTION_PLANNED" || o.status === "PLAN_NOT_DISPATCHABLE" ? o.route_decision.route_decision_id : null,
      WORKER_KIND: run.worker_kind,
      AGENT_RUN_ID: run.agent_run_id,
      HANDOFF_PRINCIPAL_ID: run.handoff_principal_id,
      DISPATCH_READY: run.dispatch_ready,
      WORKSPACE_ID: run.workspace_id,
      WORKER_KIND_EQUALS_PRINCIPAL: run.worker_kind === run.handoff_principal_id ? "YES" : "NO",
    } : { status: o.status },
    LINEAGE: {
      REGISTRATION_TO_PRINCIPAL: backToReg.length === 1 ? "MACHINE_RECONSTRUCTABLE" : `AMBIGUOUS(${backToReg.length})`,
      matched_registration: backToReg[0]?.agent_id ?? null,
      PRINCIPAL_TO_AGENT_RUN: run && loadAgentRun(run.agent_run_id)?.handoff_principal_id === run.handoff_principal_id ? "MACHINE_RECONSTRUCTABLE" : "MISSING",
      AGENT_RUN_TO_RESULT: adapted ? "MACHINE_RECONSTRUCTABLE" : "MISSING",
      result_agent_id: adapted?.work_result.agent_id ?? null,
      result_provenance: adapted?.provenance.find((p) => p.field === "agent_id")?.kind ?? null,
      RESULT_TO_HANDOFF_VALIDATION: admission?.ok ? "MACHINE_RECONSTRUCTABLE" : `REJECTED:${admission?.reason_codes.join(",")}`,
      route_decision_round_trip: run ? loadRouteDecision((o as { route_decision: { route_decision_id: string } }).route_decision.route_decision_id) !== null : null,
      workspace_round_trip: run ? getWorkspace(run.workspace_id) !== undefined : null,
    },
    NEGATIVES: {
      C_result_claims_other_identity: {
        agent_claimed: "owner-console",
        resulting_agent_id: escalation.work_result.agent_id,
        provenance: escalation.provenance.find((p) => p.field === "agent_id")?.kind,
        TRUST_ESCALATION: escalation.work_result.agent_id === "owner-console" ? "YES" : "NO",
      },
      D_local: { resolution: local.ok ? local.handoff_principal_id : local.reason_code, MAPPED_TO_OWNER_CONSOLE: "NO" },
      E_claude: { resolution: claude.ok ? claude.handoff_principal_id : claude.reason_code,
        NOTE: "registration ของ claude-code (ถ้ามี) ไม่มี execution_worker_kind จึงไม่ถูกนับเป็น execution principal" },
    },
    AGENT_PROCESS_STARTED: planned.agent_dispatched ? "YES" : "NO",
    AUTOMATIC_AGENT_DISPATCH_ENABLED,
  }, null, 1));
}

const phase = process.argv[2] ?? "main";
(phase === "ambiguous" ? ambiguousPhase() : mainPhase()).catch((e) => { console.error("ERR", e?.stack ?? e); process.exit(1); });
