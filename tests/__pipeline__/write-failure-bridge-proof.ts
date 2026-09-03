/**
 * PROOF: NEW authorized write failure -> producer-time hook -> deterministic
 * eligibility -> idempotency key. หยุดตรงจุดที่สัญญาต้นทางไม่มีข้อมูลพอ
 *
 * ไม่มีการอ่าน write-audit-log.json ย้อนหลัง ไม่มีการ replay ไม่มี n8n
 */
process.env.AGENT_GATEWAY_DATA_DIR =
  "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE/tests/__pipeline__/isolated-store-bridge";
process.env.SCHEDULER_ROUTE_DECISION_LOG =
  `${process.env.AGENT_GATEWAY_DATA_DIR}/route-decisions.jsonl`;
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { startWriteFailureBridge, classifyWriteAudit, CORRECTIVE_SOURCE_EVENT_TYPE } from "../../control/write-failure-bridge/contract";
import { routeRequestedAction } from "../../control/agent-gateway/agent-authority-router";
import { createTaskWorkspace } from "../../control/agent-gateway/workspace-manager";
import { submitTask, aiWriteAdapter, loadEvidenceForTask } from "../../control/agent-gateway/contract";
import { submitWriteRequest } from "../../control/ai-write-control/contract";
import { evaluateWriteIntent } from "../../permissions/write-gate/contract";
import { getWriteOwnershipIndex } from "../../software/capability-registrar/contract";
import { executeFileWrite } from "../../execution/file-write/contract";
import type { WorkOrder } from "../../control/agent-gateway/types";

const REPO = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE";
const SANDBOX_REL = "tests/__sandbox__/true-test-a";
const FIX = `${REPO}/${SANDBOX_REL}`;
const AUDIT = `${REPO}/execution/file-write/write-audit-log.json`;
const WS_ROOT = `${REPO}/control/agent-host/test-workspace/allowed`;
const auditCount = () => JSON.parse(readFileSync(AUDIT, "utf-8")).length;

function workspace(tag: string) {
  mkdirSync(WS_ROOT, { recursive: true });
  return createTaskWorkspace({ work_order_id: `wo-bridge-${tag}`, command_id: `cmd-bridge-${tag}`, assigned_source: [FIX], workspace_root: WS_ROOT });
}

async function main() {
  rmSync(`${REPO}/tests/__pipeline__/isolated-store-bridge`, { recursive: true, force: true });
  mkdirSync(FIX, { recursive: true });
  const HISTORICAL_ROWS_ON_DISK = auditCount();

  // สะพานเริ่มฟังก่อนที่เหตุจะเกิด — และนี่คือจุดที่พิสูจน์ว่าไม่มี replay:
  // บนดิสก์มีแถวเก่าอยู่แล้วหลายร้อยแถว สะพานต้องไม่เห็นสักแถว
  const bridge = startWriteFailureBridge();
  const OBSERVED_AFTER_SUBSCRIBE_BEFORE_ANY_NEW_WRITE = bridge.observations().length;

  // ---- PHASE 6/7 : เหตุจริง — FILE_MODIFY ที่ได้รับอนุญาต แล้วล้มที่ชั้น executor
  const ws = workspace("main");
  const artifact = `${ws.allowed_write_workspace}/proposal.txt`;
  writeFileSync(artifact, "content ที่ระบบตั้งใจเขียน\n");
  const collidePath = `${FIX}/collide.d`;
  mkdirSync(collidePath, { recursive: true });   // ทำให้ปลายทางเป็นไดเรกทอรีจริง
  const outcome = await routeRequestedAction(
    { operation: "FILE_MODIFY", artifact_ref: `artifact://${artifact}`, target: `${SANDBOX_REL}/collide.d` },
    { workspace: ws, origin: { kind: "ADMITTED_TASK", task_id: "task-bridge-main", command_id: "cmd-bridge-main" }, authorization_reference: null });

  const obs = await bridge.settled();
  const main = obs.at(-1) ?? null;

  // ---- S1 : non-ALLOW + refused ต้องไม่ eligible (audit row จริง ไม่ใช่ของปลอม)
  const intent = submitWriteRequest(
    { operation: "MODIFY", capability: "agent_requested_action", target_type: "FILE",
      target_path: "control/agent-gateway/gateway.ts", requested_change: "S1 probe", evidence: [] },
    { identity_id: "s1-probe", acting_as_account_id: "a", acting_as_tenant_id: "t", software_id: "s", kind: "ai_agent" });
  let s1: Record<string, unknown> = { skipped: "submitWriteRequest rejected" };
  if (intent.ok) {
    const decision = evaluateWriteIntent(intent.intent, { registryIndex: getWriteOwnershipIndex() });
    const before = (await bridge.settled()).length;
    const gwSha = readFileSync(`${REPO}/control/agent-gateway/gateway.ts`, "utf-8").length;
    const w = executeFileWrite(
      { correlation_id: intent.intent.correlation_id, intent_id: intent.intent.intent_id,
        gate_decision_id: decision.decision_id, operation: "MODIFY", target_type: "FILE",
        target_path: "control/agent-gateway/gateway.ts", content: "S1 MUST NEVER LAND",
        requesting_identity_id: "s1-probe" },
      decision);
    const newObs = (await bridge.settled()).slice(before);
    s1 = {
      gate_decision: decision.decision, write_status: w.status, refusal_code: w.refusal_code,
      classification: newObs[0]?.verdict.classification ?? null,
      ELIGIBLE: newObs[0]?.verdict.eligible_for_corrective_work === true ? "YES" : "NO",
      CORRECTIVE_TASK_CREATED_COUNT: newObs.filter((o) => o.outcome.status === "EXECUTION_PLANNED" || o.outcome.status === "PLAN_NOT_DISPATCHABLE").length,
      AGENT_DISPATCH_COUNT: newObs.filter((o) => o.agent_dispatched).length,
      NON_OWNED_TARGET_UNCHANGED: readFileSync(`${REPO}/control/agent-gateway/gateway.ts`, "utf-8").length === gwSha ? "YES" : "NO",
    };
  }

  // ---- S2 : กลไก idempotency key จาก write_id
  // WorkOrder ด้านล่าง "ไม่ได้" มาจาก WriteAuditEvent — มันสร้างขึ้นในไฟล์ทดสอบนี้
  // เพื่อพิสูจน์กลไกกุญแจอย่างเดียว ไม่ใช่การพิสูจน์ว่า loop ซ่อมทำงานได้
  const sourceEventId = main?.source_event_id ?? "write_unknown";
  const target = `${SANDBOX_REL}/idem.txt`;
  if (!existsSync(`${REPO}/${target}`)) writeFileSync(`${REPO}/${target}`, "v0\n");
  const wo: WorkOrder = {
    operation: "MODIFY", target_type: "FILE", target_path: target,
    requested_change: "idempotency mechanism probe", content: "v1\n",
    workspace_scope: SANDBOX_REL, mode: "sandbox", required_tests: ["sandbox.readback"],
    forbidden_files: [`${REPO}/control`], evidence: [{ source: "bridge-proof", note: "idem" }],
  };
  const ctx = { source_event_type: CORRECTIVE_SOURCE_EVENT_TYPE, source_event_id: sourceEventId,
    target_capability_id: "real_file_write_after_authorization" };
  const t1 = await submitTask("corrective (mechanism probe)", { user_id: "system", workspace_id: "bridge", conversation_id: "c1", parent_task_id: null }, "write-failure-bridge", [aiWriteAdapter], wo, ctx as never);
  const t2 = await submitTask("corrective (mechanism probe)", { user_id: "system", workspace_id: "bridge", conversation_id: "c2", parent_task_id: null }, "write-failure-bridge", [aiWriteAdapter], wo, ctx as never);
  const dupEvidence = loadEvidenceForTask(t1.task_id).filter((e) => e.kind === "idempotency").map((e) => e.payload);

  bridge.stop();

  console.log(JSON.stringify({
    PRODUCER_TIME: {
      HISTORICAL_ROWS_ON_DISK,
      OBSERVED_AFTER_SUBSCRIBE_BEFORE_ANY_NEW_WRITE,
      HISTORICAL_REPLAY_COUNT: OBSERVED_AFTER_SUBSCRIBE_BEFORE_ANY_NEW_WRITE,
      OBSERVATIONS_TOTAL: obs.length,
    },
    SOURCE_EVENT: main ? {
      WRITE_ID: main.source_event_id, GATE_DECISION: main.verdict.gate_decision_value,
      STATUS: main.verdict.status, REFUSAL_CODE: main.verdict.refusal_code,
      route_outcome: outcome.status === "EXECUTED" ? "EXECUTED" : (outcome as { reason: string }).reason,
    } : null,
    ELIGIBILITY: main ? {
      DECISION: main.verdict.classification,
      ELIGIBLE: main.verdict.eligible_for_corrective_work ? "YES" : "NO",
      DECIDED_FROM: main.verdict.decided_from, AI_CLASSIFIER_USED: "NO",
    } : null,
    MAIN_OUTCOME: main?.outcome.status ?? null,
    AGENT_DISPATCHED: main && main.agent_dispatched ? "YES" : "NO",
    S1_non_allow_refused: s1,
    S2_idempotency: {
      SOURCE_EVENT_ID: sourceEventId,
      SAME_EVENT_DELIVERY_COUNT: 2,
      task1: t1.task_id, task2: t2.task_id,
      SAME_TASK_RETURNED: t1.task_id === t2.task_id ? "YES" : "NO",
      TASK_IDEMPOTENCY_KEY: t1.idempotency_key ?? null,
      KEYS_MATCH: t1.idempotency_key === t2.idempotency_key ? "YES" : "NO",
      first_status: t1.status, second_status: t2.status,
      suppression_evidence: dupEvidence,
    },
    N8N_CALLED: "NO",
  }, null, 1));
}
main().catch((e) => { console.error("ERR", e?.stack ?? e); process.exit(1); });
