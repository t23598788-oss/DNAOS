/**
 * หน้าที่: §4 BROWSER/UI REHYDRATION + §7 SERVICE/PROCESS RECOVERY.
 *
 * เบราว์เซอร์ไม่ใช่ source of truth และ process ก็ไม่ใช่ ไฟล์นี้คือฝั่ง durable
 * ที่ **บอก** เบราว์เซอร์ว่ามันควรอยู่ route ไหน ดูงานไหน และต่อ stream ไหนจาก
 * event ไหน — ไม่ใช่ถามเบราว์เซอร์ว่าจำอะไรได้บ้าง
 *
 *   durable workspace state → resolve current work → route/view → state ปัจจุบัน
 *   → ต่อ event stream จาก last_event_id → render → verify
 *
 * และถ้า runtime ที่ต้องใช้ตายไป มันไม่ปลุกเอง: มันเรียก
 * `control/runtime-control/` ซึ่งเป็นเจ้าของอำนาจ start/restart อยู่แล้ว
 * และเป็นตัวเดียวที่พิสูจน์ readiness ด้วย PID จริง + health จริง
 *
 * Input: `work_id` (หรือไม่ใส่ = ทุกงานที่ยัง active).
 * Output: `buildRehydrationPlan`, `recoverRuntime`, `renderRehydrationBriefing`.
 * Dependency ที่อนุญาต: ./store.ts, ./resume.ts, ./journal.ts,
 * ./connection.ts, ./types.ts, และ `../runtime-control/contract.ts`
 * (REUSED — ห้ามสั่ง launchctl เองที่นี่).
 * สิ่งที่ห้ามแตะ:
 * - ห้ามให้ไฟล์นี้เรียก launchctl/kill/spawn เอง — อำนาจนั้นอยู่ที่ runtime-control
 * - ห้ามให้ AI รอเบราว์เซอร์ — แผนถูกสร้างจากดิสก์ ไม่ต้องมีเบราว์เซอร์เปิดอยู่
 * - ห้าม fabricate route — ถ้า checkpoint ไม่มี ui_context ต้องรายงาน NO_UI_CONTEXT
 */
import type { UiContext } from "./types";
import { allCurrentCheckpoints, currentCheckpoint } from "./store";
import { buildResumeContext } from "./resume";
import { recoverableEntries, type RecoverableEntry } from "./journal";
import { readConnectionState, readQueue, type ConnectionState, type QueuedOperation } from "./connection";
import { SERVICES, runOperation } from "../runtime-control/contract";
import type { RuntimeOperationRequest } from "../runtime-control/contract";

export interface RehydrationPlan {
  work_id: string;
  resume_status: string;
  next_action: string;
  /** Where the UI should go, or why there is nowhere to go. */
  ui: { status: "RESTORE"; context: UiContext } | { status: "NO_UI_CONTEXT"; detail: string };
  /** Which runtime must be alive for that UI, and whether it is. */
  required_service: { service_id: string; declared: boolean } | null;
  /** Unsaved work found on disk that a crash left behind. */
  unsaved: readonly RecoverableEntry[];
  /** Streams to reconnect, and the event to resume each one from. */
  reconnect: readonly ConnectionState[];
  /** Operations parked because the network was not there. */
  queued: readonly QueuedOperation[];
  /** What the browser must fetch after it lands, so it renders durable state and not its own memory. */
  fetch_after_load: readonly string[];
}

/**
 * Builds the plan entirely from disk. No browser is contacted, no runtime is
 * required to be up, and nothing here waits: a plan is produced for a machine
 * that just booted with every process dead.
 */
export function buildRehydrationPlan(workId: string, options: { path?: string; repoRoot?: string } = {}): RehydrationPlan | null {
  const checkpoint = currentCheckpoint(workId, options.path);
  if (checkpoint === null) return null;
  const resume = buildResumeContext(workId, options);

  const ui: RehydrationPlan["ui"] = checkpoint.ui_context
    ? { status: "RESTORE", context: checkpoint.ui_context }
    : { status: "NO_UI_CONTEXT", detail: "this checkpoint records no ui_context — the work was not being driven through a UI, and a route is not invented for it" };

  const serviceId = checkpoint.ui_context?.service_id ?? null;
  const required = serviceId === null ? null : { service_id: serviceId, declared: Object.prototype.hasOwnProperty.call(SERVICES, serviceId) };

  return {
    work_id: workId,
    resume_status: resume.resume_status,
    next_action: resume.next_action,
    ui,
    required_service: required,
    unsaved: recoverableEntries({ path: options.path ? options.path.replace(/checkpoints\.jsonl$/, "work-journal.jsonl") : undefined, repoRoot: options.repoRoot, work_id: workId }),
    reconnect: readConnectionState(),
    queued: readQueue().filter((q) => q.work_id === workId && q.status !== "DONE"),
    fetch_after_load: checkpoint.ui_context ? [checkpoint.ui_context.route] : [],
  };
}

export function allRehydrationPlans(options: { path?: string; repoRoot?: string } = {}): RehydrationPlan[] {
  return allCurrentCheckpoints(options.path)
    .filter((c) => c.status === "ACTIVE" || c.status === "BLOCKED")
    .map((c) => buildRehydrationPlan(c.work_id, options))
    .filter((p): p is RehydrationPlan => p !== null);
}

export interface RuntimeRecovery {
  service_id: string;
  attempted: boolean;
  outcome: "ALREADY_HEALTHY" | "RECOVERED" | "FAILED" | "NOT_DECLARED" | "REFUSED";
  detail: string;
  evidence_ref: string | null;
}

/**
 * Brings a required runtime back through the ONE authority that may do it.
 *
 * `runOperation` is not asked to "check then start": it already refuses to
 * report SUCCESS without a real post-action PID from launchd AND a real
 * healthy HTTP response, so calling it is both the recovery and the readiness
 * verification. Duplicating either here would be a second opinion about
 * whether a service is up, which is exactly what that capability's header
 * forbids.
 */
/** How many restart attempts a recovery makes before it stops and reports FAILED. Declared, not implicit. */
export const RECOVERY_MAX_ATTEMPTS = 2;

/**
 * `request` ถูกส่งผ่านลงไปตรง ๆ ไม่ถูกแก้ ไม่ถูกเติม และไม่ถูกแต่งขึ้นที่นี่
 *
 * ก่อนหน้านี้ฟังก์ชันนี้รับแค่ `serviceId` ตัวตนของผู้กู้คืนจึงตกหล่นที่ขอบเขตนี้
 * ก่อนถึง runtime-control ด้วยซ้ำ ไฟล์นี้ไม่ประกาศตัวตนของตัวเองเป็นผู้ขอ เพราะ
 * มันไม่ใช่ผู้ตัดสินใจกู้คืน — มันเป็นทางผ่าน ผู้ตัดสินใจคือผู้เรียกที่ส่งบริบทมา
 */
export async function recoverRuntime(serviceId: string, request?: RuntimeOperationRequest): Promise<RuntimeRecovery> {
  if (!Object.prototype.hasOwnProperty.call(SERVICES, serviceId)) {
    return { service_id: serviceId, attempted: false, outcome: "NOT_DECLARED", detail: `${serviceId} is not in control/runtime-control#SERVICES — an undeclared process is not restarted from here`, evidence_ref: null };
  }
  const attempts: string[] = [];
  let lastEvidence: string | null = null;
  for (let attempt = 0; attempt < RECOVERY_MAX_ATTEMPTS; attempt += 1) {
    try {
      const evidence = await runOperation(serviceId as never, "restart" as never, request);
      const record = evidence as { result?: string; status?: string; operation_id?: string; failure_reason?: string | null };
      lastEvidence = record.operation_id ?? lastEvidence;
      // `runOperation` is the ONLY judge of whether the service came up: it
      // already refuses SUCCESS without a real post-action PID and a real
      // healthy HTTP response. This never re-probes health itself — a second
      // opinion about whether a service is up is exactly what that
      // capability's header forbids.
      if ((record.result ?? record.status) === "SUCCESS") {
        return {
          service_id: serviceId, attempted: true, outcome: "RECOVERED",
          detail: `restarted on attempt ${attempt + 1}/${RECOVERY_MAX_ATTEMPTS}${attempts.length > 0 ? ` after: ${attempts.join(" | ")}` : ""}`,
          evidence_ref: record.operation_id ?? null,
        };
      }
      // A restart issued while a previous one is still settling comes back
      // not-yet-healthy. That is a real FAILED result, not a reason to lower the
      // bar — it is a reason to try once more, within a declared limit.
      attempts.push(`attempt ${attempt + 1}: ${record.failure_reason ?? "not healthy after restart"}`);
    } catch (error) {
      attempts.push(`attempt ${attempt + 1} threw: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    service_id: serviceId, attempted: true, outcome: "FAILED",
    detail: `${RECOVERY_MAX_ATTEMPTS} attempt(s), none reported SUCCESS — ${attempts.join(" | ")}`,
    evidence_ref: lastEvidence,
  };
}

export function renderRehydrationBriefing(plan: RehydrationPlan): string {
  const lines: string[] = [];
  lines.push(`WORK_ID           ${plan.work_id}`);
  lines.push(`RESUME_STATUS     ${plan.resume_status}`);
  lines.push(`UI                ${plan.ui.status === "RESTORE" ? `${plan.ui.context.url}  (route ${plan.ui.context.route}, scope ${plan.ui.context.scope ?? "none"})` : plan.ui.detail}`);
  lines.push(`REQUIRED_SERVICE  ${plan.required_service ? `${plan.required_service.service_id}${plan.required_service.declared ? "" : " (NOT DECLARED in runtime-control)"}` : "(none)"}`);
  lines.push(`UNSAVED_WORK      ${plan.unsaved.length === 0 ? "(none)" : plan.unsaved.map((u) => `${u.entry.entry_id.slice(-8)}:${u.recovery}`).join(", ")}`);
  lines.push(`RECONNECT         ${plan.reconnect.length === 0 ? "(none)" : plan.reconnect.map((c) => `${c.stream_id}@${c.last_event_id ?? "start"}`).join(", ")}`);
  lines.push(`QUEUED_OPERATIONS ${plan.queued.length === 0 ? "(none)" : plan.queued.map((q) => `${q.required_provider}:${q.status}`).join(", ")}`);
  lines.push(`FETCH_AFTER_LOAD  ${plan.fetch_after_load.join(", ") || "(none)"}`);
  lines.push(`NEXT_ACTION       ${plan.next_action}`);
  return lines.join("\n");
}
