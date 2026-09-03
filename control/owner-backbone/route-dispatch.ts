/**
 * หน้าที่: แปลง `RouteResult` ที่ routing owner ตัดสินแล้ว ให้ไปถึง executor ที่
 * ลงทะเบียนไว้จริง — โดยไม่ตัดสินใจอะไรใหม่เลย
 *
 * นี่ไม่ใช่ router ตัวที่สอง: ไฟล์นี้ไม่จำแนกเหตุการณ์ ไม่ให้คะแนน ไม่เลือกเส้นทาง
 * และไม่มีสิทธิ์เปลี่ยน action ที่ `decideAction` ตัดสินมา หน้าที่เดียวคือ
 * "action ที่ประกาศไว้ -> เจ้าของที่ลงทะเบียนไว้ -> ส่งคำสั่งที่มีชนิด"
 *
 * ── ไม่มีการรันสตริง ──
 * `RouteResult.target_owner` เป็น "ข้อมูล" ไม่ใช่ "อำนาจสั่งงาน" มันถูกใช้เป็นคีย์
 * ค้นในตารางประกาศด้านล่างเท่านั้น ไม่มีจุดใดที่สตริงจากผู้ผลิตกลายเป็นชื่อ
 * ฟังก์ชันที่ถูกเรียก — การเพิ่ม action ใหม่โดยไม่เพิ่มแถวที่นี่จะได้
 * TARGET_EXECUTOR_NOT_REGISTERED ไม่ใช่การเรียกอะไรก็ได้
 *
 * ── กฎการ resolve ──
 * 0 ราย  -> BLOCK  TARGET_EXECUTOR_NOT_REGISTERED
 * >1 ราย -> BLOCK  TARGET_EXECUTOR_AMBIGUOUS   (ไม่ตัดสินผู้ชนะให้)
 * 1 ราย  -> ส่งต่อ
 *
 * ── Agent ──
 * เส้นทางที่ปลายทางเป็น Agent ถูกประกาศไว้ได้ แต่ต้องหยุดที่
 * EXECUTION_DISABLED เสมอ ตราบใดที่ยังไม่มีการอนุญาตอย่างชัดแจ้ง
 *
 * Input: `RouteResult`
 * Output: `dispatchRoute`, `EXECUTOR_BINDINGS`, `resolveExecutorBinding`
 * Dependency ที่อนุญาต: ./event-intake.ts (type), ../agent-gateway/contract.ts,
 * ../../software/registry-database/contract.ts (ยืนยันว่าเจ้าของมีจริงในทะเบียน)
 * สิ่งที่ห้ามแตะ: ห้ามเรียก executor ที่ไม่อยู่ในตารางนี้ ห้ามเปิด Agent อัตโนมัติ
 * และห้ามเดาเจ้าของจากชื่อไฟล์
 */

import type { RouteResult } from "./event-intake";

export type DispatchStatus =
  | "DISPATCHED"
  | "EXECUTION_DISABLED"
  | "NO_ACTION"
  | "TARGET_EXECUTOR_NOT_REGISTERED"
  | "TARGET_EXECUTOR_AMBIGUOUS"
  | "EXECUTOR_REFUSED";

/**
 * ตารางประกาศ: action -> เจ้าของจริง
 *
 * `capability_canonical_name` ต้องมีอยู่ในทะเบียน persistent จริง — ตรวจตอน
 * resolve ไม่ใช่เชื่อตามที่เขียนไว้
 *
 * `execution_enabled=false` แปลว่าเส้นทางถูกประกาศแล้วแต่ยังไม่อนุญาตให้ลงมือ
 * ซึ่งเป็นสถานะที่ต่างจาก "ไม่มีเจ้าของ" อย่างสิ้นเชิง
 */
export interface ExecutorBinding {
  readonly route_action: string;
  readonly target_owner: string;
  readonly capability_canonical_name: string;
  readonly target_symbol: string;
  readonly input_contract: string;
  readonly output_contract: string;
  readonly authorization_boundary: string;
  readonly result_return_boundary: string;
  readonly execution_enabled: boolean;
  readonly execution_disabled_reason: string | null;
}

export const EXECUTOR_BINDINGS: readonly ExecutorBinding[] = [
  {
    route_action: "RESTART_EXISTING_SERVICE",
    target_owner: "control/owner-backbone",
    capability_canonical_name: "owner-backbone",
    target_symbol: "autonomous-recovery.ts#runRecoveryCycle",
    input_contract: "service_id: string (ต้องประกาศอยู่ใน control/runtime-control#SERVICES)",
    output_contract: "RecoveryCycle",
    authorization_boundary: "control/runtime-control#SERVICES (launchd authority lookup) — ไม่ใช่การตัดสินของผู้เรียก",
    result_return_boundary: "RecoveryCycle.events -> control/owner-backbone/events.ts#emitSystemEvent -> re-probe เงื่อนไขเดิม",
    execution_enabled: true,
    execution_disabled_reason: null,
  },
  {
    route_action: "REPAIR_THROUGH_RESOLVED_WORK_PACKET",
    target_owner: "control/agent-gateway",
    capability_canonical_name: "dna-os-live-agent-execution-path",
    target_symbol: "gateway.ts#submitTask",
    input_contract: "intent_text + MemoryReference + adapters + WorkOrder? + route_context",
    output_contract: "Task",
    authorization_boundary: "gateway.ts#validateWorkOrder (admission) + permissions/write-gate + execution/file-write",
    result_return_boundary: "control/work-result-ingress#ingestWorkResult -> control/agent-gateway/handoff.ts#validateHandoff",
    // เส้นทางนี้จบที่การปล่อย Agent จึงถูกประกาศไว้แต่ยังไม่อนุญาต
    execution_enabled: false,
    execution_disabled_reason: "AUTOMATIC_AGENT_DISPATCH_DISABLED — งานที่สร้างจากเส้นทางนี้จะไปถึงการปล่อย Agent ซึ่งยังไม่ได้รับอนุญาตจาก Owner",
  },
  {
    route_action: "FAILOVER_TO_AUTHORIZED_RESOURCE",
    target_owner: "control/owner-backbone",
    capability_canonical_name: "owner-backbone",
    target_symbol: "resource-availability.ts#allResourceAvailability",
    input_contract: "(none) — อ่านสถานะทรัพยากรที่ประกาศไว้",
    output_contract: "ResourceAvailability[]",
    authorization_boundary: "credentials/registry (credential reference journal) — ไม่มีการซื้อและไม่มีการสร้างสิทธิ์ใหม่",
    result_return_boundary: "control/owner-backbone/events.ts#emitSystemEvent (RESOURCE_AVAILABLE / RESOURCE_UNAVAILABLE)",
    execution_enabled: true,
    execution_disabled_reason: null,
  },
  {
    route_action: "WORKSPACE_REMOVE",
    target_owner: "control/agent-gateway",
    capability_canonical_name: "workspace-cleanup-gate",
    target_symbol: "workspace-cleanup.ts#cleanupWorkspace",
    input_contract: "workspace_id + CleanupAuthorization + repositoryRoot",
    output_contract: "CleanupOutcome",
    authorization_boundary: "workspace-cleanup.ts#evaluateCleanupEligibility (9 ขั้น) แล้วจึง control/source-workspace#removeWorkspace",
    result_return_boundary: "workspace_lifecycle evidence (deletion_evidence_id) ใน agent-gateway memory-store",
    execution_enabled: true,
    execution_disabled_reason: null,
  },
];

export type BindingResolution =
  | { readonly ok: true; readonly binding: ExecutorBinding }
  | { readonly ok: false; readonly status: "TARGET_EXECUTOR_NOT_REGISTERED" | "TARGET_EXECUTOR_AMBIGUOUS"; readonly detail: string; readonly candidates: readonly ExecutorBinding[] };

/**
 * หาเจ้าของที่ผูกไว้ แล้ว **ยืนยันกับทะเบียนจริง** ว่ามันมีอยู่
 *
 * ตารางด้านบนเป็นการประกาศ ทะเบียนเป็นความจริง — แถวที่ชี้ไป capability ที่ไม่มี
 * ในทะเบียนจะถูกปฏิเสธเหมือนไม่มีเจ้าของ ไม่ใช่ถูกใช้เพราะเขียนไว้
 */
export function resolveExecutorBinding(route: RouteResult, registeredCapabilityNames: ReadonlySet<string>): BindingResolution {
  const byAction = EXECUTOR_BINDINGS.filter((b) => b.route_action === route.action && b.target_owner === route.target_owner);
  const registered = byAction.filter((b) => registeredCapabilityNames.has(b.capability_canonical_name));

  if (registered.length === 0) {
    return {
      ok: false, status: "TARGET_EXECUTOR_NOT_REGISTERED",
      detail: byAction.length === 0
        ? `ไม่มีแถวผูกสำหรับ action="${route.action}" owner="${route.target_owner}"`
        : `ผูกไว้ ${byAction.length} แถว แต่ไม่มี capability ใดในทะเบียน persistent: ${byAction.map((b) => b.capability_canonical_name).join(", ")}`,
      candidates: byAction,
    };
  }
  if (registered.length > 1) {
    return {
      ok: false, status: "TARGET_EXECUTOR_AMBIGUOUS",
      detail: `พบ ${registered.length} เจ้าของที่ลงทะเบียนแล้วสำหรับ action เดียวกัน — ไม่ตัดสินให้`,
      candidates: registered,
    };
  }
  return { ok: true, binding: registered[0] };
}

export interface DispatchRecord {
  readonly route_id: string;
  readonly input_event_id: string;
  readonly action: string | null;
  readonly status: DispatchStatus;
  readonly binding: ExecutorBinding | null;
  readonly detail: string;
  /** ตัวตนที่ต้องเดินกลับมาเมื่อ executor ตอบ — ประกาศไว้ก่อนลงมือ */
  readonly result_return: string | null;
  readonly dispatched_at: string;
}

export interface DispatchOptions {
  /** ผู้เรียกจริงของ executor — แยกออกมาเพื่อให้พิสูจน์ลำดับได้โดยไม่ต้องลงมือจริง */
  readonly invoke?: (binding: ExecutorBinding, route: RouteResult) => Promise<{ ok: boolean; detail: string }>;
  readonly registeredCapabilityNames?: ReadonlySet<string>;
}

async function loadRegisteredNames(): Promise<ReadonlySet<string>> {
  const { createPersistentFileStore } = await import("../../software/registry-database/adapters/persistent-file-store");
  const store = createPersistentFileStore() as unknown as { listCapabilities?: () => readonly { canonical_name: string; status?: string }[] };
  if (typeof store.listCapabilities === "function") {
    return new Set(store.listCapabilities().map((c) => c.canonical_name));
  }
  // อ่านตรงจากไฟล์ทะเบียนเมื่อ adapter ไม่มีตัวแจกแจง — ยังเป็นทะเบียนเดิม ไม่ใช่สโตร์ใหม่
  const { readFileSync, existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const p = join(__dirname, "..", "..", "software/registry-database/data/canonical/capabilities.jsonl");
  if (!existsSync(p)) return new Set();
  const names = new Set<string>();
  for (const line of readFileSync(p, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try { names.add((JSON.parse(line) as { canonical_name: string }).canonical_name); } catch { /* แถวเสียข้ามไป */ }
  }
  return names;
}

/**
 * ส่ง RouteResult หนึ่งใบไปยังเจ้าของที่ผูกไว้
 *
 * ไม่มี fallback เงียบ ๆ ไปที่ Agent: เส้นทางที่ปลายทางยังไม่อนุญาตจะจบที่
 * EXECUTION_DISABLED พร้อมเหตุผล ไม่ใช่ถูกเปลี่ยนไปทำอย่างอื่นแทน
 */
export async function dispatchRoute(route: RouteResult, options: DispatchOptions = {}): Promise<DispatchRecord> {
  const at = new Date().toISOString();
  const base = { route_id: route.route_id, input_event_id: route.input_event_id, action: route.action, dispatched_at: at };

  if (!route.action || !route.target_owner) {
    return { ...base, status: "NO_ACTION", binding: null, result_return: null,
      detail: `routing owner ไม่ได้สั่งการลงมือ (policy_result=${route.policy_result}, reason_code=${route.reason_code})` };
  }

  const names = options.registeredCapabilityNames ?? await loadRegisteredNames();
  const resolution = resolveExecutorBinding(route, names);
  if (!resolution.ok) {
    return { ...base, status: resolution.status, binding: null, result_return: null, detail: resolution.detail };
  }
  const binding = resolution.binding;

  if (!binding.execution_enabled) {
    return { ...base, status: "EXECUTION_DISABLED", binding, result_return: binding.result_return_boundary,
      detail: binding.execution_disabled_reason ?? "execution disabled" };
  }

  if (!options.invoke) {
    return { ...base, status: "EXECUTION_DISABLED", binding, result_return: binding.result_return_boundary,
      detail: "ไม่มีผู้เรียก executor ถูกส่งเข้ามา — เส้นทาง resolve ได้แต่ยังไม่ลงมือ" };
  }

  const outcome = await options.invoke(binding, route);
  return {
    ...base,
    status: outcome.ok ? "DISPATCHED" : "EXECUTOR_REFUSED",
    binding,
    result_return: binding.result_return_boundary,
    detail: outcome.detail,
  };
}
