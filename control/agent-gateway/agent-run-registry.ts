/**
 * หน้าที่: ตัวตนของ "ความพยายามรัน Agent หนึ่งครั้ง" — `agent_run_id` — และ
 * เส้นเชื่อมที่อ่านด้วยเครื่องได้ระหว่างมันกับงาน เส้นทางที่ถูกเลือก พื้นที่ทำงาน
 * และเหตุการณ์ต้นทาง
 *
 * อยู่ใน control/agent-gateway/ เพราะที่นี่คือขอบเขตการรัน Agent จริงของระบบ
 * (ทะเบียนเรียกมันว่า `dna-os-live-agent-execution-path`:
 * agent-host-dispatch.ts + agent-execution-loop.ts + agent-execution-contract.ts
 * + agent-host/worker-registry.ts) เจ้าของ id ต้องเป็นขอบเขตที่ลงมือรันจริง
 *
 * ทำไมไม่ใช้ `control/incident-remediation/types.ts#ExecutionAttempt`:
 * ชื่อคล้ายแต่ความหมายไม่ตรง — มันมีแค่ execution_id/provider/unit_id/started_at/
 * outcome/detail ไม่มี task_id, workspace_id, route_decision_id หรือเหตุการณ์
 * ต้นทางเลย และมันเป็นบันทึกของ "ความพยายามที่ถูกส่งออกไปแล้ว" ในสายงานของ
 * incident-remediation ซึ่งเป็นเส้นทางที่ Owner สั่งไม่ให้ใช้เป็น executor ของงานนี้
 *
 * PLANNED ไม่ใช่ STARTED: แถวที่เขียนที่นี่วันนี้แปลว่า "แผนการรันถูกประกอบครบ
 * และมีตัวตนแล้ว" เท่านั้น ไม่มีโปรเซสใดถูกปล่อย สถานะที่แปลว่ารันจริงต้องถูก
 * เพิ่มโดยผู้ที่ปล่อยโปรเซสจริง ไม่ใช่โดยไฟล์นี้
 *
 * Input: task_id + route_decision_id + worker_kind + workspace_id + เหตุการณ์ต้นทาง
 * Output: `planAgentRun`, `loadAgentRun`, `listAgentRuns`, `agentRunsForTask`,
 * `agentRunsForRouteDecision`, `AgentRunRecord`
 * Dependency ที่อนุญาต: ./host-runtime.ts, node:fs, node:path, node:crypto
 * สิ่งที่ห้ามแตะ: ห้ามให้ `agent_run_id` เท่ากับ `workspace_id` หรือ
 * `route_decision_id` — สามอย่างนี้ตอบคำถามคนละคำถาม และการรวมมันคือการทำให้
 * lineage อ่านผิด ห้ามลบแถว (append-only)
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

const DATA_DIR_RELATIVE = "control/agent-gateway/data";

function dataDir(): string {
  const override = process.env.AGENT_GATEWAY_DATA_DIR;
  if (override && override.length > 0) return override;
  return join(__dirname, "..", "..", DATA_DIR_RELATIVE);
}
function agentRunsFile(): string {
  return join(dataDir(), "agent-runs.jsonl");
}

/**
 * PLANNED  แผนถูกประกอบครบและมีตัวตนแล้ว ยังไม่มีโปรเซสใดถูกปล่อย
 * ค่าอื่นจะถูกเพิ่มโดยผู้ที่ปล่อยโปรเซสจริงเมื่อ Owner เปิด dispatch
 */
export type AgentRunState = "PLANNED";

export interface AgentRunRecord {
  readonly agent_run_id: string;
  readonly task_id: string;
  readonly route_decision_id: string;
  readonly worker_kind: string;
  readonly workspace_id: string;
  readonly source_event_type: string;
  readonly source_event_id: string;
  /**
   * ADDITIVE (Owner, RESOLVE_AGENT_HANDOFF_PRINCIPAL). principal ที่เชื่อถือได้
   * ซึ่งผลของการรันครั้งนี้จะถูกส่งมอบในนามของมัน — ค่าเดียวกับที่
   * `WorkResultInput.agent_id` ต้องได้รับ
   *
   * `null` = NOT_MEASURED ไม่ใช่ "ไม่ต้องมี": ตราบใดที่ยังเป็น null การรันนี้
   * ยังส่งผลเข้า Result Ingress ไม่ได้ ดู ./handoff-principal.ts ว่าขาดสัญญาใด
   * ห้ามเติมด้วย worker_kind และห้ามเติมด้วย "owner-console"
   */
  readonly handoff_principal_id: string | null;
  readonly state: AgentRunState;
  /** สรุปเชิงเครื่องว่าแผนนี้พร้อมถูกปล่อยหรือยัง — false เมื่อ principal ยังไม่มี */
  readonly dispatch_ready: boolean;
  readonly recorded_at: string;
}

/** `handoff_principal_id` ต้องระบุเสมอ (null ได้) — ไม่มีค่าปริยาย เพื่อไม่ให้ใครลืม */
export type PlanAgentRunInput = Omit<AgentRunRecord, "agent_run_id" | "state" | "recorded_at" | "dispatch_ready">;

export type PlanAgentRunOutcome =
  | { readonly ok: true; readonly record: AgentRunRecord }
  | { readonly ok: false; readonly reason: string; readonly missing_fields: readonly string[] };

/**
 * ประกอบแผนการรันหนึ่งครั้งให้มีตัวตน
 *
 * ปฏิเสธถ้าเส้นเชื่อมใดขาด — แผนที่ชี้กลับไปหาต้นทางไม่ครบไม่ควรมีตัวตน เพราะ
 * มันจะกลายเป็นแถวที่อ่าน lineage ย้อนไม่ได้
 */
export function planAgentRun(input: PlanAgentRunInput): PlanAgentRunOutcome {
  const missing = (["task_id", "route_decision_id", "worker_kind", "workspace_id", "source_event_type", "source_event_id"] as const)
    .filter((k) => !input[k] || String(input[k]).length === 0);
  if (missing.length > 0) {
    return { ok: false, reason: "INCOMPLETE_LINEAGE", missing_fields: missing };
  }
  const record: AgentRunRecord = {
    agent_run_id: `ar-${randomUUID()}`,
    task_id: input.task_id,
    route_decision_id: input.route_decision_id,
    worker_kind: input.worker_kind,
    workspace_id: input.workspace_id,
    source_event_type: input.source_event_type,
    source_event_id: input.source_event_id,
    handoff_principal_id: input.handoff_principal_id,
    state: "PLANNED",
    // ไม่มี principal = ผลของการรันไม่มีทางผ่าน Result Ingress = ยังปล่อยไม่ได้
    dispatch_ready: Boolean(input.handoff_principal_id),
    recorded_at: new Date().toISOString(),
  };
  const p = agentRunsFile();
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, `${JSON.stringify(record)}\n`, "utf8");
  return { ok: true, record };
}

export function listAgentRuns(): readonly AgentRunRecord[] {
  const p = agentRunsFile();
  if (!existsSync(p)) return [];
  const rows: AgentRunRecord[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line) as AgentRunRecord); } catch { /* แถวเสียข้ามไป ไม่ลบ */ }
  }
  return rows;
}

export function loadAgentRun(agentRunId: string): AgentRunRecord | null {
  return listAgentRuns().find((r) => r.agent_run_id === agentRunId) ?? null;
}

export function agentRunsForTask(taskId: string): readonly AgentRunRecord[] {
  return listAgentRuns().filter((r) => r.task_id === taskId);
}

export function agentRunsForRouteDecision(routeDecisionId: string): readonly AgentRunRecord[] {
  return listAgentRuns().filter((r) => r.route_decision_id === routeDecisionId);
}

export function agentRunsForPrincipal(handoffPrincipalId: string): readonly AgentRunRecord[] {
  return listAgentRuns().filter((r) => r.handoff_principal_id === handoffPrincipalId);
}
