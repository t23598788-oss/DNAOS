/**
 * หน้าที่: สะพานที่สั้นที่สุดจาก "การเขียนที่ได้รับอนุญาตแล้วล้มเหลวจริง"
 * ไปสู่งานแก้ไขที่ผ่านประตูเดียวของระบบ — โดยไม่ผ่านคน ไม่ผ่าน n8n
 *
 *   execution/file-write#onWriteAudit        (ผู้ผลิต ณ เวลาที่เกิดเหตุ)
 *     -> ./eligibility.ts#classifyWriteAudit (ฟังก์ชันบริสุทธิ์ ไม่มี AI)
 *     -> ./claim-store.ts#claimSourceEvent   (อะตอมมิก ถาวร ก่อนสร้างงานเสมอ)
 *     -> corrective WorkOrder                (จากข้อเท็จจริงของ event เท่านั้น)
 *     -> ../agent-gateway#submitTask
 *     -> ./claim-store.ts#bindCorrectiveTask
 *
 * ลำดับนี้ห้ามสลับ: อ้างสิทธิ์ต้องเกิด "ก่อน" สร้างงานเสมอ การสร้างงานแล้วค่อย
 * ทำเครื่องหมายว่าใช้แล้วคือช่องที่ทำให้สองผู้เรียกพร้อมกันสร้างงานได้ทั้งคู่
 *
 * ไม่มีการ poll ไม่มีการอ่าน write-audit-log.json ย้อนหลัง ไม่มีการ replay
 * แถวเก่า สะพานนี้เห็นเฉพาะแถวที่โปรเซสนี้เพิ่งผลิตขึ้นเท่านั้น
 *
 * ไม่มี n8n ในไฟล์นี้และห้ามมี — การซ่อมตัวเองภายในต้องทำงานได้ตอนที่บริการ
 * ภายนอกล่ม ซึ่งเป็นตอนที่ต้องการมันที่สุด
 *
 * Input: `WriteAuditEvent` ที่ถูกส่งมาจาก hook ณ เวลาผลิต
 * Output: `startWriteFailureBridge`, `handleWriteAuditEvent`,
 * `buildCorrectiveWorkOrder`, `CORRECTIVE_SOURCE_EVENT_TYPE`,
 * `AUTOMATIC_AGENT_DISPATCH_ENABLED`
 * Dependency ที่อนุญาต: ./eligibility.ts, ./claim-store.ts,
 * ../../execution/file-write/contract.ts (onWriteAudit + type เท่านั้น),
 * ../agent-gateway/contract.ts, ../agent-gateway/workspace-manager.ts,
 * ../../software/capability-registrar/contract.ts, node:fs.
 * สิ่งที่ห้ามแตะ: ห้ามเรียก executeFileWrite / evaluateWriteIntent /
 * launchAgentForWork / routeDnaOsEvent จากไฟล์นี้ และห้ามเปิด
 * AUTOMATIC_AGENT_DISPATCH_ENABLED จนกว่า Owner จะสั่ง
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { onWriteAudit } from "../../execution/file-write/contract";
import type { WriteAuditEvent } from "../../execution/file-write/contract";
import { getWriteOwnershipIndex } from "../../software/capability-registrar/contract";
import { classifyWriteAudit } from "./eligibility";
import type { EligibilityVerdict } from "./eligibility";
import { claimSourceEvent, bindCorrectiveTask, markWorkNotCreated, CLAIM_PURPOSE_CORRECTIVE_WORK } from "./claim-store";
import type { SourceEventClaim } from "./claim-store";
import type { WorkOrder } from "../agent-gateway/types";
import { snapshotRouteInputs, decideRoute, digestOf } from "./routing";
import { identifyRouteDecision } from "../scheduler/contract";
import type { RouteDecisionRecord } from "../scheduler/contract";
import { createTaskWorkspace } from "../agent-gateway/workspace-manager";
import { planAgentRun } from "../agent-gateway/agent-run-registry";
import { resolveHandoffPrincipal } from "../agent-gateway/handoff-principal";
import type { AgentRunRecord } from "../agent-gateway/agent-run-registry";
import type { RouteInputsSnapshot } from "./routing";
import type { RouteDecision } from "../scheduler/contract";

/** ชนิดของเหตุการณ์ต้นทาง ตามที่ `Task.route_context.source_event_type` รับ */
export const CORRECTIVE_SOURCE_EVENT_TYPE = "WRITE_AUDIT";

/**
 * ปิดไว้โดยเจตนา (Owner: "AUTOMATIC_AGENT_DISPATCH MUST REMAIN DISABLED").
 *
 * ตราบใดที่ยังเป็น false `buildCorrectiveWorkOrder` จะ **ไม่** สร้าง `agent_run`
 * เลย เพราะ `dispatchTask` ปล่อย Agent ทันทีที่เห็นฟิลด์นั้น พูดตรง ๆ ว่า
 * ผลที่ตามมาคือการสร้าง `agent_run` (โดยเฉพาะการเลือก `worker_kind` แบบ
 * deterministic และการจอง workspace) ยังไม่ถูกพิสูจน์ใน task นี้ และต้องพิสูจน์
 * ก่อนสวิตช์นี้จะถูกเปิด — การเปิดเป็นการตัดสินใจของ Owner ไม่ใช่ผลข้างเคียง
 */
export const AUTOMATIC_AGENT_DISPATCH_ENABLED = false;

const REPO = join(__dirname, "..", "..");
/** แบบแผนเดิมของ control/agent-host/ — พื้นที่เขียนของ Agent อยู่นอก MASTER_SOURCE เสมอ */
const AGENT_WORKSPACE_ROOT = "control/agent-host/test-workspace/allowed";

export type CorrectiveConstruction =
  | { readonly ok: true; readonly work_order: WorkOrder; readonly fields_used: readonly string[] }
  | { readonly ok: false; readonly reason: "MISSING_CONTEXT"; readonly missing_fields: readonly string[]; readonly detail: string };

/**
 * เจ้าของ path ปลายทางจากทะเบียนจริง — คืน OWNER_FOLDER ที่ยาวที่สุดที่ครอบ
 * target_path อยู่ ไม่ใช่การเดาโฟลเดอร์จากชื่อ
 */
function ownedScopeFor(targetPath: string): string | null {
  const owners = getWriteOwnershipIndex()
    .map((c) => (c as { OWNER_FOLDER?: string }).OWNER_FOLDER ?? "")
    .filter((f) => f.length > 0 && targetPath.startsWith(f))
    .sort((a, b) => b.length - a.length);
  return owners[0] ?? null;
}

/**
 * สร้าง WorkOrder แก้ไขจากข้อเท็จจริงที่อ่านได้ด้วยเครื่องเท่านั้น
 *
 * แหล่งของแต่ละฟิลด์:
 *   target_path      <- event.target_path        (ปลายทางที่ร้องขอจริง)
 *   operation        <- event.operation          (ค่าดิบจาก FileWriteRequest)
 *   workspace_scope  <- ทะเบียนความเป็นเจ้าของ path จริง
 *   content          <- ไบต์ปัจจุบันของปลายทาง (วัดจากดิสก์ ไม่ใช่จาก audit —
 *                       audit ไม่เก็บ content โดยเจตนา และห้ามเก็บ)
 *   evidence         <- write_id / intent_id / gate_decision_id ของ event
 *
 * ไม่มีการอ่าน refusal_code เพื่อเดาสาเหตุ ไม่มีการ scan repository และไม่มี
 * การตีความข้อความใด ๆ
 */
export function buildCorrectiveWorkOrder(event: WriteAuditEvent): CorrectiveConstruction {
  const missing: string[] = [];
  const targetPath = event.target_path;
  if (!targetPath) missing.push("target_path");
  // WorkOrder รองรับเฉพาะสองค่านี้ — ค่าอื่นไม่แปลงให้ แต่รายงานว่าสร้างไม่ได้
  const operation = event.operation === "CREATE" || event.operation === "MODIFY" ? event.operation : null;
  if (!operation) missing.push(`operation (WorkOrder รองรับเฉพาะ CREATE/MODIFY ได้ "${String(event.operation)}")`);
  if (event.target_type !== "FILE") missing.push(`target_type (รองรับเฉพาะ FILE, ได้ "${event.target_type}")`);

  const scope = targetPath ? ownedScopeFor(targetPath) : null;
  if (targetPath && !scope) missing.push(`workspace_scope (ไม่มี capability ใดในทะเบียนเป็นเจ้าของ "${targetPath}")`);

  // content ต้องวัดจากปลายทางจริง ไม่ใช่จาก audit — และปลายทางที่อ่านไม่ได้
  // แปลว่าเราไม่รู้สถานะเริ่มต้น จึงสร้างงานไม่ได้ แทนที่จะเดาว่าเป็นค่าว่าง
  const absolute = targetPath ? join(REPO, targetPath) : null;
  let content: string | null = null;
  if (absolute) {
    try {
      if (existsSync(absolute) && statSync(absolute).isFile()) content = readFileSync(absolute, "utf-8");
    } catch { content = null; }
  }
  if (content === null || content.length === 0) {
    missing.push(`content (ปลายทาง "${targetPath}" อ่านเป็นไฟล์ไม่ได้หรือว่างเปล่า — WriteAuditEvent ไม่เก็บ content ตามข้อห้าม จึงวัดจากดิสก์เท่านั้น)`);
  }

  if (missing.length > 0 || !targetPath || !scope || content === null || !operation) {
    return {
      ok: false, reason: "MISSING_CONTEXT", missing_fields: missing,
      detail: `write_id=${event.write_id} target_path=${targetPath ?? "(absent)"} — สร้างงานแก้ไขไม่ได้โดยไม่เดา`,
    };
  }

  const evidence = [
    { source: "execution/file-write/audit.ts#recordWriteAudit", note: `write_id=${event.write_id} gate_decision_value=${event.gate_decision_value} status=${event.status} refusal_code=${event.refusal_code ?? "null"}` },
    { source: "execution/file-write/audit.ts#WriteAuditEvent", note: `intent_id=${event.intent_id} gate_decision_id=${event.gate_decision_id} correlation_id=${event.correlation_id}` },
  ];

  const workOrder: WorkOrder = {
    operation,
    target_type: "FILE",
    target_path: targetPath,
    requested_change: `repair authorized write failure write_id=${event.write_id} refusal_code=${event.refusal_code ?? "null"} operation=${operation} target_path=${targetPath}`,
    content,
    workspace_scope: scope,
    mode: "sandbox",
    required_tests: ["sandbox.readback"],
    forbidden_files: [],
    evidence,
    // ไม่มี agent_run โดยเจตนา — ดู AUTOMATIC_AGENT_DISPATCH_ENABLED ด้านบน
  };

  return {
    ok: true,
    work_order: workOrder,
    fields_used: [
      "WriteAuditEvent.write_id", "WriteAuditEvent.operation", "WriteAuditEvent.target_path",
      "WriteAuditEvent.target_type", "WriteAuditEvent.gate_decision_value", "WriteAuditEvent.status",
      "WriteAuditEvent.refusal_code", "WriteAuditEvent.intent_id", "WriteAuditEvent.gate_decision_id",
      "WriteAuditEvent.correlation_id",
      "write-ownership registry OWNER_FOLDER (workspace_scope)",
      "measured bytes at target_path (content)",
    ],
  };
}

export type CorrectiveOutcome =
  | { readonly status: "NOT_ELIGIBLE" }
  | { readonly status: "CLAIM_DENIED"; readonly reason_code: string; readonly existing_task_id: string | null }
  | { readonly status: "CLAIM_HELD_WORK_NOT_CREATED"; readonly claim: SourceEventClaim; readonly construction: CorrectiveConstruction }
  /** อ้างสิทธิ์และสร้างงานได้ แต่ scheduler บอกว่าไม่มีผู้ทำงานที่ใช้ได้ */
  | { readonly status: "NO_WORKER_AVAILABLE"; readonly claim: SourceEventClaim; readonly route: RouteDecision; readonly corrective_task_id: string }
  /** แผนครบทุกตัวตนแล้ว แต่ยังไม่ปล่อย Agent — สถานะสูงสุดที่ task นี้ไปถึงได้ */
  | { readonly status: "EXECUTION_PLANNED" | "PLAN_NOT_DISPATCHABLE"; readonly claim: SourceEventClaim; readonly corrective_task_id: string;
      readonly route: RouteDecision; readonly route_inputs: RouteInputsSnapshot;
      readonly route_decision: RouteDecisionRecord; readonly agent_run: AgentRunRecord; readonly workspace_id: string;
      /** null เมื่อพร้อมปล่อย มิฉะนั้นบอกตรง ๆ ว่าติดอะไร */
      readonly blocker: string | null }
  /** สร้างงานได้แต่ประกอบตัวตนต่อไม่ครบ — บอกตรง ๆ ว่าค้างตรงไหน */
  | { readonly status: "PLAN_INCOMPLETE"; readonly claim: SourceEventClaim; readonly corrective_task_id: string; readonly stage: string; readonly detail: string };

export interface BridgeObservation {
  readonly source_event_id: string;
  readonly verdict: EligibilityVerdict;
  readonly outcome: CorrectiveOutcome;
  /** นับจำนวนครั้งที่สะพานเรียก scheduler จริงสำหรับ event นี้ — 0 เมื่อถูกกันก่อนถึง routing */
  readonly route_call_count: number;
  readonly agent_dispatched: false;
  readonly observed_at: string;
}

export interface HandleOptions {
  readonly holder_id?: string;
  /**
   * ผู้สร้างงานจริง แยกออกมาเพื่อให้ทดสอบลำดับ claim ได้โดยไม่ต้องแตะ gateway
   * ค่าปริยายคือการเรียก `submitTask` จริง
   */
  readonly createTask?: (workOrder: WorkOrder, event: WriteAuditEvent) => Promise<{ task_id: string }>;
  /** แทนที่ได้เพื่อทดสอบ (เช่น แช่ snapshot หรือจำลอง pool ว่าง) — ค่าปริยายคือของจริง */
  readonly snapshotInputs?: (workOrder: WorkOrder, sourceEventId: string) => RouteInputsSnapshot;
  readonly decide?: (snapshot: RouteInputsSnapshot) => RouteDecision;
}

async function defaultCreateTask(workOrder: WorkOrder, event: WriteAuditEvent): Promise<{ task_id: string }> {
  const { submitTask } = await import("../agent-gateway/contract");
  /**
   * adapters = [] โดยเจตนา — รูปแบบเดียวกับที่
   * `control/external-system-lifecycle/pipeline.ts` ใช้และอธิบายไว้: ต้องการ
   * ตัวตนของงานกับ Policy/Admission จริง ไม่ใช่การรันงาน ตราบใดที่
   * AUTOMATIC_AGENT_DISPATCH_ENABLED ยังเป็น false งานแก้ไขต้องไม่ถูกลงมือทำ
   */
  const task = await submitTask(
    `corrective write repair for ${workOrder.target_path}`,
    { user_id: "system", workspace_id: "write-failure-bridge", conversation_id: event.correlation_id, parent_task_id: null },
    "control/write-failure-bridge",
    [],
    workOrder,
    { source_event_type: CORRECTIVE_SOURCE_EVENT_TYPE, source_event_id: event.write_id,
      target_capability_id: "real_file_write_after_authorization" } as never,
  );
  return { task_id: task.task_id };
}

/**
 * ประมวลผลหนึ่งเหตุการณ์
 *
 * FAIL-CLOSED: ไม่ eligible = ไม่อ้างสิทธิ์ ไม่สร้างงาน ไม่ส่ง Agent
 * SECURITY_ENFORCEMENT_SUCCESS และ SECURITY_INCIDENT ไม่มีวันกลายเป็นงานซ่อม
 */
export async function handleWriteAuditEvent(event: WriteAuditEvent, options: HandleOptions = {}): Promise<BridgeObservation> {
  const verdict = classifyWriteAudit(event);
  const observedAt = new Date().toISOString();
  let routeCallCount = 0;
  const base = { source_event_id: verdict.source_event_id, verdict, agent_dispatched: false as const, observed_at: observedAt };

  if (!verdict.eligible_for_corrective_work) {
    return { ...base, outcome: { status: "NOT_ELIGIBLE" }, route_call_count: routeCallCount };
  }

  // [1] อ้างสิทธิ์ก่อนเสมอ — ก่อนสร้าง WorkOrder และก่อน submitTask
  const claim = claimSourceEvent({
    source_event_type: CORRECTIVE_SOURCE_EVENT_TYPE,
    source_event_id: event.write_id,
    purpose: CLAIM_PURPOSE_CORRECTIVE_WORK,
    holder_id: options.holder_id ?? `bridge-${process.pid}`,
  });
  if (claim.status === "DENIED") {
    return { ...base, outcome: { status: "CLAIM_DENIED", reason_code: claim.reason_code, existing_task_id: claim.existing?.corrective_task_id ?? null }, route_call_count: routeCallCount };
  }

  // [2] สร้างงานจากข้อเท็จจริง
  const construction = buildCorrectiveWorkOrder(event);
  if (!construction.ok) {
    markWorkNotCreated(claim.claim, `CONSTRUCTION_${construction.reason}`);
    return { ...base, route_call_count: routeCallCount, outcome: { status: "CLAIM_HELD_WORK_NOT_CREATED", claim: claim.claim, construction } };
  }

  // [3] ผู้ตัดสินผู้ทำงานคือ scheduler — สะพานไม่เลือกเอง
  const routeInputs = (options.snapshotInputs ?? snapshotRouteInputs)(construction.work_order, event.write_id);
  routeCallCount += 1;
  const route = (options.decide ?? decideRoute)(routeInputs);

  // [4] ส่งเข้าประตูเดียว
  try {
    const created = await (options.createTask ?? defaultCreateTask)(construction.work_order, event);
    const bound = bindCorrectiveTask(claim.claim, created.task_id);
    if (!route.ok) {
      // งานถูกสร้างและอ้างสิทธิ์แล้ว แต่ไม่มีผู้ทำงาน — ไม่สร้าง agent_run และไม่ปล่อย Agent
      return { ...base, route_call_count: routeCallCount, outcome: { status: "NO_WORKER_AVAILABLE", claim: bound, route, corrective_task_id: created.task_id } };
    }
    // [5] ตัวตนของการตัดสิน — scheduler เป็นผู้ออก id สะพานรับมาเท่านั้น
    const identified = identifyRouteDecision({ task_id: created.task_id, decision: route, routing_input_digest: digestOf(routeInputs) });
    if (!identified.ok) {
      return { ...base, route_call_count: routeCallCount, outcome: { status: "PLAN_INCOMPLETE", claim: bound, corrective_task_id: created.task_id, stage: "IDENTIFY_ROUTE_DECISION", detail: identified.reason } };
    }

    // [6] พื้นที่ทำงาน — workspace-manager เป็นเจ้าของ workspace_id
    const workspace = createTaskWorkspace({
      work_order_id: `wo-${created.task_id}`, command_id: created.task_id.replace(/^task-/, ""),
      assigned_source: [join(REPO, construction.work_order.workspace_scope)],
      workspace_root: join(REPO, AGENT_WORKSPACE_ROOT),
    });

    // [7] principal ที่เชื่อถือได้ — agent-registry เป็นผู้ให้ความเชื่อถือ
    //     สะพานไม่ตั้ง principal เอง และไม่แปลง worker_kind เป็น principal
    /**
     * `required_role` เป็น null โดยเจตนา: ยังไม่มีสัญญาใดใน repo ที่แปลง
     * `WorkKind`/`worker_class` ของงานซ่อมเป็น `AgentRole` การเดาบทบาทที่นี่
     * จะเป็นการตั้งเงื่อนไขความเชื่อถือขึ้นเอง ซึ่งไม่ใช่หน้าที่ของสะพาน
     * ขอบเขตที่บังคับคือขอบเขตจริงของงาน ไม่ใช่ค่าที่คิดขึ้น
     */
    const principal = resolveHandoffPrincipal({
      worker_kind: identified.record.worker_kind,
      required_role: null,
      required_scope: REPO,
    });

    // [8] ตัวตนของความพยายามรัน — agent execution boundary เป็นผู้ออก id
    const planned = planAgentRun({
      task_id: created.task_id,
      route_decision_id: identified.record.route_decision_id,
      worker_kind: identified.record.worker_kind,
      workspace_id: workspace.workspace_id,
      source_event_type: CORRECTIVE_SOURCE_EVENT_TYPE,
      source_event_id: event.write_id,
      // null เมื่อ resolve ไม่ได้ — แถวยังถูกบันทึกเพื่อให้ lineage อ่านครบ
      // แต่ dispatch_ready จะเป็น false และไม่มีทางถูกปล่อย
      handoff_principal_id: principal.ok ? principal.handoff_principal_id : null,
    });
    if (!planned.ok) {
      return { ...base, route_call_count: routeCallCount, outcome: { status: "PLAN_INCOMPLETE", claim: bound, corrective_task_id: created.task_id, stage: "PLAN_AGENT_RUN", detail: `${planned.reason}: ${planned.missing_fields.join(", ")}` } };
    }

    // หยุดตรงนี้โดยเจตนา — ไม่มีการปล่อยโปรเซสใด ๆ ต่อจากบรรทัดนี้
    // และเมื่อ dispatch_ready = false ก็ไม่มีทางปล่อยได้แม้ Owner จะเปิดสวิตช์
    return { ...base, route_call_count: routeCallCount, outcome: {
      status: planned.record.dispatch_ready ? "EXECUTION_PLANNED" : "PLAN_NOT_DISPATCHABLE",
      claim: bound, corrective_task_id: created.task_id,
      route, route_inputs: routeInputs, route_decision: identified.record,
      agent_run: planned.record, workspace_id: workspace.workspace_id,
      blocker: planned.record.dispatch_ready || principal.ok ? null : `${principal.reason_code}: ${principal.detail}` } };
  } catch (error) {
    // อ้างสิทธิ์แล้วแต่สร้างงานไม่สำเร็จ — บันทึกไว้ ไม่ปล่อยกลับให้ลองใหม่เอง
    markWorkNotCreated(claim.claim, `SUBMIT_TASK_FAILED:${error instanceof Error ? error.message.slice(0, 120) : String(error)}`);
    return { ...base, route_call_count: routeCallCount, outcome: { status: "CLAIM_HELD_WORK_NOT_CREATED", claim: claim.claim, construction } };
  }
}

export interface BridgeHandle {
  stop(): void;
  observations(): readonly BridgeObservation[];
  /** งานที่ยังค้างอยู่ — ให้ผู้ทดสอบรอได้โดยไม่ต้องเดาเวลา */
  settled(): Promise<readonly BridgeObservation[]>;
}

/** เปิดการรับฟัง ณ เวลาผลิต subscription มีอายุเท่าโปรเซส */
export function startWriteFailureBridge(options: HandleOptions = {}): BridgeHandle {
  const observed: BridgeObservation[] = [];
  const pending: Promise<void>[] = [];
  const unsubscribe = onWriteAudit((event) => {
    pending.push(handleWriteAuditEvent(event, options).then((o) => { observed.push(o); }));
  });
  return {
    stop: unsubscribe,
    observations: () => observed,
    settled: async () => { await Promise.all(pending); return observed; },
  };
}
