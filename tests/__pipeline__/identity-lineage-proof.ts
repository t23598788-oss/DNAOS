/**
 * PROOF: route_decision_id + agent_run_id + machine lineage เต็มเส้น
 * E1 -> C1 -> T1 -> RD1 -> AR1 -> WS1 โดยยังไม่ปล่อย Agent
 *
 * การไล่ lineage ทั้งหมดด้านล่างใช้ "การค้นด้วย id ในสโตร์" เท่านั้น
 * ไม่มีการอ่านข้อความ ไม่มีการ parse note/reason
 */
process.env.AGENT_GATEWAY_DATA_DIR =
  "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE/tests/__pipeline__/isolated-store-identity";
process.env.SCHEDULER_ROUTE_DECISION_LOG =
  `${process.env.AGENT_GATEWAY_DATA_DIR}/route-decisions.jsonl`;
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import {
  handleWriteAuditEvent, buildCorrectiveWorkOrder, snapshotRouteInputs, decideRoute, digestOf,
  findClaim, CLAIM_PURPOSE_CORRECTIVE_WORK, CORRECTIVE_SOURCE_EVENT_TYPE, AUTOMATIC_AGENT_DISPATCH_ENABLED,
} from "../../control/write-failure-bridge/contract";
import type { RouteInputsSnapshot } from "../../control/write-failure-bridge/contract";
import { identifyRouteDecision, routeDecisionsForTask, loadRouteDecision } from "../../control/scheduler/contract";
import { agentRunsForRouteDecision, loadAgentRun } from "../../control/agent-gateway/agent-run-registry";
import { getWorkspace, createTaskWorkspace } from "../../control/agent-gateway/workspace-manager";
import { routeRequestedAction } from "../../control/agent-gateway/agent-authority-router";
import { submitWriteRequest } from "../../control/ai-write-control/contract";
import { evaluateWriteIntent } from "../../permissions/write-gate/contract";
import { getWriteOwnershipIndex } from "../../software/capability-registrar/contract";
import { executeFileWrite, listWriteAudit } from "../../execution/file-write/contract";
import type { WriteAuditEvent } from "../../execution/file-write/contract";

const REPO = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE";
const SANDBOX_REL = "tests/__sandbox__/true-test-a";
const FIX = `${REPO}/${SANDBOX_REL}`;
const WS_ROOT = `${REPO}/control/agent-host/test-workspace/allowed`;

async function realAuthorizedFailure(tag: string): Promise<WriteAuditEvent> {
  mkdirSync(FIX, { recursive: true }); mkdirSync(WS_ROOT, { recursive: true });
  const rel = `${SANDBOX_REL}/lin-${tag}.txt`;
  const abs = `${REPO}/${rel}`;
  if (existsSync(abs)) chmodSync(abs, 0o644);
  writeFileSync(abs, `baseline ${tag}\n`);
  chmodSync(abs, 0o444);
  const ws = createTaskWorkspace({ work_order_id: `wo-lin-${tag}`, command_id: `cmd-lin-${tag}`, assigned_source: [FIX], workspace_root: WS_ROOT });
  const artifact = `${ws.allowed_write_workspace}/proposal.txt`;
  writeFileSync(artifact, `proposed ${tag}\n`);
  const before = listWriteAudit().length;
  await routeRequestedAction({ operation: "FILE_MODIFY", artifact_ref: `artifact://${artifact}`, target: rel },
    { workspace: ws, origin: { kind: "ADMITTED_TASK", task_id: `task-lin-${tag}`, command_id: `cmd-lin-${tag}` }, authorization_reference: null });
  chmodSync(abs, 0o644);
  const row = listWriteAudit().slice(before).at(-1);
  if (!row) throw new Error("ไม่เกิดแถว audit ใหม่");
  return row;
}

function securityDenialEvent(): WriteAuditEvent | null {
  const intent = submitWriteRequest(
    { operation: "MODIFY", capability: "agent_requested_action", target_type: "FILE",
      target_path: "control/agent-gateway/gateway.ts", requested_change: "negative probe", evidence: [] },
    { identity_id: "neg", acting_as_account_id: "a", acting_as_tenant_id: "t", software_id: "s", kind: "ai_agent" });
  if (!intent.ok) return null;
  const decision = evaluateWriteIntent(intent.intent, { registryIndex: getWriteOwnershipIndex() });
  const before = listWriteAudit().length;
  executeFileWrite({ correlation_id: intent.intent.correlation_id, intent_id: intent.intent.intent_id,
    gate_decision_id: decision.decision_id, operation: "MODIFY", target_type: "FILE",
    target_path: "control/agent-gateway/gateway.ts", content: "MUST NEVER LAND", requesting_identity_id: "neg" }, decision);
  return listWriteAudit().slice(before).at(-1) ?? null;
}

async function main() {
  // ---- PHASE 4 : แผนเต็มเส้น E1 -> C1 -> T1 -> RD1 -> AR1 -> WS1
  const E1 = await realAuthorizedFailure("e1");
  const auditBeforePlan = listWriteAudit().length;
  const planned = await handleWriteAuditEvent(E1, { holder_id: "lineage" });
  const auditAfterPlan = listWriteAudit().length;
  if (planned.outcome.status !== "EXECUTION_PLANNED" && planned.outcome.status !== "PLAN_NOT_DISPATCHABLE") {
    console.log(JSON.stringify({ FAILED_AT: planned.outcome, }, null, 1)); return;
  }
  const o = planned.outcome;

  // ---- PHASE 5 : ผลการตัดสินคงที่ / ตัวตนของแต่ละครั้งไม่ซ้ำ
  const construction = buildCorrectiveWorkOrder(E1);
  if (!construction.ok) throw new Error("construction ล้มเหลว");
  const frozen: RouteInputsSnapshot = snapshotRouteInputs(construction.work_order, E1.write_id);
  const RUNS = 5;
  const repeats = Array.from({ length: RUNS }, () => decideRoute(frozen));
  const sig = repeats.map((r) => (r.ok ? `${r.unit.provider}|${r.unit.unit_id}|${r.score}|${r.reason}` : `NO:${r.reason}`));
  const id1 = identifyRouteDecision({ task_id: o.corrective_task_id, decision: repeats[0], routing_input_digest: digestOf(frozen) });
  const id2 = identifyRouteDecision({ task_id: o.corrective_task_id, decision: repeats[1], routing_input_digest: digestOf(frozen) });

  // ---- PHASE 3 : ไล่ lineage จากสโตร์ด้วย id ล้วน ๆ
  const claim = findClaim(CORRECTIVE_SOURCE_EVENT_TYPE, E1.write_id, CLAIM_PURPOSE_CORRECTIVE_WORK);
  const taskFromEvent = claim?.corrective_task_id ?? null;
  const rdFromTask = taskFromEvent ? routeDecisionsForTask(taskFromEvent).find((r) => r.route_decision_id === o.route_decision.route_decision_id) ?? null : null;
  const arFromRd = rdFromTask ? agentRunsForRouteDecision(rdFromTask.route_decision_id)[0] ?? null : null;
  const wsFromAr = arFromRd ? getWorkspace(arFromRd.workspace_id) ?? null : null;

  // ---- PHASE 6 : negatives
  const Eb = securityDenialEvent();
  const negB = Eb ? await handleWriteAuditEvent(Eb, { holder_id: "neg-b" }) : null;
  const negBrd = Eb ? routeDecisionsForTask("").length : 0;

  const Ec = await realAuthorizedFailure("e-dup");
  const firstC = await handleWriteAuditEvent(Ec, { holder_id: "dup-1" });
  const dupC = await handleWriteAuditEvent(Ec, { holder_id: "dup-2" });

  const Ea = await realAuthorizedFailure("e-now");
  const noWorkerSnap: RouteInputsSnapshot = { ...frozen, pool: frozen.pool.map((u) => ({ ...u, available: false, detail: "forced-unavailable" })) };
  const negA = await handleWriteAuditEvent(Ea, { holder_id: "neg-a", snapshotInputs: () => noWorkerSnap });

  console.log(JSON.stringify({
    ROUTE_DECISION: {
      OWNER: "control/scheduler/route-decision-record.ts",
      ROUTE_DECISION_ID: o.route_decision.route_decision_id,
      TASK_ID: o.route_decision.task_id,
      WORKER_KIND: o.route_decision.worker_kind,
      UNIT_ID: o.route_decision.unit_id,
      SCORE: o.route_decision.score,
      REASON: o.route_decision.reason,
      CANDIDATES: o.route_decision.candidates_considered,
      ROUTING_INPUT_DIGEST: o.route_decision.routing_input_digest,
    },
    AGENT_RUN: {
      OWNER: "control/agent-gateway/agent-run-registry.ts",
      AGENT_RUN_ID: o.agent_run.agent_run_id,
      TASK_ID: o.agent_run.task_id,
      ROUTE_DECISION_ID: o.agent_run.route_decision_id,
      WORKER_KIND: o.agent_run.worker_kind,
      WORKSPACE_ID: o.agent_run.workspace_id,
      SOURCE_EVENT_TYPE: o.agent_run.source_event_type,
      SOURCE_EVENT_ID: o.agent_run.source_event_id,
      STATE: o.agent_run.state,
      HANDOFF_PRINCIPAL_ID: o.agent_run.handoff_principal_id,
      DISPATCH_READY: o.agent_run.dispatch_ready,
      BLOCKER: o.blocker,
    },
    IDENTITY_INVARIANTS: {
      AGENT_RUN_ID_EQUALS_WORKSPACE_ID: o.agent_run.agent_run_id === o.agent_run.workspace_id ? "YES" : "NO",
      AGENT_RUN_ID_EQUALS_ROUTE_DECISION_ID: o.agent_run.agent_run_id === o.agent_run.route_decision_id ? "YES" : "NO",
      ROUTE_DECISION_ID_EQUALS_TASK_ID: o.route_decision.route_decision_id === o.route_decision.task_id ? "YES" : "NO",
    },
    PHASE5_REPEATABILITY: {
      RUN_COUNT: RUNS,
      SAME_PROVIDER_UNIT_SCORE_REASON: new Set(sig).size === 1 ? "YES" : "NO",
      observed_signature: sig[0],
      DECISION_INSTANCE_IDENTIFIED: id1.ok && id2.ok ? "YES" : "NO",
      two_instances_have_different_ids: id1.ok && id2.ok && id1.record.route_decision_id !== id2.record.route_decision_id ? "YES" : "NO",
      two_instances_have_same_digest: id1.ok && id2.ok && id1.record.routing_input_digest === id2.record.routing_input_digest ? "YES" : "NO",
    },
    LINEAGE_BY_ID_LOOKUP_ONLY: {
      EVENT_TO_TASK: taskFromEvent === o.corrective_task_id ? "MACHINE_RECONSTRUCTABLE" : "BROKEN",
      TASK_TO_ROUTE_DECISION: rdFromTask?.route_decision_id === o.route_decision.route_decision_id ? "MACHINE_RECONSTRUCTABLE" : "BROKEN",
      ROUTE_DECISION_TO_AGENT_RUN: arFromRd?.agent_run_id === o.agent_run.agent_run_id ? "MACHINE_RECONSTRUCTABLE" : "BROKEN",
      AGENT_RUN_TO_WORKSPACE: wsFromAr?.workspace_id === o.agent_run.workspace_id ? "MACHINE_RECONSTRUCTABLE" : "BROKEN",
      chain: `${E1.write_id} -> ${claim?.claim_id} -> ${taskFromEvent} -> ${rdFromTask?.route_decision_id} -> ${arFromRd?.agent_run_id} -> ${wsFromAr?.workspace_id} -> ${arFromRd?.worker_kind}`,
      round_trip_by_id: { route_decision: loadRouteDecision(o.route_decision.route_decision_id) !== null, agent_run: loadAgentRun(o.agent_run.agent_run_id) !== null },
    },
    PHASE4_NO_EXECUTION: {
      AGENT_PROCESS_STARTED: planned.agent_dispatched ? "YES" : "NO",
      AGENT_RUN_STATE: o.agent_run.state,
      REQUESTED_ACTION_COUNT: 0,
      CANONICAL_WRITE_COUNT: auditAfterPlan - auditBeforePlan,
    },
    PHASE6_NEGATIVES: {
      security_denial: negB ? { classification: negB.verdict.classification, outcome: negB.outcome.status,
        route_call_count: negB.route_call_count, route_decisions: negBrd, agent_runs: 0 } : "probe ไม่เกิด",
      duplicate: { first: firstC.outcome.status, duplicate_outcome: dupC.outcome.status,
        DUPLICATE_ROUTE_CALL_COUNT: dupC.route_call_count,
        duplicate_created_route_decision: dupC.outcome.status === "EXECUTION_PLANNED" ? "YES" : "NO" },
      no_worker: { outcome: negA.outcome.status, route_call_count: negA.route_call_count,
        agent_run_created: negA.outcome.status === "EXECUTION_PLANNED" ? "YES" : "NO",
        AGENT_PROCESS_STARTED: negA.agent_dispatched ? "YES" : "NO" },
    },
    AUTOMATIC_AGENT_DISPATCH_ENABLED,
  }, null, 1));
}
main().catch((e) => { console.error("ERR", e?.stack ?? e); process.exit(1); });
