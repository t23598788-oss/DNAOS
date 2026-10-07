/**
 * หน้าที่: §2–§4 — the canonical Owner Command Gateway.
 *
 *   OWNER INPUT -> persist -> ack RECEIVED -> resolve -> dispatch
 *
 * The acknowledgement returns IMMEDIATELY. Long-running work continues
 * asynchronously and reports back as `SystemEvent`s, so no interface — and
 * no AI — ever waits on execution.
 *
 * EVERYTHING IT COORDINATES ALREADY EXISTS. This file owns no execution:
 *   - resolution: `../work-resolution/#resolveWriteIntent` + `#persistResolution`
 *   - runtime ops: `../runtime-control/#runOperation` (launchd, the only supervisor)
 *   - agent work: `../agent-gateway/#runAgentWorkOrder` (the real Agent Host,
 *     with its own sandbox and its own result contract)
 *   - resource choice: `../scheduler/#discoverPool` + `#routeWork`
 *   - incidents: `../incident-remediation/`
 *   - events out: `./events.ts` -> output-routing + joint-monitor
 *
 * SAME WORK_ID CONTINUITY (§8): a command carrying `work_id_if_existing`
 * continues that work. No new work is created, and nothing re-discovers the
 * architecture — the persisted `ResolvedWorkContext` is reloaded instead.
 *
 * Input: an `OwnerCommandEnvelope`.
 * Output: `submitOwnerCommandEnvelope`, `resolveCommand`, `dispatchCommand`,
 * `awaitDispatch`, `resumeWorkOnDependency`, `getWorkState`, `loadCommand`.
 * Dependency ที่อนุญาต: ./types.ts, ./events.ts, ../agent-gateway/contract.ts,
 * ../work-resolution/contract.ts, ../runtime-control/contract.ts,
 * ../scheduler/contract.ts, ../../software/registry-database/contract.ts.
 * สิ่งที่ห้ามแตะ: never execute inside `submitOwnerCommandEnvelope` — the
 * acknowledgement must not depend on any long-running call; dispatch is
 * SCHEDULED there and awaited by nobody. Never decide that a code change
 * succeeded from what the Agent reported — only real file digests taken
 * before and after decide that. Never let an
 * interface supply a resolution or a result; both are derived here from the
 * capabilities that actually did the work.
 */

import { randomUUID, createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { saveEvidence, loadEvidenceForTask, runAgentWorkOrder } from "../agent-gateway/contract";
import type { WorkOrder } from "../agent-gateway/types";
import { resolveWriteIntent, persistResolution, loadResolution } from "../work-resolution/contract";
import { discoverPool, routeWork, REASONING_CAPABLE_PROVIDERS } from "../scheduler/contract";
import { runOperation, SERVICES } from "../runtime-control/contract";
import type { RuntimeOperationRequest } from "../runtime-control/contract";
import type { Action, OperationEvidence, ServiceId } from "../runtime-control/types";
import { createPersistentFileStore } from "../../software/registry-database/adapters/persistent-file-store";
import { findCapability } from "../../software/registry-database/lookup";
import { resolveOwnerCommandSemantics } from "../owner-command-semantics/contract";
/**
 * นำเข้าแบบ static: `../machine-observation/contract.ts` ส่ง `intakeEvent` ให้
 * bridge แบบฉีดค่า จึงไม่มีวงอ้างอิงย้อนกลับมาที่ไฟล์นี้ (พิสูจน์แล้วว่า dynamic
 * import ของ specifier ไม่มีนามสกุลใช้ไม่ได้ในรันไทม์จริง)
 */
import { targetsForCapability, observeRuntimeTarget, persistRuntimeObservation } from "../machine-observation/contract";
import { emitSystemEvent, eventsForWork, latestEventForWork } from "./events";
import { parkWorkForDependency, deliverDependencyFact, waitingRowFor, recordResumeOutcome } from "./continuation";
import { reusableAction } from "./action-ledger";
import type { CommandAcknowledgement, CommandResolution, OwnerCommandEnvelope, SystemEventType, WorkStateView } from "./types";

const SOURCE_MARKER = "control/owner-backbone/gateway.ts";

export function newOwnerCommand(input: Partial<OwnerCommandEnvelope> & Pick<OwnerCommandEnvelope, "source" | "command_type" | "requested_action" | "target">): OwnerCommandEnvelope {
  const now = new Date().toISOString();
  return {
    command_id: `ocmd-${randomUUID()}`,
    owner_intent_id: input.owner_intent_id ?? `intent-${randomUUID()}`,
    received_at: now,
    parameters: {},
    work_id_if_existing: null,
    incident_id_if_existing: null,
    priority: "NORMAL",
    authority_context: { identity_id: "owner", kind: "human" },
    reply_channel: { kind: "SSE", address: "joint-monitor" },
    correlation_id: input.correlation_id ?? `corr-${randomUUID()}`,
    ...input,
  } as OwnerCommandEnvelope;
}

/** Persisted BEFORE any acceptance is reported — §2's ordering requirement. */
function persistCommand(command: OwnerCommandEnvelope, workId: string): void {
  saveEvidence({
    evidence_id: command.command_id,
    task_id: workId,
    kind: "owner_decision",
    source: SOURCE_MARKER,
    recorded_at: command.received_at,
    payload: { command, work_id: workId },
  });
}

export function loadCommand(workId: string, commandId: string): OwnerCommandEnvelope | null {
  const row = loadEvidenceForTask(workId).find((e) => e.source === SOURCE_MARKER && e.evidence_id === commandId);
  return row ? ((row.payload as { command: OwnerCommandEnvelope }).command ?? null) : null;
}

export function commandsForWork(workId: string): readonly OwnerCommandEnvelope[] {
  return loadEvidenceForTask(workId)
    .filter((e) => e.source === SOURCE_MARKER)
    .map((e) => (e.payload as { command: OwnerCommandEnvelope }).command)
    .filter(Boolean);
}

/**
 * §2. Persist -> acknowledge. Returns in milliseconds; performs no
 * execution and no long-running resolution.
 */
export async function submitOwnerCommandEnvelope(command: OwnerCommandEnvelope): Promise<CommandAcknowledgement> {
  // §8: an existing work_id CONTINUES that work. Never a new one.
  const workId = command.work_id_if_existing ?? `work-${randomUUID()}`;

  persistCommand(command, workId);

  await emitSystemEvent({
    command_id: command.command_id,
    work_id: workId,
    incident_id: command.incident_id_if_existing,
    event_type: "COMMAND_RECEIVED",
    state: "RECEIVED",
    source: SOURCE_MARKER,
    resource_ids: [],
    capability_ids: [],
    evidence_refs: [`command:${command.command_id}`],
    next_action: "resolution",
  });

  // §4 AUTOMATIC ASYNC DISPATCH. Submitting IS dispatching. No caller —
  // and no test — ever invokes `dispatchCommand` to make work happen; that
  // export remains only so a resume can re-enter the same execution path.
  // The ack below is returned WITHOUT awaiting any of it.
  scheduleDispatch(command, workId);

  return {
    command_id: command.command_id,
    work_id: workId,
    status: "RECEIVED",
    current_phase: command.work_id_if_existing ? "CONTINUING_EXISTING_WORK" : "RESOLUTION",
    next_expected_event: command.work_id_if_existing ? "WORK_STARTED" : "WORK_STARTED | OWNER_DECISION_REQUIRED | WORK_BLOCKED",
    persisted: true,
  };
}

export interface ResolutionOutcome {
  readonly resolution: CommandResolution;
  readonly work_id: string;
  readonly detail: string;
  readonly resolution_id: string | null;
}

/**
 * §3. Deterministic. Uses the Registry/ResolvedWorkContext that already
 * exist; an Agent performs no architecture discovery at any point.
 */
export async function resolveCommand(command: OwnerCommandEnvelope, workId: string): Promise<ResolutionOutcome> {
  // Continuing work: reload the persisted resolution rather than redoing it.
  if (command.work_id_if_existing) {
    const stored = loadResolution(workId);
    if (stored && !stored.stale) {
      return { resolution: "ALREADY_IN_PROGRESS", work_id: workId, detail: `continuing work ${workId} from its persisted resolution (${stored.resolution_id}); no re-resolution performed`, resolution_id: stored.resolution_id };
    }
  }

  // A runtime operation targets a service launchd already supervises —
  // resolvable without touching the code registry at all.
  if (command.command_type === "RUNTIME_OPERATION") {
    const known = Object.keys(SERVICES as Record<string, unknown>);
    if (!known.includes(command.target)) {
      return { resolution: "UNRESOLVED_ARCHITECTURE", work_id: workId, detail: `"${command.target}" is not a service runtime-control supervises (known: ${known.join(", ")})`, resolution_id: null };
    }
    // §3 WAITING_FOR_DEPENDENCY. The Owner may name a service this one
    // needs first ("restart the UI once the API is up"). Whether that
    // prerequisite holds is decided by a REAL read-only health probe
    // through runtime-control's public contract — never assumed, and never
    // a synthetic wait state invented to demonstrate the branch.
    const requires = command.parameters.requires_service ?? "";
    if (requires.length > 0) {
      if (!known.includes(requires)) {
        return { resolution: "UNRESOLVED_ARCHITECTURE", work_id: workId, detail: `prerequisite "${requires}" is not a supervised service (known: ${known.join(", ")})`, resolution_id: null };
      }
      const probe: OperationEvidence = await runOperation(requires as ServiceId, "health");
      if (probe.health_after.healthy !== true) {
        return { resolution: "WAITING_FOR_DEPENDENCY", work_id: workId, detail: `prerequisite "${requires}" is not healthy (probed live: ${JSON.stringify(probe.health_after).slice(0, 120)})`, resolution_id: null };
      }
    }
    return { resolution: "EXECUTABLE_NOW", work_id: workId, detail: `runtime-control supervises "${command.target}"${requires ? `; prerequisite "${requires}" probed healthy` : ""}`, resolution_id: null };
  }

  /**
   * QUERY — เสียบเข้าล่ามและ resolver ที่มีอยู่ (Owner, root gap ที่พิสูจน์แล้ว)
   *
   * ก่อนหน้านี้ไม่มีกิ่งนี้เลย คำสั่งชนิดคำถามจึงตกลงกิ่งสุดท้ายซึ่งเป็นตัว
   * resolve "การแก้ซอร์ส" (`resolveWriteIntent`) แล้วตอบ UNRESOLVED_ARCHITECTURE
   * ทุกครั้ง — วัดได้จากคำสั่งจริง ocmd-182f4a54 / work-3c064adb
   *
   * ไม่มีล่ามใหม่ ไม่มีระบบคำสั่งใหม่ ไม่มี keyword พิเศษของเป้าหมายใด:
   * `../owner-command-semantics/` เป็นล่ามที่มีอยู่แล้วและถูกใช้อยู่แล้วโดย
   * `../owner-command/owner-command.ts` ที่นี่แค่เรียกมันจากเส้นทางที่คำสั่ง
   * ชนิด QUERY เดินจริง แล้วส่งเป้าหมายที่มันอ่านได้เข้า lookup ของทะเบียนที่มีอยู่
   *
   * เป้าหมายมาจาก `semantic_interpretation.target_text` ที่ล่ามอ่านจากข้อความ
   * ของ Owner เอง ไม่ใช่จาก `command.target` ที่ผู้ส่ง HTTP กรอกมา — นั่นคือ
   * สาเหตุที่ target เดิมเป็น "dna-os" ทั้งที่ Owner พูดถึง owner-command-http
   */
  if (command.command_type === "QUERY") {
    const store = createPersistentFileStore();
    const semantic = resolveOwnerCommandSemantics(
      command.command_id,
      command.requested_action,
      command.authority_context,
      { registryStore: store },
    );
    if (!semantic.ok) {
      return { resolution: "UNRESOLVED_ARCHITECTURE", work_id: workId, resolution_id: null,
        detail: `SEMANTIC_${semantic.stage}: ${semantic.reasons.join("; ").slice(0, 400)}` };
    }

    // สิ่งที่ล่ามอ่านได้ต้องถูกเก็บเป็นหลักฐาน ไม่ใช่หายไปหลังตัดสิน
    saveEvidence({
      evidence_id: `semantic-${command.command_id}`,
      task_id: workId,
      kind: "capability_lookup",
      source: "control/owner-backbone/gateway.ts#resolveCommand(QUERY) -> control/owner-command-semantics/",
      recorded_at: new Date().toISOString(),
      payload: { structured_owner_context: semantic.context },
    });

    const targetText = semantic.context.semantic_interpretation.target_text;
    if (!targetText || targetText.trim().length === 0 || targetText === "NULL") {
      return { resolution: "UNRESOLVED_ARCHITECTURE", work_id: workId, resolution_id: null,
        detail: `SEMANTIC_TARGET_ABSENT: ล่ามอ่าน intent="${semantic.context.intent}" action="${semantic.context.action}" ได้ แต่ไม่ได้ระบุเป้าหมาย` };
    }

    // lookup ที่มีอยู่แล้วในทะเบียน — ค้นด้วยชื่อที่ Owner พูด ไม่ใช่ตารางพิเศษ
    const capability = findCapability({ canonical_name: targetText }, store);
    if (!capability) {
      return { resolution: "UNRESOLVED_ARCHITECTURE", work_id: workId, resolution_id: null,
        detail: `TARGET_NOT_IN_SYSTEM_TRUTH: ค้น canonical_name="${targetText}" ในทะเบียนแล้วไม่พบ (intent="${semantic.context.intent}")` };
    }

    // capability ที่ผูกได้ต้องเดินทางต่อไปถึง dispatch เป็นฟิลด์ ไม่ใช่ให้ dispatch
    // ไปเดาจากข้อความอีกรอบ
    saveEvidence({
      evidence_id: `query-binding-${command.command_id}`,
      task_id: workId,
      kind: "capability_lookup",
      source: "control/owner-backbone/gateway.ts#resolveCommand(QUERY) -> software/registry-database#findCapability",
      recorded_at: new Date().toISOString(),
      payload: { capability_id: capability.capability_id, target_text: targetText,
        requested_result: semantic.context.semantic_interpretation.requested_result ?? null },
    });

    return { resolution: "EXECUTABLE_NOW", work_id: workId, resolution_id: null,
      detail: `QUERY target "${targetText}" -> capability ${capability.capability_id}; requested=${semantic.context.semantic_interpretation.requested_result ?? "(ไม่ระบุ)"}` };
  }

  if (command.command_type === "OWNER_DECISION") {
    return { resolution: "EXECUTABLE_NOW", work_id: workId, detail: "an Owner decision resumes existing work; no new resolution needed", resolution_id: null };
  }

  // Code change: the full deterministic resolution, persisted before dispatch.
  const context = resolveWriteIntent(
    { requested_function: command.target, requested_change: command.requested_action, target_domain: command.parameters.target_domain ?? "", owner_intent: command.requested_action, current_work_id: workId },
    createPersistentFileStore(),
  );
  if (!context.dispatchable) {
    return { resolution: "UNRESOLVED_ARCHITECTURE", work_id: workId, detail: context.blocking_reason || "resolution is not dispatchable", resolution_id: null };
  }
  const persisted = persistResolution(context);
  return { resolution: "EXECUTABLE_NOW", work_id: workId, detail: `resolved ${context.canonical_name}; scope ${context.allowed_write_scope.join(", ")}`, resolution_id: persisted.resolution_id };
}

const REPO_ROOT = resolvePath(new URL("../..", import.meta.url).pathname);

function absolute(p: string): string {
  return p.startsWith("/") ? p : join(REPO_ROOT, p);
}

/** Real bytes, not mtimes — a rewrite with identical content is NOT a change. */
function scopeDigest(scope: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      if (entry === "node_modules" || entry === ".git") continue;
      const full = join(dir, entry);
      let stat;
      try { stat = statSync(full); } catch { continue; }
      if (stat.isDirectory()) { walk(full); continue; }
      try { out.set(full, createHash("sha256").update(readFileSync(full)).digest("hex")); } catch { /* unreadable is not "unchanged"; it simply is not evidence */ }
    }
  };
  for (const path of scope) {
    const abs = absolute(path);
    let stat;
    try { stat = statSync(abs); } catch { continue; }
    if (stat.isDirectory()) walk(abs);
    else { try { out.set(abs, createHash("sha256").update(readFileSync(abs)).digest("hex")); } catch { /* same */ } }
  }
  return out;
}

/** Added, removed and modified — all three are changes. */
function changedPaths(before: Map<string, string>, after: Map<string, string>): string[] {
  const changed: string[] = [];
  for (const [path, digest] of after) if (before.get(path) !== digest) changed.push(path);
  for (const path of before.keys()) if (!after.has(path)) changed.push(`${path} (removed)`);
  return changed.sort();
}

export interface DispatchOutcome {
  readonly dispatched: boolean;
  readonly event_types: readonly SystemEventType[];
  readonly detail: string;
}

/**
 * §4. Runs the work through the EXISTING execution paths and reports every
 * meaningful transition as a `SystemEvent`.
 */
export async function dispatchCommand(
  command: OwnerCommandEnvelope,
  workId: string,
  outcome: ResolutionOutcome,
  /**
   * §6 COALESCING. Set only when this dispatch is a waiter being resumed for
   * a known condition. Inside a condition, an identical physical action that
   * already achieved the target state is SHARED rather than repeated. It is
   * deliberately absent for a fresh Owner command: an explicit "restart this"
   * must restart, even when the service currently looks fine.
   */
  context: { readonly condition_id: string | null } = { condition_id: null },
): Promise<DispatchOutcome> {
  const emitted: SystemEventType[] = [];
  const emit = async (event_type: SystemEventType, state: string, next_action: string, evidence: readonly string[] = []) => {
    emitted.push(event_type);
    await emitSystemEvent({ command_id: command.command_id, work_id: workId, incident_id: command.incident_id_if_existing, event_type, state, source: SOURCE_MARKER, resource_ids: [command.target], capability_ids: [], evidence_refs: evidence, next_action });
  };

  // WAITING_FOR_DEPENDENCY is not a dead end: the work is PARKED in the
  // existing `../work-continuation/` journal under the SAME work_id, and a
  // later arriving fact wakes it through `resumeWorkOnDependency` below.
  if (outcome.resolution === "WAITING_FOR_DEPENDENCY") {
    const requires = command.parameters.requires_service ?? "unknown";
    const park = parkWorkForDependency({
      work_id: workId,
      namespace: "runtime_state",
      values: [`service:${requires}:healthy`],
      next_action: `retry ${command.command_type} on ${command.target}`,
      resolved_work_context_ref: outcome.resolution_id,
      resolution_digest: outcome.resolution_id,
      required_worker_class: null,
    });
    await emit("DEPENDENCY_MISSING", "WAITING_FOR_DEPENDENCY", park.detail, park.blocked_on.map((k) => `dependency:${k}`));
    return { dispatched: false, event_types: emitted, detail: park.detail };
  }

  if (outcome.resolution !== "EXECUTABLE_NOW" && outcome.resolution !== "ALREADY_IN_PROGRESS") {
    await emit("WORK_BLOCKED", outcome.resolution, outcome.detail);
    return { dispatched: false, event_types: emitted, detail: outcome.detail };
  }

  await emit("WORK_STARTED", "RUNNING", `execute ${command.command_type} on ${command.target}`);

  // ---- RUNTIME OPERATION: launchd, via the existing supervisor ----------
  if (command.command_type === "RUNTIME_OPERATION") {
    const action = (command.parameters.action ?? "restart") as Action;

    // ผู้ขอ = ตัวตนที่ envelope ถืออยู่แล้ว ไม่ได้อ่านจาก requested_action ที่เป็น
    // ข้อความของคน และไม่ได้แต่งขึ้นจาก command_type — ทุกช่องคือ id ที่มีจริง
    const runtimeRequest: RuntimeOperationRequest = {
      requested_by: command.authority_context,
      lineage: {
        work_id: workId,
        command_id: command.command_id,
        correlation_id: command.correlation_id,
        owner_intent_id: command.owner_intent_id,
        ...(context.condition_id !== null ? { condition_id: context.condition_id } : {}),
      },
    };

    if (context.condition_id !== null) {
      // Read the machine BEFORE deciding to act. A waiter only shares an
      // earlier action's result when the machine still agrees with what that
      // action verified — see `./action-ledger.ts#reusableAction`.
      const observed: OperationEvidence = await runOperation(command.target as ServiceId, "health", runtimeRequest);
      const observedState = observed.health_after.healthy === true ? "SERVICE_HEALTHY" : "SERVICE_DOWN";
      const reuse = reusableAction(context.condition_id, observedState);
      if (reuse.reusable) {
        await emit(
          "SERVICE_HEALTHY",
          "COALESCED",
          reuse.reason,
          [reuse.evidence_ref ?? `condition:${context.condition_id}`, `action:${String(reuse.action_id)}`, `condition:${context.condition_id}`],
        );
        await emit("WORK_COMPLETED", "SUCCESS", "work complete — shared the canonical action's evidence, no second restart", [reuse.evidence_ref ?? `condition:${context.condition_id}`]);
        return { dispatched: true, event_types: emitted, detail: `COALESCED onto action ${String(reuse.action_id)}: ${reuse.reason}` };
      }
    }
    // The real OperationEvidence shape — health_after is the fact that
    // decides SERVICE_HEALTHY, per runtime-control's own rule that a
    // start/restart is never SUCCESS without a real passing probe.
    const evidence: OperationEvidence = await runOperation(command.target as ServiceId, action, runtimeRequest);
    const healthy = evidence.health_after.healthy === true;
    await emit(
      healthy ? "SERVICE_HEALTHY" : "SERVICE_UNHEALTHY",
      `pid ${String(evidence.pid_before)}->${String(evidence.pid_after)} launchd ${String(evidence.launchd_loaded_after)}`,
      healthy ? "none — the service answered a real probe" : "investigate the service",
      [`runtime-control:${evidence.operation_id}`],
    );
    await emit("WORK_COMPLETED", healthy ? "SUCCESS" : "FAILED", healthy ? "work complete" : "owner review");
    return { dispatched: true, event_types: emitted, detail: `health_after.ok=${String(evidence.health_after.healthy)} pid=${String(evidence.pid_after)}` };
  }

  /**
   * QUERY — เลือก resolver/executor ตามชนิดคำถาม จากของที่มีอยู่แล้ว
   *
   * ไม่มี executor ใหม่: คำถามเรื่องสถานะรันไทม์ตอบด้วย
   * `../runtime-control/#runOperation(target,"health")` ซึ่งเป็นตัวเดียวกับที่
   * กิ่ง RUNTIME_OPERATION ใช้อยู่แล้ว และเป็นการอ่านอย่างเดียว
   *
   * เป้าหมายที่ทะเบียนรู้จักแต่ไม่ได้อยู่ใต้การดูแลของ runtime-control จะจบที่
   * QUERY_EXECUTOR_NOT_REGISTERED — บอกตรง ๆ ว่ารู้จักเป้าหมายแล้วแต่ยังไม่มี
   * ผู้ตอบคำถามชนิดนี้ให้มัน ไม่ใช่การเงียบและไม่ใช่การเติมเป้าหมายพิเศษเข้าไป
   *
   * ไม่ปล่อย Agent: กิ่งนี้ไม่มีทางไปถึง runAgentWorkOrder
   */
  if (command.command_type === "QUERY") {
    const binding = loadEvidenceForTask(workId).find((e) => e.evidence_id === `query-binding-${command.command_id}`);
    const bound = binding?.payload as { capability_id?: string; target_text?: string } | undefined;
    const capabilityId = bound?.capability_id ?? null;
    const targetText = bound?.target_text ?? null;

    if (!capabilityId) {
      await emit("WORK_BLOCKED", "QUERY_BINDING_MISSING", "resolution ผ่านแล้วแต่หา capability ที่ผูกไว้ไม่เจอ");
      return { dispatched: false, event_types: emitted, detail: "no persisted query binding" };
    }

    /**
     * ผู้ตอบคือ "ผู้สังเกต" ไม่ใช่ "ผู้ควบคุม" (Owner, ทางเลือกที่ 3)
     *
     * `control/runtime-control/#SERVICES` ไม่ถูกอ่านที่นี่เลย — การเป็นสมาชิก
     * ทะเบียนนั้นเท่ากับได้สิทธิ์ start/stop/restart (ดู RUNTIME_OPERATION ด้านบน
     * ซึ่ง action ปริยายคือ restart) คำถามสถานะจึงต้องไม่พึ่งมัน
     */
    const targets = targetsForCapability(capabilityId);
    if (targets.length === 0) {
      await emit("WORK_BLOCKED", "RUNTIME_OBSERVATION_TARGET_NOT_DECLARED",
        `capability ${capabilityId} ("${targetText}") ยังไม่ได้ประกาศ RuntimeObservationTarget — ผู้สังเกตไม่รู้ว่าต้องไปวัดอะไร`);
      return { dispatched: false, event_types: emitted, detail: `RUNTIME_OBSERVATION_TARGET_NOT_DECLARED for ${capabilityId}` };
    }
    if (targets.length > 1) {
      await emit("WORK_BLOCKED", "RUNTIME_OBSERVATION_TARGET_AMBIGUOUS",
        `capability ${capabilityId} ประกาศเป้าหมายไว้ ${targets.length} รายการ — ไม่ตัดสินให้`);
      return { dispatched: false, event_types: emitted, detail: `AMBIGUOUS (${targets.length}) targets for ${capabilityId}` };
    }

    const observation = await observeRuntimeTarget(targets[0]);
    const healthy = observation.health?.healthy ?? null;

    /**
     * เก็บผลที่วัดได้ผ่าน "เจ้าของการเก็บ" เดิม — owner-backbone เป็นผู้เรียก
     * ไม่ใช่เจ้าของสโตร์ (Owner, ข้อ 4) ค่าที่วัดจะกลายเป็นหลักฐานที่มีชนิดใน
     * control/machine-observation/data/observations.jsonl
     *
     * ถ้าเก็บไม่สำเร็จ จะ **ไม่อ้าง observation id ใด ๆ** — เหตุการณ์ยังบอกค่าที่
     * วัดได้ตามเดิม แต่ต้องไม่ทำให้ดูเหมือนมีหลักฐานถาวรทั้งที่ไม่มี
     */
    const persisted = persistRuntimeObservation(observation, { work_id: workId });
    const observationRef = persisted.ok ? [`observation:${persisted.observation_id}`] : [];
    if (!persisted.ok) {
      await emit("VERIFICATION_FAILED", "OBSERVATION_PERSIST_FAILED",
        `วัดค่าได้แต่เก็บหลักฐานไม่สำเร็จ: ${persisted.detail} — ไม่มี observation id ให้อ้าง`);
    }

    await emit(
      healthy === true ? "SERVICE_HEALTHY" : "SERVICE_UNHEALTHY",
      `pid ${String(observation.pid)} uptime_s ${String(observation.uptime_seconds)} http ${String(observation.health?.http_status)}`,
      healthy === true ? "none — the target answered a real read-only probe" : `unknown: ${observation.unknown.join("; ") || "none"}`,
      [`runtime-target:${observation.runtime_target_id}`, `observed_at:${observation.observed_at}`, ...observationRef],
    );
    await emit("WORK_COMPLETED", "SUCCESS", `answered ${command.command_type} on "${targetText}"`,
      [`runtime-target:${observation.runtime_target_id}`, ...observationRef]);
    return { dispatched: true, event_types: emitted,
      detail: `pid=${String(observation.pid)} healthy=${String(healthy)} uptime_seconds=${String(observation.uptime_seconds)} unknown=${observation.unknown.length} observation=${persisted.ok ? persisted.observation_id : "NOT_PERSISTED"}` };
  }

  // ---- CODE CHANGE: real Agent execution, verified by real file bytes ---
  if (command.command_type === "CODE_CHANGE") {
    // The write scope is READ from the persisted ResolvedWorkContext. An
    // interface cannot supply it, and dispatch refuses without it.
    const stored = loadResolution(workId);
    if (stored === null || stored.stale) {
      await emit("WORK_BLOCKED", stored === null ? "NO_PERSISTED_RESOLUTION" : "RESOLUTION_STALE", stored?.staleness_reason ?? `no persisted ResolvedWorkContext for ${workId}`);
      return { dispatched: false, event_types: emitted, detail: stored?.staleness_reason ?? "no persisted resolution" };
    }
    const writeScope = stored.context.allowed_write_scope;

    // TRUTH BASELINE — the real bytes on disk BEFORE any Agent runs. Every
    // claim about what changed is decided against this, never against what
    // an Agent said it did.
    const before = scopeDigest(writeScope);

    // The Owner may pin WHICH reasoning provider runs their change first; an
    // AI may not, and an unrecognised value is refused rather than defaulted.
    const pinned = command.parameters.worker_kind ?? "";
    if (pinned !== "" && !REASONING_CAPABLE_PROVIDERS.includes(pinned as never)) {
      await emit("WORK_BLOCKED", "UNKNOWN_WORKER_KIND", `"${pinned}" is not a reasoning-capable provider (${REASONING_CAPABLE_PROVIDERS.join(", ")})`);
      return { dispatched: false, event_types: emitted, detail: `unknown worker_kind "${pinned}"` };
    }

    // FAILOVER. A resource that proves unavailable is removed from the pool
    // and the SAME deterministic router picks the next one — same work_id,
    // same resolution, new execution_id. Nothing here judges providers; it
    // only stops offering one that already failed.
    const exhausted = new Set<string>();
    const attempts: string[] = [];
    let agentResult: Awaited<ReturnType<typeof runAgentWorkOrder>> | null = null;
    type WorkerKind = "CLAUDE" | "CODEX" | "GEMINI" | "LOCAL";
    let workerKind: WorkerKind | null = null;

    for (let attempt = 0; attempt <= REASONING_CAPABLE_PROVIDERS.length; attempt += 1) {
      const pool = discoverPool(1).filter((unit) => !exhausted.has((unit as unknown as { provider: string }).provider));
      const route = routeWork({ work_id: workId, kind: "REPAIR", write_scope: [], blocked_by: [], test_files: [] } as never, pool, new Map(), []) as { ok: boolean; unit?: { unit_id: string; provider: string }; reason?: string };

      // The first attempt honours the Owner's pin; a failover never does,
      // because the pinned resource is precisely the one that just failed.
      const candidate: WorkerKind | undefined = (attempt === 0 && pinned !== "" ? pinned : route.unit?.provider) as WorkerKind | undefined;
      if (candidate === undefined || (attempt > 0 && !route.ok)) {
        await emit("RESOURCE_UNAVAILABLE", "NO_AUTHORIZED_RESOURCE", route.reason ?? `every authorized reasoning resource is exhausted (${[...exhausted].join(", ") || "none available"})`, attempts.map((a) => `attempt:${a}`));
        // WAITING_FOR_RESOURCE, not an Owner decision: no money and no new
        // permission is needed to run this again once capacity returns.
        const park = parkWorkForDependency({
          work_id: workId, namespace: "resource", values: ["worker:reasoning:available"],
          next_action: `retry ${command.command_type} on ${command.target}`,
          resolved_work_context_ref: stored.resolution_id ?? null, resolution_digest: stored.resolution_id ?? null,
          required_worker_class: "REASONING", kind: "RESOURCE",
        });
        await emit("WORK_BLOCKED", "WAITING_FOR_RESOURCE", park.detail, park.blocked_on.map((k) => `dependency:${k}`));
        return { dispatched: false, event_types: emitted, detail: `WAITING_FOR_RESOURCE after ${attempts.join(" -> ") || "no attempt"}` };
      }
      if (!REASONING_CAPABLE_PROVIDERS.includes(candidate as never)) {
        // LOCAL has no reasoning capability and is never asked to pretend.
        exhausted.add(candidate);
        continue;
      }

      workerKind = candidate;
      const executionId = `execution-${randomUUID()}`;
      await emit("AGENT_ALLOCATED", workerKind, `dispatch to Agent Host, workspace ${writeScope.join(", ")}`, [`unit:${route.unit?.unit_id ?? workerKind}`, `execution:${executionId}`]);

      const workOrder: WorkOrder = {
        operation: "MODIFY",
        target_type: "FILE",
        target_path: writeScope[0],
        requested_change: command.requested_action,
        content: "",
        workspace_scope: absolute(writeScope[0]),
        mode: "sandbox",
        required_tests: [],
        forbidden_files: [...stored.context.forbidden_write_scope],
        evidence: [],
        agent_run: {
          worker_kind: workerKind,
          instruction: command.requested_action,
          assigned_source_paths: writeScope.map(absolute),
          dependency_read_paths: [],
          workspace_path: absolute(writeScope[0]),
          timeout_ms: Number(command.parameters.timeout_ms ?? "120000"),
          expected_result_contract: "DNA_OS_AGENT_RESULT_V1",
        },
      } as WorkOrder;

      agentResult = await runAgentWorkOrder(workOrder, `owner-backbone:${workId}:${executionId}`, process.env as Record<string, string | undefined>);
      attempts.push(`${workerKind}:${agentResult.status}`);
      if (agentResult.status === "PASS") break;

      await emit("AGENT_FAILED", agentResult.status, `${agentResult.error_code ?? "no error_code"}: ${agentResult.summary.slice(0, 160)}`, [`agent-result:${agentResult.result_id}`, `execution:${executionId}`]);
      // §9. Record the failure AGAINST the credential evidence of the
      // moment, so this worker is not offered again until that evidence
      // changes. Dynamically imported: `./resource-availability.ts` imports
      // this file for the resume path, and a static import would be a cycle.
      try {
        const { recordResourceFailure } = await import("./resource-availability");
        recordResourceFailure(workerKind, `${agentResult.error_code ?? agentResult.status}: ${agentResult.summary.slice(0, 200)}`);
      } catch { /* the failure event above is already persisted; the ledger is an optimisation, not the record */ }
      exhausted.add(workerKind);
      await emit("AGENT_FAILOVER", `${workerKind}_UNAVAILABLE`, `SAME work_id ${workId}, SAME resolution ${String(stored.resolution_id)}, next authorized resource`, [`agent-result:${agentResult.result_id}`]);
      agentResult = null;
    }

    const after = scopeDigest(writeScope);
    const changed = changedPaths(before, after);

    if (changed.length > 0) {
      await emit("FILE_CHANGED", `${changed.length} file(s)`, `verified by comparing real file digests before and after`, changed.map((c) => `file:${c}`));
    }

    if (agentResult === null || agentResult.status !== "PASS") {
      await emit("WORK_BLOCKED", "ALL_RESOURCES_FAILED", changed.length > 0 ? "an Agent failed AFTER changing files — review the diff before retrying" : `every attempt failed: ${attempts.join(" -> ")}`);
      return { dispatched: false, event_types: emitted, detail: `no resource completed the work: ${attempts.join(" -> ")}` };
    }

    // VERIFICATION IS OURS. A PASS from the Agent that produced no byte
    // change is a FAILED verification here, because the requested change
    // was a change.
    await emit("VERIFICATION_STARTED", "RUNNING", "compare real file digests against the pre-dispatch baseline");
    if (changed.length === 0) {
      await emit("VERIFICATION_FAILED", "NO_FILE_CHANGED", "the Agent reported PASS but not one byte in the approved write scope changed", [`agent-result:${agentResult.result_id}`]);
      await emit("WORK_BLOCKED", "NO_FILE_CHANGED", "owner review");
      return { dispatched: false, event_types: emitted, detail: "agent PASS with no file change — refused" };
    }
    await emit("VERIFICATION_PASSED", "FILES_CHANGED", `${changed.join(", ")}`, [`agent-result:${agentResult.result_id}`]);
    await emit("WORK_COMPLETED", "SUCCESS", "work complete", [`agent-result:${agentResult.result_id}`, ...changed.map((c) => `file:${c}`)]);
    return { dispatched: true, event_types: emitted, detail: `${workerKind} changed ${changed.join(", ")} (result ${agentResult.result_id})` };
  }

  await emit("WORK_COMPLETED", "ACKNOWLEDGED", "owner decision recorded; existing work resumes");
  return { dispatched: true, event_types: emitted, detail: outcome.detail };
}

/**
 * §4 — the async dispatch queue. One in-flight run per work_id, started on
 * the next tick so `submitOwnerCommandEnvelope` returns first.
 *
 * NOT A NEW WORKER SYSTEM: it starts nothing and executes nothing. It calls
 * the same `resolveCommand` -> `dispatchCommand` path that already existed,
 * one tick later, so the Owner's acknowledgement never waits on execution.
 * There is no polling anywhere — arrival of work drives it.
 */
const inFlight = new Map<string, Promise<DispatchOutcome>>();

function scheduleDispatch(command: OwnerCommandEnvelope, workId: string): void {
  const run = new Promise<DispatchOutcome>((resolve) => {
    setImmediate(() => {
      void (async () => {
        try {
          const outcome = await resolveCommand(command, workId);
          resolve(await dispatchCommand(command, workId, outcome));
        } catch (error) {
          // A crash in dispatch must surface as a real event, never as an
          // unhandled rejection that leaves the work silently stuck.
          const detail = error instanceof Error ? error.message : String(error);
          await emitSystemEvent({
            command_id: command.command_id, work_id: workId, incident_id: command.incident_id_if_existing,
            event_type: "WORK_BLOCKED", state: "DISPATCH_FAILED", source: SOURCE_MARKER,
            // The reason travels WITH the event. It used to live only in the
            // returned `detail`, which nothing persisted and no surface could
            // read, so every dispatch crash reached the Owner as a bare
            // WORK_BLOCKED/DISPATCH_FAILED with an empty evidence list — the
            // Owner could see that work stopped but never why. `capability_ids`
            // stays empty here because this branch resolved nothing; it is the
            // absence of a resolution, not a resolution that found nothing.
            resource_ids: [command.target], capability_ids: [], evidence_refs: [`dispatch_error:${detail}`.slice(0, 500)], next_action: "owner review",
          }).catch(() => undefined);
          resolve({ dispatched: false, event_types: ["WORK_BLOCKED"], detail: `DISPATCH_FAILED: ${detail}` });
        }
      })();
    });
  });
  // Chained so a previous run for the same work_id finishes first — the
  // same-work_id continuity rule applies to execution order too.
  const previous = inFlight.get(workId);
  inFlight.set(workId, previous ? previous.then(() => run) : run);
}

/**
 * §13 — await the dispatch this backbone already started. This is an
 * OBSERVER: it triggers nothing, and work reaches the same outcome whether
 * or not anyone calls it. It exists so a caller (or a proof) can be
 * deterministic instead of sleeping.
 */
export function awaitDispatch(workId: string): Promise<DispatchOutcome | null> {
  return inFlight.get(workId) ?? Promise.resolve(null);
}

/**
 * The work's RESULT, as a digest that is stable across identical outcomes.
 * Deliberately NOT the latest event_id: an id is unique per event, so using
 * it would make every result look new and would silently disable
 * work-continuation's bounded-retry rule.
 */
function resultDigestFor(workId: string): string | null {
  const latest = latestEventForWork(workId);
  if (latest === null) return null;
  return createHash("sha256").update(JSON.stringify({ t: latest.event_type, s: latest.state, n: latest.next_action })).digest("hex").slice(0, 32);
}

export interface ResumeOutcome {
  readonly work_id: string;
  readonly resumed: boolean;
  readonly verdict: string;
  readonly detail: string;
  readonly dispatch: DispatchOutcome | null;
}

/**
 * §3 — a dependency arrived for parked work. The verdict comes from
 * `../work-continuation/`'s evaluator; this function only translates it
 * into a `SystemEvent` and, on RESUME_ELIGIBLE, re-enters dispatch on the
 * SAME work_id. A refusal is reported verbatim and never overridden.
 */
export async function resumeWorkOnDependency(input: {
  readonly work_id: string;
  readonly namespace: string;
  readonly value: string;
  readonly source: string;
  readonly evidence_ref: string;
  /** The condition whose canonical action this waiter may share. See §6. */
  readonly condition_id?: string | null;
}): Promise<ResumeOutcome> {
  const stored = loadResolution(input.work_id);
  const arrival = deliverDependencyFact({
    work_id: input.work_id,
    namespace: input.namespace,
    value: input.value,
    source: input.source,
    evidence_ref: input.evidence_ref,
    current_resolution_digest: stored?.resolution_id ?? waitingRowFor(input.work_id)?.last_verified_revision ?? null,
    current_result_digest: resultDigestFor(input.work_id),
  });

  if (!arrival.resume) {
    await emitSystemEvent({
      command_id: null, work_id: input.work_id, incident_id: null,
      event_type: "WORK_BLOCKED", state: arrival.evaluation?.verdict ?? "UNKNOWN_WORK", source: SOURCE_MARKER,
      resource_ids: [], capability_ids: ["work-continuation"], evidence_refs: [input.evidence_ref],
      next_action: arrival.detail,
    });
    return { work_id: input.work_id, resumed: false, verdict: arrival.evaluation?.verdict ?? "UNKNOWN_WORK", detail: arrival.detail, dispatch: null };
  }

  await emitSystemEvent({
    command_id: null, work_id: input.work_id, incident_id: null,
    event_type: "WORK_RESUMED", state: "RESUME_ELIGIBLE", source: SOURCE_MARKER,
    resource_ids: [], capability_ids: ["work-continuation"], evidence_refs: [input.evidence_ref],
    next_action: waitingRowFor(input.work_id)?.next_action ?? "re-dispatch",
  });

  // The ORIGINAL command is replayed — the persisted envelope, not a new
  // one an interface supplied. Same work_id, same intent, no re-resolution
  // of what the Owner asked for.
  const original = commandsForWork(input.work_id)[0];
  if (original === undefined) {
    return { work_id: input.work_id, resumed: true, verdict: "RESUME_ELIGIBLE", detail: `${arrival.detail}; no persisted command to replay`, dispatch: null };
  }
  const outcome = await resolveCommand(original, input.work_id);
  const dispatch = await dispatchCommand(original, input.work_id, outcome, { condition_id: input.condition_id ?? null });
  // What it produced, written back so an identical repeat trigger is inert.
  recordResumeOutcome(input.work_id, resultDigestFor(input.work_id));
  return { work_id: input.work_id, resumed: true, verdict: "RESUME_ELIGIBLE", detail: arrival.detail, dispatch };
}

/** §13. Read model, derived entirely from the persisted stores. */
export function getWorkState(workId: string): WorkStateView {
  const events = eventsForWork(workId);
  const commands = commandsForWork(workId);
  const latest = latestEventForWork(workId);
  return {
    work_id: workId,
    known: events.length > 0 || commands.length > 0,
    resolution: null,
    latest_event: latest,
    event_count: events.length,
    commands: commands.map((c) => c.command_id),
    detail: latest ? `${latest.event_type}/${latest.state} at ${latest.observed_at}` : "no events recorded for this work_id",
  };
}
