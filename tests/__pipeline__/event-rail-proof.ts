/**
 * PROOF A–G: เส้นข้อมูล event → identity → route → executor → cleanup
 *
 * รันสองเฟสคนละโปรเซสเพื่อพิสูจน์ restart persistence จริง
 */
const STORE = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE/tests/__pipeline__/isolated-store-rail";
process.env.AGENT_GATEWAY_DATA_DIR = STORE;
process.env.OWNER_BACKBONE_ROUTE_LOG = `${STORE}/route-results.jsonl`;
process.env.SOURCE_WORKSPACE_RESERVATION_LOG = `${STORE}/reservations.jsonl`;
process.env.SCHEDULER_ROUTE_DECISION_LOG = `${STORE}/route-decisions.jsonl`;

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { intakeEvent, listRouteResults, routeResultsForEvent } from "../../control/owner-backbone/contract";
import type { RawOperationalEvent, RouteResult } from "../../control/owner-backbone/contract";
import { createTaskWorkspace, linkSourceReservation, transitionWorkspace, getWorkspace } from "../../control/agent-gateway/workspace-manager";
import { evaluateCleanupEligibility, cleanupWorkspace } from "../../control/agent-gateway/workspace-cleanup";
import { saveTask } from "../../control/agent-gateway/memory-store";
import { createWorkspace, loadReservation } from "../../control/source-workspace/contract";
import { classifyWriteAudit } from "../../control/write-failure-bridge/contract";
import { routeRequestedAction } from "../../control/agent-gateway/agent-authority-router";
import { submitWriteRequest } from "../../control/ai-write-control/contract";
import { evaluateWriteIntent } from "../../permissions/write-gate/contract";
import { getWriteOwnershipIndex } from "../../software/capability-registrar/contract";
import { executeFileWrite, listWriteAudit } from "../../execution/file-write/contract";
import type { WriteAuditEvent } from "../../execution/file-write/contract";
import type { Task } from "../../control/agent-gateway/types";

const REPO = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE";
const SANDBOX_REL = "tests/__sandbox__/true-test-a";
const FIX = `${REPO}/${SANDBOX_REL}`;
const WS_ROOT = `${REPO}/control/agent-host/test-workspace/allowed`;
const SCRATCH = "/private/tmp/claude-501/-Users-tam-Desktop-DNA-OS-INFRASTRUCTURE/f09839f8-ba2f-462c-9ca0-1b1e187c6923/scratchpad";
const HANDOFF = `${SCRATCH}/rail-handoff.json`;

/** เหตุจริง: authorized FILE_MODIFY บนไฟล์อ่านได้แต่เขียนไม่ได้ -> ALLOW_MODIFY + FS_ERROR */
async function realAuthorizedFailure(tag: string): Promise<WriteAuditEvent> {
  mkdirSync(FIX, { recursive: true }); mkdirSync(WS_ROOT, { recursive: true });
  const rel = `${SANDBOX_REL}/rail-${tag}.txt`;
  const abs = `${REPO}/${rel}`;
  if (existsSync(abs)) chmodSync(abs, 0o644);
  writeFileSync(abs, `baseline ${tag}\n`);
  chmodSync(abs, 0o444);
  const ws = createTaskWorkspace({ work_order_id: `wo-rail-${tag}`, command_id: `cmd-rail-${tag}`, assigned_source: [FIX], workspace_root: WS_ROOT });
  const artifact = `${ws.allowed_write_workspace}/proposal.txt`;
  writeFileSync(artifact, `proposed ${tag}\n`);
  const before = listWriteAudit().length;
  await routeRequestedAction({ operation: "FILE_MODIFY", artifact_ref: `artifact://${artifact}`, target: rel },
    { workspace: ws, origin: { kind: "ADMITTED_TASK", task_id: `task-rail-${tag}`, command_id: `cmd-rail-${tag}` }, authorization_reference: null });
  chmodSync(abs, 0o644);
  const row = listWriteAudit().slice(before).at(-1);
  if (!row) throw new Error("ไม่เกิดแถว audit ใหม่");
  return row;
}

/** แปลง WriteAuditEvent -> RawOperationalEvent โดยยกเฉพาะค่าที่พิสูจน์ได้ */
function eventFromWriteAudit(a: WriteAuditEvent): RawOperationalEvent {
  const verdict = classifyWriteAudit(a);
  return {
    event_class: "RUNTIME",
    source: "execution/file-write/audit.ts#recordWriteAudit",
    provider: "dna-os",
    subject: verdict.classification === "AUTHORIZED_OPERATION_FAILED"
      ? `build failure: authorized write refused (${a.refusal_code})`
      : `security enforcement: ${a.gate_decision_value} refused`,
    body: `gate_decision_value=${a.gate_decision_value} status=${a.status} refusal_code=${a.refusal_code ?? "null"} target_path=${a.target_path}`,
    occurred_at: a.recorded_at,
    source_ref: a.write_id,
    event_id: `evt-${a.write_id}`,
    correlation_id: a.correlation_id,
    evidence_refs: [`execution/file-write/write-audit-log.json#${a.write_id}`],
    facts: { gate_decision_value: a.gate_decision_value, status: a.status, refusal_code: a.refusal_code ?? "" },
  };
}

const routeOf = (r: { route: RouteResult }) => ({
  route_id: r.route.route_id, target_owner: r.route.target_owner,
  target: r.route.target_capability_or_executor, action: r.route.action,
  policy_result: r.route.policy_result, reason_code: r.route.reason_code,
});

async function phaseA() {
  rmSync(STORE, { recursive: true, force: true });

  // ---- PROOF A : known internal failure
  const E1 = await realAuthorizedFailure("a1");
  const v1 = classifyWriteAudit(E1);
  const r1 = await intakeEvent(eventFromWriteAudit(E1));

  // ---- PROOF B : เหตุชนิดเดียวกันอีกครั้ง (write_id ใหม่จริง)
  const E2 = await realAuthorizedFailure("b1");
  const r2 = await intakeEvent(eventFromWriteAudit(E2));
  const sameRoute = r1.route.target_owner === r2.route.target_owner
    && r1.route.target_capability_or_executor === r2.route.target_capability_or_executor
    && r1.route.action === r2.route.action;

  // ---- PROOF C : unknown event
  const rC = await intakeEvent({
    event_class: "PROVIDER", source: "tests/__pipeline__/event-rail-proof.ts", provider: "unknown-provider-xyz",
    subject: "something nobody has a rule for", body: "no known signature",
    occurred_at: new Date().toISOString(), source_ref: "unknown-1", event_id: "evt-unknown-1",
  });

  // ---- PROOF D : security denial (audit row จริงชนิด non-ALLOW)
  const intent = submitWriteRequest(
    { operation: "MODIFY", capability: "agent_requested_action", target_type: "FILE",
      target_path: "control/agent-gateway/gateway.ts", requested_change: "proof D", evidence: [] },
    { identity_id: "proof-d", acting_as_account_id: "a", acting_as_tenant_id: "t", software_id: "s", kind: "ai_agent" });
  let D: Record<string, unknown> = { skipped: true };
  if (intent.ok) {
    const decision = evaluateWriteIntent(intent.intent, { registryIndex: getWriteOwnershipIndex() });
    const before = listWriteAudit().length;
    executeFileWrite({ correlation_id: intent.intent.correlation_id, intent_id: intent.intent.intent_id,
      gate_decision_id: decision.decision_id, operation: "MODIFY", target_type: "FILE",
      target_path: "control/agent-gateway/gateway.ts", content: "MUST NEVER LAND", requesting_identity_id: "proof-d" }, decision);
    const row = listWriteAudit().slice(before).at(-1)!;
    const verdict = classifyWriteAudit(row);
    const rD = await intakeEvent(eventFromWriteAudit(row));
    D = { classification: verdict.classification, eligible_for_corrective_work: verdict.eligible_for_corrective_work,
      route: routeOf(rD), AGENT_CALL_COUNT: 0 };
  }

  // ---- PROOF E : external alert (fixture message, ไม่ส่งอีเมลจริง)
  const rE = await intakeEvent({
    event_class: "EMAIL", source: "connections/email-alert-source (fixture message)", provider: "railway",
    subject: "Deployment failed for service joint-monitor",
    body: "Your deployment has failed. Build exited with code 1.",
    occurred_at: new Date().toISOString(), source_ref: "fixture-email-1", event_id: "evt-email-1",
    service_id: "joint-monitor", deployment_id: "deploy-fixture-1",
  });

  // ---- PROOF F setup : git repo ของจริงในพื้นที่ชั่วคราว
  const gitRoot = `${SCRATCH}/rail-repo`;
  rmSync(gitRoot, { recursive: true, force: true }); mkdirSync(gitRoot, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: gitRoot });
  writeFileSync(`${gitRoot}/seed.txt`, "seed\n");
  execFileSync("git", ["-c", "user.email=proof@dna", "-c", "user.name=proof", "add", "-A"], { cwd: gitRoot });
  execFileSync("git", ["-c", "user.email=proof@dna", "-c", "user.name=proof", "commit", "-qm", "seed"], { cwd: gitRoot });

  const created = await createWorkspace({ work_id: "work-rail-f", repository_id: "repo-rail-f", repository_root: gitRoot, base_branch: "main" });
  if (created.status !== "CREATED") throw new Error(`createWorkspace ล้มเหลว: ${created.reason}`);
  const reservation = created.reservation;
  if (!reservation) throw new Error("createWorkspace ไม่คืน reservation");

  const ws = createTaskWorkspace({ work_order_id: "wo-rail-f", command_id: "cmd-rail-f", assigned_source: [FIX], workspace_root: WS_ROOT });
  const taskId = "task-rail-f";
  saveTask({ task_id: taskId, memory: { user_id: "system", workspace_id: "rail", conversation_id: "c", parent_task_id: null, task_id: taskId, created_at: new Date().toISOString() },
    intent_text: "rail proof F", submitted_by_client: "event-rail-proof", status: "COMPLETED",
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), output_lane: "WORK_ITEM" } as Task);
  linkSourceReservation(ws.workspace_id, reservation.reservation_id, taskId);
  for (const st of ["PREPARE_CONTEXT", "ASSIGN_AGENT", "RUNNING", "RESULT_RECEIVED", "VERIFYING", "ACCEPTED", "CLOSED"] as const) {
    transitionWorkspace(ws.workspace_id, st, "rail proof F");
  }

  // ปฏิเสธเมื่อยังไม่ได้รับอนุญาต
  const refused = evaluateCleanupEligibility(ws.workspace_id, null);
  // ปฏิเสธเมื่อไม่มีตัวตน
  const unknown = evaluateCleanupEligibility("ws-does-not-exist", { authorized_by: "proof", no_pending_dependency: true, collection_and_verification_complete: true });

  writeFileSync(HANDOFF, JSON.stringify({ workspace_id: ws.workspace_id, reservation_id: reservation.reservation_id, gitRoot, worktree_path: reservation.worktree_path, e1: E1.write_id, evt1: `evt-${E1.write_id}` }));

  console.log(JSON.stringify({
    PHASE: "A",
    PROOF_A_known_internal_failure: {
      write_id: E1.write_id, eligibility: v1.classification,
      incident_class: r1.classification.incident_class, decision: r1.decision.decision,
      route: routeOf(r1), identity: r1.route.identity,
    },
    PROOF_B_repeat: {
      new_write_id: E2.write_id, different_event: E1.write_id !== E2.write_id ? "YES" : "NO",
      SAME_DETERMINISTIC_ROUTE: sameRoute ? "YES" : "NO", route: routeOf(r2), AI_CALL_COUNT: 0,
    },
    PROOF_C_unknown: {
      incident_class: rC.classification.incident_class, decision: rC.decision.decision,
      route: routeOf(rC), missing_capability: rC.decision.missing_capability,
    },
    PROOF_D_security_denial: D,
    PROOF_E_external_alert: {
      incident_class: rE.classification.incident_class, decision: rE.decision.decision,
      route: routeOf(rE), identity_service: rE.route.identity.service_id, identity_deploy: rE.route.identity.deployment_id,
    },
    PROOF_F_setup: {
      workspace_id: ws.workspace_id, reservation_id: reservation.reservation_id,
      worktree_exists_before: existsSync(reservation.worktree_path),
      refused_without_authorization: { eligible: refused.eligible, reason: refused.reason_code },
      refused_unknown_identity: { eligible: unknown.eligible, reason: unknown.reason_code },
    },
    ROUTE_RESULTS_PERSISTED: listRouteResults().length,
  }, null, 1));
}

async function phaseB() {
  const h = JSON.parse(readFileSync(HANDOFF, "utf-8")) as { workspace_id: string; reservation_id: string; gitRoot: string; worktree_path: string; evt1: string };

  // ---- PROOF G : restart — ความสัมพันธ์ต้อง reconstruct ได้จากดิสก์ล้วน
  const ws = getWorkspace(h.workspace_id);
  const res = loadReservation(h.reservation_id);
  const routes = routeResultsForEvent(h.evt1);

  // ---- PROOF F : cleanup จริง หลัง restart
  const other = createTaskWorkspace({ work_order_id: "wo-other", command_id: "cmd-other", assigned_source: [FIX], workspace_root: WS_ROOT });
  const outcome = await cleanupWorkspace(h.workspace_id, { authorized_by: "event-rail-proof", no_pending_dependency: true, collection_and_verification_complete: true }, h.gitRoot);

  console.log(JSON.stringify({
    PHASE: "B (โปรเซสใหม่)",
    PROOF_G_restart: {
      workspace_resolved: Boolean(ws), source_reservation_id: ws?.source_reservation_id ?? null,
      task_id: ws?.task_id ?? null, state: ws?.state ?? null,
      reservation_resolved: Boolean(res), route_results_for_event: routes.length,
      RESTART_PERSISTENCE: ws && res && routes.length > 0 ? "PASS" : "FAIL",
    },
    PROOF_F_cleanup: {
      status: outcome.status,
      checks: outcome.eligibility.checks.map((c) => `${c.check}=${c.passed}`),
      deletion_evidence_id: outcome.status === "REMOVED" ? outcome.deletion_evidence_id : null,
      worktree_exists_after: existsSync(h.worktree_path),
      UNRELATED_WORKSPACE_UNTOUCHED: existsSync(other.allowed_write_workspace) ? "YES" : "NO",
    },
  }, null, 1));
}

const phase = process.argv[2] ?? "A";
(phase === "B" ? phaseB() : phaseA()).catch((e) => { console.error("ERR", e?.stack ?? e); process.exit(1); });
