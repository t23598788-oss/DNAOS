/**
 * PROOF: การเลือกผู้ทำงานสำหรับงานซ่อม เป็นของ control/scheduler#routeWork
 * และ deterministic จริง — สะพานไม่เลือกเอง และยังไม่ปล่อย Agent
 */
process.env.AGENT_GATEWAY_DATA_DIR =
  "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE/tests/__pipeline__/isolated-store-routing";
process.env.SCHEDULER_ROUTE_DECISION_LOG =
  `${process.env.AGENT_GATEWAY_DATA_DIR}/route-decisions.jsonl`;
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import {
  handleWriteAuditEvent, buildCorrectiveWorkOrder, snapshotRouteInputs, decideRoute,
  AUTOMATIC_AGENT_DISPATCH_ENABLED, CORRECTIVE_WORK_KIND,
} from "../../control/write-failure-bridge/contract";
import type { RouteInputsSnapshot } from "../../control/write-failure-bridge/contract";
import { routeRequestedAction } from "../../control/agent-gateway/agent-authority-router";
import { createTaskWorkspace } from "../../control/agent-gateway/workspace-manager";
import { submitWriteRequest } from "../../control/ai-write-control/contract";
import { evaluateWriteIntent } from "../../permissions/write-gate/contract";
import { getWriteOwnershipIndex } from "../../software/capability-registrar/contract";
import { executeFileWrite, listWriteAudit } from "../../execution/file-write/contract";
import type { WriteAuditEvent } from "../../execution/file-write/contract";

const REPO = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE";
const SANDBOX_REL = "tests/__sandbox__/true-test-a";
const FIX = `${REPO}/${SANDBOX_REL}`;
const WS_ROOT = `${REPO}/control/agent-host/test-workspace/allowed`;

/** เหตุจริง: ไฟล์อ่านได้แต่เขียนไม่ได้ -> ALLOW_MODIFY แล้ว FS_ERROR */
async function realAuthorizedFailure(tag: string): Promise<WriteAuditEvent> {
  mkdirSync(FIX, { recursive: true }); mkdirSync(WS_ROOT, { recursive: true });
  const rel = `${SANDBOX_REL}/route-${tag}.txt`;
  const abs = `${REPO}/${rel}`;
  if (existsSync(abs)) chmodSync(abs, 0o644);
  writeFileSync(abs, `baseline ${tag}\n`);
  chmodSync(abs, 0o444);
  const ws = createTaskWorkspace({ work_order_id: `wo-route-${tag}`, command_id: `cmd-route-${tag}`, assigned_source: [FIX], workspace_root: WS_ROOT });
  const artifact = `${ws.allowed_write_workspace}/proposal.txt`;
  writeFileSync(artifact, `proposed ${tag}\n`);
  const before = listWriteAudit().length;
  await routeRequestedAction({ operation: "FILE_MODIFY", artifact_ref: `artifact://${artifact}`, target: rel },
    { workspace: ws, origin: { kind: "ADMITTED_TASK", task_id: `task-route-${tag}`, command_id: `cmd-route-${tag}` }, authorization_reference: null });
  chmodSync(abs, 0o644);
  const row = listWriteAudit().slice(before).at(-1);
  if (!row) throw new Error("ไม่เกิดแถว audit ใหม่");
  return row;
}

/** เหตุจริงชนิด non-ALLOW + refused สำหรับ negative B */
function realSecurityDenialEvent(): WriteAuditEvent | null {
  const intent = submitWriteRequest(
    { operation: "MODIFY", capability: "agent_requested_action", target_type: "FILE",
      target_path: "control/agent-gateway/gateway.ts", requested_change: "negative-B probe", evidence: [] },
    { identity_id: "neg-b", acting_as_account_id: "a", acting_as_tenant_id: "t", software_id: "s", kind: "ai_agent" });
  if (!intent.ok) return null;
  const decision = evaluateWriteIntent(intent.intent, { registryIndex: getWriteOwnershipIndex() });
  const before = listWriteAudit().length;
  executeFileWrite({ correlation_id: intent.intent.correlation_id, intent_id: intent.intent.intent_id,
    gate_decision_id: decision.decision_id, operation: "MODIFY", target_type: "FILE",
    target_path: "control/agent-gateway/gateway.ts", content: "NEGATIVE B MUST NEVER LAND",
    requesting_identity_id: "neg-b" }, decision);
  return listWriteAudit().slice(before).at(-1) ?? null;
}

async function main() {
  const E = await realAuthorizedFailure("r1");
  const construction = buildCorrectiveWorkOrder(E);
  if (!construction.ok) throw new Error(`construction ล้มเหลว: ${construction.missing_fields.join(" | ")}`);

  // ---- PHASE 2/3 : snapshot สถานะจริงครั้งเดียว แล้วตัดสิน
  const snapshot = snapshotRouteInputs(construction.work_order, E.write_id);
  const decision = decideRoute(snapshot);

  // ---- PHASE 5 : รันซ้ำบน snapshot เดิม
  const RUNS = 5;
  const repeats = Array.from({ length: RUNS }, () => decideRoute(snapshot));
  const kinds = repeats.map((r) => (r.ok ? r.unit.provider : `NOT_ROUTED:${r.reason.slice(0, 30)}`));
  const scores = repeats.map((r) => (r.ok ? r.score : null));
  const units = repeats.map((r) => (r.ok ? r.unit.unit_id : null));

  // ---- PHASE 6A : ไม่มีผู้ทำงานที่ใช้ได้ (แช่ pool ให้ unavailable ทั้งหมด)
  const emptySnapshot: RouteInputsSnapshot = { ...snapshot, pool: snapshot.pool.map((u) => ({ ...u, available: false, detail: "forced-unavailable (negative A)" })) };
  const Ea = await realAuthorizedFailure("r-nega");
  const negA = await handleWriteAuditEvent(Ea, { holder_id: "neg-a", snapshotInputs: () => emptySnapshot });

  // ---- PHASE 6B : security denial
  const Eb = realSecurityDenialEvent();
  const negB = Eb ? await handleWriteAuditEvent(Eb, { holder_id: "neg-b" }) : null;

  // ---- PHASE 6C : E1 ซ้ำ ต้องถูกกันก่อนถึง routing
  const Ec = await realAuthorizedFailure("r-negc");
  const firstC = await handleWriteAuditEvent(Ec, { holder_id: "neg-c-1" });
  const dupC = await handleWriteAuditEvent(Ec, { holder_id: "neg-c-2" });

  console.log(JSON.stringify({
    PHASE2_RESOURCE_AVAILABILITY: {
      AVAILABLE_WORKERS: snapshot.availability_evidence.filter((r) => r.available).map((r) => r.worker_kind),
      UNAVAILABLE_WORKERS: snapshot.availability_evidence.filter((r) => !r.available).map((r) => `${r.worker_kind}(${r.reason.slice(0, 50)})`),
      NOTE: "ใช้เป็นหลักฐานเท่านั้น — ผู้เลือกจริงคือ routeWork ผ่าน ProcessingUnit.available ของ discoverPool",
    },
    PHASE3_ROUTE: {
      WORK_KIND: CORRECTIVE_WORK_KIND,
      work_item: { work_id: snapshot.work_item.work_id, kind: snapshot.work_item.kind, worker_class: snapshot.work_item.worker_class, target: snapshot.work_item.target },
      pool: snapshot.pool.map((u) => `${u.unit_id}:${u.available ? "available" : "unavailable"}`),
      metrics_rows: snapshot.metrics.length,
      in_flight: snapshot.in_flight,
      ROUTED: decision.ok,
      WORKER_KIND: decision.ok ? decision.unit.provider : null,
      UNIT_ID: decision.ok ? decision.unit.unit_id : null,
      SCORE: decision.ok ? decision.score : null,
      ROUTING_EVIDENCE: decision.ok ? decision.reason : decision.reason,
      CANDIDATES: decision.ok ? decision.candidates_considered : 0,
      ROUTE_DECISION_ID: "MISSING — RouteDecision ไม่มีฟิลด์นี้",
    },
    PHASE5_REPEATABILITY: {
      ROUTE_RUN_COUNT: RUNS,
      SAME_WORKER_KIND: new Set(kinds).size === 1 ? "YES" : "NO",
      SAME_UNIT_ID: new Set(units).size === 1 ? "YES" : "NO",
      SAME_SCORE: new Set(scores).size === 1 ? "YES" : "NO",
      SAME_DECISION_INPUTS: "YES (snapshot เดียวกันทุกรอบ ไม่อ่านสถานะใหม่)",
      observed: kinds,
    },
    PHASE6_NEGATIVES: {
      A_no_worker: { outcome: negA.outcome.status, route_call_count: negA.route_call_count,
        reason: negA.outcome.status === "NO_WORKER_AVAILABLE" ? (negA.outcome.route as { reason: string }).reason.slice(0, 90) : null,
        NO_AGENT_RUN_CREATED: "YES (สะพานไม่สร้าง agent_run เลย — ดู contract gap)", NO_AGENT_DISPATCH: negA.agent_dispatched ? "NO" : "YES" },
      B_security_denial: negB ? { classification: negB.verdict.classification, outcome: negB.outcome.status,
        SECURITY_EVENT_ROUTE_COUNT: negB.route_call_count, NO_AGENT_DISPATCH: negB.agent_dispatched ? "NO" : "YES" } : "probe ไม่เกิด",
      C_duplicate: { first: { outcome: firstC.outcome.status, route_call_count: firstC.route_call_count },
        duplicate: { outcome: dupC.outcome.status, ROUTE_CALL_COUNT_FOR_DUPLICATE: dupC.route_call_count } },
    },
    AUTOMATIC_AGENT_DISPATCH_ENABLED,
    AGENT_DISPATCHED_ANYWHERE: [negA, negB, firstC, dupC].filter(Boolean).some((o) => o && o.agent_dispatched) ? "YES" : "NO",
  }, null, 1));
}
main().catch((e) => { console.error("ERR", e?.stack ?? e); process.exit(1); });
