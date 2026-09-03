/**
 * หน้าที่: the public boundary of `control/owner-backbone/` — and §7's
 * complete Owner AI contract.
 *
 * A future Owner AI needs exactly these and nothing else:
 *   COMMAND INPUT : submitOwnerCommandEnvelope / newOwnerCommand
 *   STATE/OUTPUT  : subscribeOwnerEvents (eventsSince) / getWorkState /
 *                   getIncidentState
 * It never needs repository search, filesystem discovery, provider CLI
 * knowledge, service topology, credential values, or Agent process
 * management. It asks DNA OS; DNA OS returns structured state.
 *
 * Input: re-exports only.
 * Dependency ที่อนุญาต: ./gateway.ts, ./events.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never export an execution function here. An Owner
 * interface submits commands and reads state — it must have no way to
 * reach a runtime, a sandbox, or a credential.
 */

export { submitOwnerCommandEnvelope, resolveCommand, dispatchCommand, getWorkState, loadCommand, commandsForWork, newOwnerCommand, awaitDispatch, resumeWorkOnDependency } from "./gateway";
export type { ResolutionOutcome, DispatchOutcome, ResumeOutcome } from "./gateway";

export { emitSystemEvent, buildSystemEvent, eventsForWork, eventsForCommand, eventsSince, latestEventForWork, onSystemEvent } from "./events";
export type { EmitResult } from "./events";

export type {
  CommandAcknowledgement,
  CommandResolution,
  OwnerCommandEnvelope,
  OwnerCommandSource,
  OwnerCommandType,
  ReplyChannel,
  SystemEvent,
  SystemEventType,
  WorkStateView,
} from "./types";

import { eventsSince } from "./events";
import type { SystemEvent } from "./types";

/**
 * §7/§14 — the Owner AI's subscribe primitive. `last_event_id` names the
 * LAST event the interface saw; everything after it is replayed. Passing
 * null returns the full history, so a fresh interface rehydrates without
 * any special case.
 */
export function subscribeOwnerEvents(workId: string, lastEventId: string | null = null): readonly SystemEvent[] {
  return eventsSince(workId, lastEventId);
}

/** §7 — incident state, read from the incident capability's own store. */
export async function getIncidentState(incidentId: string): Promise<{ known: boolean; terminal_state: string; block_reason: string; next_action: string }> {
  const { loadRemediation } = await import("../incident-remediation/contract");
  const record = loadRemediation(incidentId);
  if (!record) return { known: false, terminal_state: "UNKNOWN", block_reason: "NONE", next_action: `no remediation record for "${incidentId}"` };
  return { known: true, terminal_state: record.terminal_state, block_reason: record.block_reason, next_action: record.next_action };
}

/**
 * §3 read model for parked work. Exposed so an Owner surface can SEE that
 * work is waiting and on what — a wait the Owner cannot observe is
 * indistinguishable from work that was lost.
 */
/**
 * DECISION 1 — ทางเข้าสาธารณะทางเดียวของ operational event
 *
 * `intakeEvent` คือ ingress/routing ที่มีอยู่แล้วและวิ่งจริงในรันไทม์ (ผ่าน
 * `intakeProviderEmails` ใน ./autonomous-recovery.ts ซึ่ง supervisor เรียกอยู่)
 * ก่อนหน้านี้มันไม่อยู่บนขอบเขตสาธารณะ capability อื่นจึงเรียกไม่ได้ตาม
 * governance/architecture-rules/CAPABILITY_FOLDER_LAW.md ข้อ 9
 *
 * export เฉพาะสิ่งที่ผู้ผลิต event จำเป็นต้องใช้: ฟังก์ชันรับเข้า สัญญาของ
 * event และผลการจัดเส้นทาง — ไม่ export classifyEvent/assessImpact/decideAction
 * ออกไป เพราะการตัดสินต้องเกิดในเจ้าของเดิม ไม่ใช่ถูกเรียกแยกชิ้นจากข้างนอก
 */
export { intakeEvent, listRouteResults, routeResultsForEvent, ACTION_TARGETS } from "./event-intake";
export type {
  RawOperationalEvent, OperationalEventIdentity, IntakeRecord, RouteResult,
  OperationalEventClass, IncidentClass, IntakeDecision, OwnerOutputState,
} from "./event-intake";

export { waitingRowFor } from "./continuation";

/**
 * The autonomous runtime-recovery loop. Exported so a supervisor entry (or
 * a proof that only WATCHES) can start it — never so a caller can perform a
 * step of it by hand.
 */
export { startRecoverySupervisor, runRecoveryCycle, serviceHealthKey } from "./autonomous-recovery";
export type { RecoveryCycle, TraceLine, RecoveryStage, SupervisorHandle } from "./autonomous-recovery";
export { dispatchRoute, resolveExecutorBinding, EXECUTOR_BINDINGS } from "./route-dispatch";
export type { DispatchRecord, DispatchStatus, ExecutorBinding, BindingResolution, DispatchOptions } from "./route-dispatch";
