/**
 * PROOF: WriteAuditEvent context + source-event claim boundary
 *
 * รันสองเฟสคนละโปรเซส เพื่อพิสูจน์ว่า claim รอด restart จริง
 *   phase A: สร้างเหตุจริง E1 -> ส่งพร้อมกันสองครั้ง -> ส่งซ้ำหลังงานถึงปลายทาง
 *   phase B: โปรเซสใหม่ ส่ง E1 เดิมอีก -> ต้องถูกปฏิเสธ, แล้วสร้าง E2 ใหม่
 *
 * การส่ง E1 ซ้ำเป็นการทดสอบขอบเขตการอ้างสิทธิ์ตามที่ Owner สั่ง ไม่ใช่การให้
 * สะพาน replay แถวเก่า — สะพานไม่เคยอ่าน write-audit-log.json เลย
 */
process.env.AGENT_GATEWAY_DATA_DIR =
  "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE/tests/__pipeline__/isolated-store-claim";
process.env.SCHEDULER_ROUTE_DECISION_LOG =
  `${process.env.AGENT_GATEWAY_DATA_DIR}/route-decisions.jsonl`;
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { handleWriteAuditEvent, buildCorrectiveWorkOrder, listClaims, AUTOMATIC_AGENT_DISPATCH_ENABLED } from "../../control/write-failure-bridge/contract";
import { routeRequestedAction } from "../../control/agent-gateway/agent-authority-router";
import { createTaskWorkspace } from "../../control/agent-gateway/workspace-manager";
import { getTask } from "../../control/agent-gateway/contract";
import { listWriteAudit } from "../../execution/file-write/contract";
import type { WriteAuditEvent } from "../../execution/file-write/contract";

const REPO = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE";
const SANDBOX_REL = "tests/__sandbox__/true-test-a";
const FIX = `${REPO}/${SANDBOX_REL}`;
const WS_ROOT = `${REPO}/control/agent-host/test-workspace/allowed`;
const HANDOFF = "/private/tmp/claude-501/-Users-tam-Desktop-DNA-OS-INFRASTRUCTURE/f09839f8-ba2f-462c-9ca0-1b1e187c6923/scratchpad/e1.json";

/**
 * เหตุจริง: ไฟล์ที่อ่านได้แต่เขียนไม่ได้ (0444) — Write Gate ตอบ ALLOW_MODIFY
 * ก่อน แล้ว executor ล้มจริงที่ชั้นระบบไฟล์ ไม่ใช่การปฏิเสธเชิงสิทธิ์
 * และเพราะยังอ่านได้ สะพานจึงวัด content ปัจจุบันได้จริง
 */
async function causeRealAuthorizedFailure(tag: string): Promise<WriteAuditEvent> {
  mkdirSync(FIX, { recursive: true });
  mkdirSync(WS_ROOT, { recursive: true });
  const rel = `${SANDBOX_REL}/readonly-${tag}.txt`;
  const abs = `${REPO}/${rel}`;
  if (existsSync(abs)) chmodSync(abs, 0o644);
  writeFileSync(abs, `baseline ${tag}\n`);
  chmodSync(abs, 0o444);

  const ws = createTaskWorkspace({ work_order_id: `wo-claim-${tag}`, command_id: `cmd-claim-${tag}`, assigned_source: [FIX], workspace_root: WS_ROOT });
  const artifact = `${ws.allowed_write_workspace}/proposal.txt`;
  writeFileSync(artifact, `เนื้อหาที่ระบบตั้งใจเขียน ${tag}\n`);

  const before = listWriteAudit().length;
  await routeRequestedAction(
    { operation: "FILE_MODIFY", artifact_ref: `artifact://${artifact}`, target: rel },
    { workspace: ws, origin: { kind: "ADMITTED_TASK", task_id: `task-claim-${tag}`, command_id: `cmd-claim-${tag}` }, authorization_reference: null });
  const rows = listWriteAudit().slice(before);
  chmodSync(abs, 0o644);   // คืนสิทธิ์ทันที ไม่ทิ้ง fixture ที่เขียนไม่ได้ไว้
  const row = rows.at(-1);
  if (!row) throw new Error("ไม่มีแถว audit ใหม่เกิดขึ้น — เหตุไม่เกิดจริง");
  return row;
}

const claimsFor = (id: string) => listClaims().filter((c) => c.source_event_id === id);

async function phaseA() {
  const E1 = await causeRealAuthorizedFailure("e1");
  writeFileSync(HANDOFF, JSON.stringify(E1));

  const construction = buildCorrectiveWorkOrder(E1);

  // ---- CONCURRENCY: ส่ง E1 พร้อมกันสองครั้ง
  const [d1, d2] = await Promise.all([
    handleWriteAuditEvent(E1, { holder_id: "concurrent-a" }),
    handleWriteAuditEvent(E1, { holder_id: "concurrent-b" }),
  ]);
  const results = [d1, d2];
  const created = results.filter((r) => r.outcome.status === "EXECUTION_PLANNED");
  const denied = results.filter((r) => r.outcome.status === "CLAIM_DENIED");
  const won = created[0]?.outcome;
  const taskId = won && won.status === "EXECUTION_PLANNED" ? won.corrective_task_id : null;

  // ---- TERMINAL STATE: งานเดินจนถึงปลายทางแล้วส่ง E1 ซ้ำ
  const t = taskId ? getTask(taskId) : null;
  const beforeRepeat = claimsFor(E1.write_id).length;
  const repeat = await handleWriteAuditEvent(E1, { holder_id: "after-terminal" });
  const newTasksAfterTerminal = repeat.outcome.status === "EXECUTION_PLANNED" ? 1 : 0;

  console.log(JSON.stringify({
    PHASE: "A",
    WRITE_AUDIT_CONTEXT: {
      write_id: E1.write_id, operation: E1.operation, target_path: E1.target_path,
      target_type: E1.target_type, gate_decision_value: E1.gate_decision_value,
      status: E1.status, refusal_code: E1.refusal_code, resolved_path: E1.resolved_path,
      CONTENT_STORED_IN_AUDIT: Object.prototype.hasOwnProperty.call(E1, "content") ? "YES" : "NO",
      REFUSED_EVENT_HAS_MACHINE_CONTEXT: E1.target_path && E1.operation ? "YES" : "NO",
    },
    CORRECTIVE_WORK: construction.ok
      ? { CONSTRUCTION: "SUPPORTED", FIELDS_USED: construction.fields_used,
          work_order: { operation: construction.work_order.operation, target_path: construction.work_order.target_path,
            workspace_scope: construction.work_order.workspace_scope, content_bytes: construction.work_order.content.length,
            has_agent_run: "agent_run" in construction.work_order ? "YES" : "NO" } }
      : { CONSTRUCTION: "MISSING_CONTEXT", missing: construction.missing_fields },
    CONCURRENCY: {
      CONCURRENT_E1_DELIVERY_COUNT: 2,
      E1_CLAIM_SUCCESS_COUNT: created.length,
      CLAIM_DENIED_COUNT: denied.length,
      E1_TASK_CREATED_COUNT: created.length,
      denied_reason: denied[0]?.outcome.status === "CLAIM_DENIED" ? (denied[0].outcome as { reason_code: string }).reason_code : null,
      CORRECTIVE_TASK_ID: taskId,
    },
    TERMINAL_STATE: {
      task_status: t?.status ?? null,
      repeat_outcome: repeat.outcome.status,
      E1_AFTER_TERMINAL_NEW_TASK_COUNT: newTasksAfterTerminal,
      claim_rows_before_repeat: beforeRepeat,
      claim_rows_after_repeat: claimsFor(E1.write_id).length,
    },
    CLAIM_ROWS: claimsFor(E1.write_id).map((c) => ({ state: c.state, task: c.corrective_task_id, holder: c.holder_id })),
    AUTOMATIC_AGENT_DISPATCH_ENABLED,
    AGENT_DISPATCHED: results.some((r) => r.agent_dispatched) ? "YES" : "NO",
  }, null, 1));
}

async function phaseB() {
  const E1 = JSON.parse(readFileSync(HANDOFF, "utf-8")) as WriteAuditEvent;
  const afterRestart = await handleWriteAuditEvent(E1, { holder_id: "after-restart" });

  const E2 = await causeRealAuthorizedFailure("e2");
  const e2Result = await handleWriteAuditEvent(E2, { holder_id: "e2" });

  console.log(JSON.stringify({
    PHASE: "B (โปรเซสใหม่)",
    E1_AFTER_RESTART: {
      outcome: afterRestart.outcome.status,
      reason: afterRestart.outcome.status === "CLAIM_DENIED" ? (afterRestart.outcome as { reason_code: string }).reason_code : null,
      E1_AFTER_RESTART_NEW_TASK_COUNT: afterRestart.outcome.status === "EXECUTION_PLANNED" ? 1 : 0,
    },
    E2: {
      E2_NEW_WRITE_ID: E2.write_id,
      same_as_e1: E2.write_id === E1.write_id ? "YES" : "NO",
      outcome: e2Result.outcome.status,
      E2_CLAIM_SUCCESS: e2Result.outcome.status === "EXECUTION_PLANNED" ? "YES" : "NO",
      E2_TASK_CREATED_COUNT: e2Result.outcome.status === "EXECUTION_PLANNED" ? 1 : 0,
      E2_CORRECTIVE_TASK_ID: e2Result.outcome.status === "EXECUTION_PLANNED" ? (e2Result.outcome as { corrective_task_id: string }).corrective_task_id : null,
    },
    AGENT_DISPATCHED: afterRestart.agent_dispatched || e2Result.agent_dispatched ? "YES" : "NO",
  }, null, 1));
}

const phase = process.argv[2] ?? "A";
(phase === "B" ? phaseB() : phaseA()).catch((e) => { console.error("ERR", e?.stack ?? e); process.exit(1); });
