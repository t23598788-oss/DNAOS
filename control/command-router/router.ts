/**
 * หน้าที่: the router itself — the ONLY logic in this repo allowed to
 * turn Owner intent text into a call against a registered capability.
 * Classifies (`classifyCommand`), enforces the permission boundary
 * (`../../permissions/execution-policy/contract.ts` — never bypassed for
 * any capability whose registry entry says `permission_requirement:
 * "execution-policy"`), invokes exactly one real in-repo capability
 * surface per step, and folds a whole sequence of steps into ONE
 * `CapabilityResult` so `../owner-command/` never has to render each
 * sub-step as its own surface.
 *
 * No business logic lives here beyond matching + sequencing + the
 * permission gate — matches `../README.md`'s own "ห้ามมี business logic
 * หนักอยู่ที่นี่" rule. Every real operation is delegated to the
 * capability's own contract/adapter file.
 *
 * Input: an Owner command text + `CommandEnvelope`, optionally an
 * explicit multi-step plan and an `ExecutionPolicyContext` (required only
 * when a step targets a capability that requires a permission decision).
 * Output: `CapabilityResult` (`../../contracts/command/capability-result.ts`).
 * Dependency ที่อนุญาต: `./types.ts`, `./capability-registry.ts`,
 * `./host-runtime.ts`, `../../contracts/command/`,
 * `../../permissions/execution-policy/contract.ts`,
 * `../../execution/run/contract.ts`,
 * `../../connections/github/github-adapter.ts` (its one documented public
 * entry point — see that file's own header),
 * `../../connections/research-engine/research-engine-adapter.ts` (its one
 * documented public entry point, see that folder's README),
 * `../agent-gateway/contract.ts` (its one documented public entry point
 * `submitTask` — the Dispatcher step, added 2026-08-20),
 * `../../observability/joint-monitor/contract.ts` (`reportJoint` — Pillar
 * 1 of the OS-level enforcement plan, added 2026-08-22; a pure, void-
 * fired mirror call, never a control-flow dependency — see
 * `admitAndBuildResult`).
 * `../connector-execution-boundary/contract.ts` (`executeConnectorCommand`
 * — the ONE generic path for any capability whose `endpoint.kind ===
 * "connector"`, added 2026-08-22 to fix the DigitalOcean DI gap generically
 * rather than importing `connections/digitalocean/` directly here — see
 * `runConnectorStep`).
 * `../engineering-runtime/contract.ts` (`runEngineeringCoding` — ENGINEERING
 * coding authority only; Business capabilities never share this write path).
 * สิ่งที่ห้ามแตะ: never call `../../execution/run/contract.ts`'s
 * `startExecution` for a step without first getting an `ALLOW` decision
 * from `evaluateExecutionPermission` in THIS SAME call — no
 * router→executor bypass, no matter how the caller phrases the request.
 * Never invoke a capability whose `health_status` is `"NOT_CONNECTED"` —
 * report `BLOCKED` instead of faking a call. Never continue a step
 * sequence past a step that did not return `COMPLETED` — a multi-worker
 * command stops at the first non-success step and reports that step's
 * outcome, it never silently skips ahead.
 *
 * NOT_YET_BUILT: no runtime caller yet — see ./tests/router.test.ts,
 * which drives this module directly by hand the same way
 * ../../execution/run/tests/executor.test.ts drives execution/run/.
 */

import type { CommandEnvelope } from "../../contracts/command/command-envelope";
import type { CapabilityResult, CapabilityResultArtifact, CapabilityResultEvidence, CapabilityResultStatus } from "../../contracts/command/capability-result";
import { evaluateExecutionPermission } from "../../permissions/execution-policy/contract";
import type { ExecutionPermissionDecision, ExecutionPermissionRequest, ExecutionPolicyContext } from "../../permissions/execution-policy/contract";
import { startExecution } from "../../execution/run/contract";
import type { ExecutionRequest } from "../../execution/run/contract";
import { ExecutionError } from "../../execution/run/contract";
import { handleGithubCommand } from "../../connections/github/github-adapter";
import { fetchResearchEngineLatestResult } from "../../connections/research-engine/research-engine-adapter";
import { dispatchTask, DEFAULT_AGENT_WORKERS, setVoiceBridgeEnabled, isVoiceBridgeEnabled, admitCompletedTask, runAgentWorkOrder, runCorrectiveLoop, createTaskWorkspace, transitionWorkspace, linkSourceReservation, loadEvidenceForTask } from "../agent-gateway/contract";
import type { Status as DispatcherTaskStatus, WorkerKind, WorkOrder, TaskWorkspace } from "../agent-gateway/contract";
import { resolveWorker } from "../agent-host/contract";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { submitAgentWork } from "../agent-production-ingress/contract";
import { listRepositories } from "../../software/repository-registry/contract";
import type { RepositoryRegistration } from "../../software/repository-registry/contract";
import { createPersistentFileStore } from "../../software/registry-database/adapters/persistent-file-store";
import { parseOsLoginTarget, requestOsLogin } from "../../connections/os-login/adapter-contract";
import { openOsUi, parseOsUiTarget, runUiWorkOrder } from "../../connections/os-ui/adapter-contract";
import type { UiWorkOrder } from "../../connections/os-ui/work-order";
import { getCapability, listCapabilities } from "./capability-registry";
import { hostNowIso } from "./host-runtime";
import { reportJoint } from "../../observability/joint-monitor/contract";
import { executeConnectorCommand } from "../connector-execution-boundary/contract";
import { isBusinessCapabilityId, readEngineeringCodingIntent, resolveIsolatedEngineeringCheckout, removePublicationProofCheckout, runAutonomousEngineeringLoop } from "../engineering-runtime/contract";
import type { CapabilityRegistration, ClassificationOutcome, RouterStep } from "./types";
import type { StructuredOwnerContext } from "../owner-command-semantics/types";

export interface RouteOptions {
  /** Explicit multi-worker plan, executed in order. Omit to let the router classify `commandText` into exactly one step from `envelope.intent`/`envelope.payload`. */
  steps?: readonly RouterStep[];
  /** Required only when a step targets a capability whose registry entry has `permission_requirement: "execution-policy"`. Resolved by the caller (matches ../../permissions/execution-policy/types.ts's own stated boundary — this module never resolves identity/membership/grants itself). */
  executionPolicyContext?: ExecutionPolicyContext;
  /** Base fields (identity/account/workspace/cwd_scope) an execution-requiring step's permission request is built from. Required together with executionPolicyContext. */
  executionRequestBase?: Pick<ExecutionPermissionRequest, "identity_id" | "account_id" | "workspace_id" | "cwd_scope">;
  /**
   * งานเดิมที่คำสั่งนี้เป็นการทำต่อจาก (Owner, USE_EXISTING_CONTINUATION_MODEL ข้อ 5)
   *
   * ใช้กลไก `parent_task_id` ที่ `MemoryReference` มีอยู่แล้วและ corrective loop
   * ใช้อยู่แล้ว ไม่ใช่สายเลือดชนิดที่สอง ละไว้ = งานตั้งต้น (null) เหมือนเดิมทุกประการ
   *
   * นี่คือสิ่งที่ทำให้ "โปรเซส Agent เปลี่ยนตัวได้ แต่บทสนทนาไม่เปลี่ยน" เป็นจริง:
   * ตัวตนที่คงอยู่คือสายงานของ DNA OS ไม่ใช่ PID ของโปรเซสไหน
   */
  parentTaskId?: string | null;
  /**
   * Canonical Owner work identity (`work-<uuid>`). command_id stays a command
   * identifier and is never used as this value.
   */
  work_id?: string | null;
  /** Owner-presented envelope fields (e.g. engineering_coding_intent). Merged, never invented. */
  envelope_payload?: Record<string, unknown> | null;
}

const CANONICAL_WORK_ID = /^work-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function canonicalWorkIdFrom(envelope: CommandEnvelope, options: RouteOptions): string {
  if (typeof options.work_id === "string" && CANONICAL_WORK_ID.test(options.work_id)) return options.work_id;
  const payload = envelope.payload;
  if (payload && typeof payload === "object") {
    const id = (payload as { canonical_work_id?: unknown }).canonical_work_id;
    if (typeof id === "string" && CANONICAL_WORK_ID.test(id)) return id;
  }
  return `work-${randomUUID()}`;
}

function proposedWritesFromPayload(payload: unknown): readonly { readonly relative_path: string; readonly content: string }[] | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const raw = (payload as { proposed_writes?: unknown }).proposed_writes;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const writes: { relative_path: string; content: string }[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const relative_path = (row as { relative_path?: unknown }).relative_path;
    const content = (row as { content?: unknown }).content;
    if (typeof relative_path === "string" && typeof content === "string") writes.push({ relative_path, content });
  }
  return writes.length > 0 ? writes : undefined;
}

function matchesText(cap: CapabilityRegistration, text: string): boolean {
  const normalized = text.toLocaleLowerCase();
  return cap.match_keyword_sets.some((set) => set.every((keyword) => normalized.includes(keyword.toLocaleLowerCase())));
}

/**
 * ที่มาของการตัดสินใจ routing — ต้องอ่านออกจากหลักฐาน ไม่ใช่เดาจากผลลัพธ์
 *
 * ก่อนหน้านี้ router ตัดสินจากข้อความดิบเสมอ ทั้งที่ ../owner-command/ แนบผลของ
 * ../owner-command-semantics/ มากับ envelope.payload ตั้งแต่ 2026-08-26 แล้ว
 * (owner-command.ts#191) ผลนั้นไม่เคยมีผู้อ่านเลยสักที่ — ชั้นที่รันโมเดลจริงและ
 * เทียบ registry จริงจึงถูกทิ้งทั้งก้อน แล้วปลายทางกลับไปใช้ includes() บนข้อความ
 */
export type RoutingSource = "STRUCTURED_OWNER_CONTEXT" | "FALLBACK_RAW_TEXT";

/**
 * รูปร่างที่ไฟล์นี้ "อ่าน" จาก payload ของต่างถิ่น ไม่ใช่สัญญาชุดที่สอง
 *
 * ทำไมไม่ import จาก ../owner-command-semantics/contract: ไฟล์นั้น import
 * listCapabilities จากไฟล์นี้อยู่แล้ว (resolver.ts:43) การ import กลับไปคือวงกลม
 * ตัวอ่านนี้จึงประกาศเฉพาะสามฟิลด์ที่ต้องใช้จริง และไม่มีสิทธิ์ตัดสินอะไรเลย
 * ถ้าฝั่งโน้นเปลี่ยนสัญญา ตัวอ่านจะไม่เจอค่า แล้วตกไป FALLBACK_RAW_TEXT ซึ่งเป็น
 * พฤติกรรมเดิมเป๊ะ ๆ — เปลี่ยนสัญญาที่โน่นจึงทำให้ที่นี่เงียบลง ไม่ใช่พังหรือเดา
 */
interface ResolvedCapabilityReadShape {
  readonly status?: unknown;
  readonly resolved_id?: unknown;
  readonly evidence_refs?: unknown;
}

/**
 * capability id ที่ ../owner-command-semantics/ พิสูจน์แล้วจริง ๆ เท่านั้น
 *
 * เกณฑ์ทั้งสามข้อมาจากสัญญาของฝั่งโน้นตรง ๆ ไม่ได้ผ่อนลง:
 *   status = RESOLVER_MATCHED   (ไม่ใช่ AI_INTERPRETED ที่โมเดลแค่พูด)
 *   resolved_id เป็นสตริงจริง   (สัญญาบอกว่า null เมื่อไม่ได้พิสูจน์)
 *   evidence_refs ไม่ว่าง       (สัญญาบอกว่าว่างได้เฉพาะ UNRESOLVED/AMBIGUOUS)
 *
 * แล้วยังกรองอีกชั้นด้วย getCapability ของ registry ตัวเดียวกับที่ router ใช้ —
 * นี่คือการตรวจว่า id นั้นมีจริง ไม่ใช่การ map ชื่อจาก namespace อื่นเข้ามา
 * (resolver.ts#134 ใช้ capability_id จาก ./capability-registry.ts ตัวเดียวกันนี้)
 */
function provenCapabilityIdsFromContext(payload: unknown): readonly string[] {
  if (typeof payload !== "object" || payload === null) return [];
  const context = (payload as { structured_owner_context?: unknown }).structured_owner_context;
  if (typeof context !== "object" || context === null) return [];
  const resolved = (context as { resolved_capabilities?: unknown }).resolved_capabilities;
  if (!Array.isArray(resolved)) return [];

  const ids: string[] = [];
  for (const raw of resolved as readonly ResolvedCapabilityReadShape[]) {
    if (typeof raw !== "object" || raw === null) continue;
    if (raw.status !== "RESOLVER_MATCHED") continue;
    const id = raw.resolved_id;
    if (typeof id !== "string" || id.trim() === "") continue;
    if (!Array.isArray(raw.evidence_refs) || raw.evidence_refs.length === 0) continue;
    if (!getCapability(id)) continue;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Pure classification — never invokes anything, never mutates registry state. */
export function classifyCommand(commandText: string): ClassificationOutcome {
  const matches = listCapabilities().filter((cap) => matchesText(cap, commandText));

  if (matches.length === 0) {
    return { status: "UNSUPPORTED_COMMAND", reason: `no registered capability's match_keyword_sets matched "${commandText}"` };
  }
  if (matches.length > 1) {
    return {
      status: "OWNER_REVIEW",
      reason: `"${commandText}" matches more than one registered capability — router refuses to guess`,
      candidates: matches.map((m) => m.capability_id),
    };
  }
  return { status: "MATCHED", capability: matches[0] };
}

function evidence(source: string, note: string): CapabilityResultEvidence {
  return { source, note };
}

/**
 * One task_id, one meaning: DNA OS received work -> task_id -> canonical
 * task lifecycle (control/agent-gateway/'s own store) -> result/evidence.
 * Every CapabilityResult this router returns is now backed by a real,
 * admitted Task via admitCompletedTask() — GET /task/:id can always find
 * it, never a task_id that only looked real.
 */
function toGatewayStatus(status: CapabilityResultStatus): DispatcherTaskStatus {
  switch (status) {
    case "COMPLETED": return "COMPLETED";
    case "BLOCKED": return "BLOCKED";
    case "FAILED": return "FAILED";
    case "OWNER_REVIEW": return "WAITING_OWNER_DECISION";
    case "RUNNING": return "EXECUTING";
    case "PENDING": return "RECEIVED";
  }
}

function admitAndBuildResult(
  envelope: CommandEnvelope,
  capabilityId: string,
  status: CapabilityResultStatus,
  summary: string,
  ev: CapabilityResultEvidence[],
  artifacts: CapabilityResultArtifact[],
  warnings: string[],
  nextAction: string | null,
  parentTaskId: string | null = null,
): CapabilityResult {
  // Same rule as ./output-classifier.ts's classifyOutput: "dispatcher" is
  // the one capability_id that actually hands work to a real AgentAdapter
  // — this outer, router-level task record carries the same lane that
  // function would derive from the CapabilityResult below, so a single
  // command never disagrees with itself about which lane it's in.
  const task = admitCompletedTask({
    intent_text: envelope.intent,
    memory: { user_id: envelope.issued_by.identity_id, workspace_id: envelope.issued_by.acting_as_account_id, conversation_id: envelope.command_id, parent_task_id: parentTaskId },
    submitted_by_client: "command-router",
    status: toGatewayStatus(status),
    next_action: nextAction,
    evidence: ev.map((e) => ({ kind: "execution_output" as const, source: e.source, payload: { note: e.note } })),
    output_lane: capabilityId === "dispatcher" ? "WORK_ITEM" : "SYSTEM_STATE",
  });
  // Pillar 1 (Owner, 2026-08-22 — see /Users/tam/.claude/plans/zesty-spinning-ripple.md):
  // this is the ONE place every CapabilityResult this router ever returns is minted —
  // mirroring here, not inside runStep, means every Owner-command-driven joint is
  // reported exactly once, including early classification exits (via terminal()).
  // void-fired: a down/unreachable joint-monitor must never affect a real Owner command.
  void reportJoint({ from_capability: "command-router", to_capability: capabilityId, task_id: task.task_id, status, summary, source: "control/command-router/router.ts#admitAndBuildResult" });
  return { task_id: task.task_id, capability_id: capabilityId, status, summary, evidence: ev, artifacts, warnings, next_action: nextAction };
}

function terminal(envelope: CommandEnvelope, capabilityId: string, status: CapabilityResultStatus, summary: string, ev: CapabilityResultEvidence[], warnings: string[], nextAction: string | null): CapabilityResult {
  return admitAndBuildResult(envelope, capabilityId, status, summary, ev, [], warnings, nextAction);
}

function relationshipQueryFromPayload(payload: unknown): StructuredOwnerContext["relationship_query"] {
  if (!payload || typeof payload !== "object") return null;
  const context = (payload as { structured_owner_context?: Partial<StructuredOwnerContext> }).structured_owner_context;
  const query = context?.relationship_query;
  return query && typeof query === "object" ? query as StructuredOwnerContext["relationship_query"] : null;
}

interface StepOutcome {
  status: CapabilityResultStatus;
  evidenceEntries: CapabilityResultEvidence[];
  artifacts: CapabilityResultArtifact[];
  warnings: string[];
  summary: string;
  /**
   * สิ่งที่ต้องเกิดต่อไป ในภาษาที่ Owner อ่านได้ — รวมถึง "คำถามของ Agent"
   * (Owner, USE_EXISTING_CONTINUATION_MODEL ข้อ 4)
   *
   * ไหลต่อไปที่ `admitAndBuildResult` ซึ่งเขียนมันลงทั้ง Task.next_action และ
   * CapabilityResult.next_action อยู่แล้ว ไม่ต้องมีทางส่งใหม่
   * ละไว้ = ใช้ค่าเดิมที่ router สรุปจากสถานะ ไม่ใช่ทับด้วยค่าว่าง
   */
  nextAction?: string | null;
}

async function runExecutionStep(step: RouterStep, envelope: CommandEnvelope, options: RouteOptions): Promise<StepOutcome> {
  if (!options.executionPolicyContext || !options.executionRequestBase) {
    return {
      status: "BLOCKED",
      evidenceEntries: [evidence("router", "step requires a permission decision but no executionPolicyContext/executionRequestBase was supplied")],
      artifacts: [],
      warnings: ["execution step blocked: missing permission context"],
      summary: `capability "${step.capability_id}" requires an execution-policy decision, none was supplied`,
    };
  }

  const payload = (step.payload ?? {}) as { command_id?: string; action?: string; requested_args?: readonly string[]; permission_decision_id?: string };
  const commandId = payload.command_id ?? step.intent;
  const action = payload.action ?? "run";
  const requestedArgs = payload.requested_args ?? [];

  const permissionRequest: ExecutionPermissionRequest = {
    identity_id: options.executionRequestBase.identity_id,
    account_id: options.executionRequestBase.account_id,
    workspace_id: options.executionRequestBase.workspace_id,
    capability: "execution.run",
    command_id: commandId,
    action,
    cwd_scope: options.executionRequestBase.cwd_scope,
    requested_args: requestedArgs,
    correlation_id: envelope.command_id,
  };

  const decision: ExecutionPermissionDecision = evaluateExecutionPermission(permissionRequest, options.executionPolicyContext, hostNowIso());

  if (decision.decision === "OWNER_REVIEW") {
    return {
      status: "OWNER_REVIEW",
      evidenceEntries: [evidence("permission-reasoner", `decision=${decision.decision} reason_codes=${decision.reason_codes.join(",")}`)],
      artifacts: [{ kind: "decision_id", ref: decision.decision_id }],
      warnings: [],
      summary: `execution of "${commandId}" requires Owner review before it may run`,
    };
  }
  if (decision.decision === "DENY") {
    return {
      status: "BLOCKED",
      evidenceEntries: [evidence("permission-reasoner", `decision=${decision.decision} reason_codes=${decision.reason_codes.join(",")}`)],
      artifacts: [{ kind: "decision_id", ref: decision.decision_id }],
      warnings: [],
      summary: `execution of "${commandId}" was denied by execution-policy`,
    };
  }

  // decision.decision === "ALLOW" — only now may execution/run be touched.
  const request: ExecutionRequest = {
    correlation_id: envelope.command_id,
    command_id: commandId,
    identity_id: permissionRequest.identity_id,
    account_id: permissionRequest.account_id,
    workspace_id: permissionRequest.workspace_id,
    capability: "execution.run",
    action,
    cwd_scope: permissionRequest.cwd_scope,
    requested_args: {},
    permission_decision_id: decision.decision_id,
  };

  try {
    const result = startExecution(request, decision);
    const mapped: CapabilityResultStatus = result.status === "passed" ? "COMPLETED" : result.status === "running" || result.status === "queued" ? "RUNNING" : result.status === "permission_denied" ? "BLOCKED" : "FAILED";
    return {
      status: mapped,
      evidenceEntries: [
        evidence("permission-reasoner", `decision=ALLOW decision_id=${decision.decision_id}`),
        evidence("execution", `execution_id=${result.execution_id} status=${result.status} exitCode=${String(result.exitCode)}`),
      ],
      artifacts: [{ kind: "execution_id", ref: result.execution_id }],
      warnings: result.workspacePolicyViolation ? ["workspace changed during a READ_ONLY execution — see execution/run's workspaceChangedPaths"] : [],
      summary: `execution "${commandId}" finished with status ${result.status}`,
    };
  } catch (error) {
    const message = error instanceof ExecutionError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error);
    return {
      status: "FAILED",
      evidenceEntries: [evidence("execution", `startExecution threw: ${message}`)],
      artifacts: [],
      warnings: [],
      summary: `execution "${commandId}" failed to start: ${message}`,
    };
  }
}

async function runGithubStep(step: RouterStep, envelope: CommandEnvelope): Promise<StepOutcome> {
  const stepEnvelope: CommandEnvelope = { ...envelope, intent: step.intent, payload: step.payload };
  const outcome = await handleGithubCommand(stepEnvelope);

  if (outcome.ok) {
    return {
      status: "COMPLETED",
      evidenceEntries: [evidence("github", `event_type=${outcome.event.event_type} event_id=${outcome.event.event_id}`)],
      artifacts: [{ kind: "event_id", ref: outcome.event.event_id }],
      warnings: [],
      summary: `github adapter completed "${step.intent}"`,
    };
  }
  return {
    status: "FAILED",
    evidenceEntries: [evidence("github", `denied_at_stage=${outcome.rejection.denied_at_stage} reason=${outcome.rejection.reason}`)],
    artifacts: [],
    warnings: [],
    summary: `github adapter rejected "${step.intent}": ${outcome.rejection.reason}`,
  };
}

/**
 * research-engine is CONNECTED in the static registry (the adapter exists
 * and is wired), but that says nothing about whether the real
 * http://localhost:8787 service is up RIGHT NOW. `fetchResearchEngineLatestResult`
 * does its own live health check before ever calling `/api/research/latest`
 * and always resolves to a `ResearchEngineStepOutcome` — a `StepOutcome`
 * with the same field names by construction (see
 * ../../connections/research-engine/adapter-contract.ts) — so no mapping
 * layer is needed here, unlike runGithubStep/runExecutionStep above.
 */
async function runResearchEngineStep(): Promise<StepOutcome> {
  return fetchResearchEngineLatestResult();
}

async function runOsLoginStep(step: RouterStep): Promise<StepOutcome> {
  const payload = step.payload ?? {};
  const target = parseOsLoginTarget(step.intent, payload);
  if (!target) {
    return {
      status: "OWNER_REVIEW",
      evidenceEntries: [evidence("os-login", "target was not uniquely identified; no OS action was attempted")],
      artifacts: [],
      warnings: ["OS login target must be macos-firewall or tailscale"],
      summary: "OS login request requires an explicit target",
    };
  }
  const requestedAction = payload && typeof payload === "object" && "action" in payload ? String(payload.action ?? "") : "";
  const action = requestedAction === "status" || /\bstatus\b|สถานะ|ตรวจ/.test(step.intent.toLowerCase()) ? "status" : "request_access";
  const result = await requestOsLogin({ target, action });
  const status: CapabilityResultStatus = result.status === "READY" ? "COMPLETED" : result.status === "OWNER_ACTION_REQUIRED" ? "OWNER_REVIEW" : result.status === "DENIED" ? "BLOCKED" : result.status === "UNKNOWN" ? "BLOCKED" : "FAILED";
  return {
    status,
    evidenceEntries: result.evidence.map((item) => evidence("os-login", item)),
    artifacts: [],
    warnings: result.status === "OWNER_ACTION_REQUIRED" ? ["No credential was read or stored; Owner action is required in the official OS/vendor surface"] : [],
    summary: result.summary,
  };
}

function isUiWorkOrderPayload(payload: unknown): payload is UiWorkOrder {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  return typeof p.ui_action === "string" && ["open_url", "open_path", "open_app", "screenshot", "read_screen", "speak", "click", "type", "key", "focus", "wait"].includes(p.ui_action);
}

/**
 * The ONE real approval-gate step for the Claude Voice Bridge (Owner,
 * 2026-08-20). enable/disable is the real, evidenced approval event —
 * `envelope.issued_by.identity_id` (a real, already-authenticated
 * identity — owner-command never lets a non-human through) is recorded
 * as who approved it, matching ../agent-gateway/voice-bridge.ts's own
 * header. `status`/no keyword match reports the current gate state
 * without changing it.
 */
async function runVoiceBridgeStep(step: RouterStep, envelope: CommandEnvelope): Promise<StepOutcome> {
  const intent = step.intent.toLowerCase();
  const wantsDisable = intent.includes("disable") || intent.includes("ปิดเสียงพูด");
  const wantsEnable = intent.includes("enable") || intent.includes("เปิดเสียงพูด");

  if (!wantsEnable && !wantsDisable) {
    const enabled = isVoiceBridgeEnabled();
    return {
      status: "COMPLETED",
      evidenceEntries: [evidence("voice-bridge", `enabled=${enabled}`)],
      artifacts: [],
      warnings: [],
      summary: `Voice Bridge is currently ${enabled ? "ENABLED" : "DISABLED"}`,
    };
  }

  const result = setVoiceBridgeEnabled(wantsEnable, envelope.issued_by.identity_id);
  return {
    status: "COMPLETED",
    evidenceEntries: [evidence("voice-bridge", `enabled=${result.enabled}`), evidence("voice-bridge", `approved_by=${result.approved_by ?? "n/a"}`)],
    artifacts: [],
    warnings: result.enabled ? ["Unattended TTS announcements are now ON for LOW/MEDIUM-risk task results only — HIGH-risk/credential/production-code results are never auto-spoken"] : [],
    summary: `Voice Bridge ${result.enabled ? "ENABLED" : "DISABLED"} by ${envelope.issued_by.identity_id}`,
  };
}

async function runOsUiStep(step: RouterStep): Promise<StepOutcome> {
  // 2026-08-20 (Owner Work Order): a structured UiWorkOrder payload routes
  // to the richer, validated runUiWorkOrder path (open_url/open_path/
  // screenshot/read_screen/speak/click/type/key/focus/wait, admission before execute) — same "os-ui" capability, same
  // step function, not a second entry point. A plain {target} payload (or
  // free-text intent) still uses the original simple openOsUi flow below,
  // unchanged for existing callers.
  if (isUiWorkOrderPayload(step.payload)) {
    const order = step.payload as UiWorkOrder;
    const result = await runUiWorkOrder(order);
    return {
      status: result.status === "COMPLETED" || result.status === "DRY_RUN_OK" ? "COMPLETED" : result.status === "OWNER_ACTION_REQUIRED" ? "OWNER_REVIEW" : result.status === "BLOCKED" ? "BLOCKED" : "FAILED",
      evidenceEntries: result.evidence.map((item) => evidence("os-ui", item)),
      artifacts: result.artifacts.map((a) => ({ kind: a.kind, ref: a.ref })),
      warnings: result.idempotent_replay ? ["idempotent replay — the same Work Order was already executed once, not re-run"] : [],
      summary: result.summary,
    };
  }

  const target = parseOsUiTarget(step.intent, step.payload ?? {});
  if (!target) {
    return {
      status: "OWNER_REVIEW",
      evidenceEntries: [evidence("os-ui", "target was not uniquely identified; no macOS open action was attempted")],
      artifacts: [],
      warnings: ["OS UI target must match the allowlist"],
      summary: "OS UI request requires one allowlisted target",
    };
  }
  const result = await openOsUi(target);
  return {
    status: result.status === "COMPLETED" ? "COMPLETED" : result.status === "OWNER_ACTION_REQUIRED" ? "OWNER_REVIEW" : result.status === "UNKNOWN" ? "BLOCKED" : "FAILED",
    evidenceEntries: result.evidence.map((item) => evidence("os-ui", item)),
    artifacts: [],
    warnings: [],
    summary: result.summary,
  };
}

async function runPermissionReasonerStep(step: RouterStep, envelope: CommandEnvelope, options: RouteOptions): Promise<StepOutcome> {
  if (!options.executionPolicyContext || !options.executionRequestBase) {
    return {
      status: "BLOCKED",
      evidenceEntries: [evidence("router", "permission-reasoner step requires executionPolicyContext/executionRequestBase")],
      artifacts: [],
      warnings: ["permission-reasoner step blocked: missing context"],
      summary: `capability "${step.capability_id}" could not evaluate — missing context`,
    };
  }
  const payload = (step.payload ?? {}) as { command_id?: string; action?: string; requested_args?: readonly string[] };
  const request: ExecutionPermissionRequest = {
    identity_id: options.executionRequestBase.identity_id,
    account_id: options.executionRequestBase.account_id,
    workspace_id: options.executionRequestBase.workspace_id,
    capability: "execution.run",
    command_id: payload.command_id ?? "unknown",
    action: payload.action ?? "run",
    cwd_scope: options.executionRequestBase.cwd_scope,
    requested_args: payload.requested_args ?? [],
    correlation_id: envelope.command_id,
  };
  const decision = evaluateExecutionPermission(request, options.executionPolicyContext, hostNowIso());
  const mapped: CapabilityResultStatus = decision.decision === "ALLOW" ? "COMPLETED" : decision.decision === "OWNER_REVIEW" ? "OWNER_REVIEW" : "BLOCKED";
  return {
    status: mapped,
    evidenceEntries: [evidence("permission-reasoner", `decision=${decision.decision} reason_codes=${decision.reason_codes.join(",")}`)],
    artifacts: [{ kind: "decision_id", ref: decision.decision_id }],
    warnings: [],
    summary: `permission-reasoner returned ${decision.decision} for command_id "${request.command_id}"`,
  };
}

/**
 * `dispatcher` -> `../agent-gateway/contract.ts`'s `submitTask` — the
 * Work Order handoff step in Command -> Work Order -> Policy ->
 * Dispatcher -> Worker (Owner, 2026-08-20). The submitted Task IS the
 * Work Order; agent-gateway's own POLICY_CHECK stage is the Policy step.
 * Workers are `../agent-gateway/workers.ts`'s `DEFAULT_AGENT_WORKERS` —
 * the ONE real worker list, shared with `dna-os-circuit/runtime/server.ts`
 * (2026-08-20 fix: those two used to each declare their own separate copy,
 * which had drifted out of sync — see workers.ts's own header). A future
 * Coding Agent worker is added to that one shared array, never to a
 * router-local copy.
 */

function mapDispatcherStatus(status: DispatcherTaskStatus): CapabilityResultStatus {
  if (status === "COMPLETED") return "COMPLETED";
  if (status === "FAILED") return "FAILED";
  if (status === "BLOCKED") return "BLOCKED";
  if (status === "WAITING_OWNER_DECISION") return "OWNER_REVIEW";
  return "RUNNING"; // RECEIVED / ROUTING / POLICY_CHECK / EXECUTING / VERIFYING — still in flight
}

async function runDispatcherStep(step: RouterStep, envelope: CommandEnvelope): Promise<StepOutcome> {
  const candidate = step.payload as Record<string, unknown> | null | undefined;
  const workOrder = candidate && typeof candidate.target_path === "string" && candidate.mode === "sandbox"
    ? candidate as unknown as import("../agent-gateway/types").WorkOrder
    : undefined;
  const task = await dispatchTask(
    step.intent,
    { user_id: envelope.issued_by.identity_id, workspace_id: envelope.issued_by.acting_as_account_id, conversation_id: envelope.command_id, parent_task_id: null },
    "command-router",
    DEFAULT_AGENT_WORKERS,
    workOrder
  );
  const status = mapDispatcherStatus(task.status);
  return {
    status,
    evidenceEntries: [evidence("dispatcher", `task_id=${task.task_id} status=${task.status}`)],
    artifacts: [{ kind: "dispatcher_task_id", ref: task.task_id }],
    warnings: status === "BLOCKED" ? [`dispatcher task ${task.task_id} ended BLOCKED — no matching capability or policy stop`] : [],
    summary: `dispatcher task "${task.task_id}" for "${step.intent}" is ${task.status}`,
  };
}

/**
 * Deterministic, keyword-based WorkerKind selection — never an LLM
 * decision, never free text passed straight through. Defaults to LOCAL
 * (the fully sandbox-confined, no-external-CLI worker) whenever the
 * intent text names no specific provider, matching this repo's existing
 * fail-safe-to-the-narrowest-option convention.
 */
function selectWorkerKind(intentText: string): WorkerKind {
  const normalized = intentText.toLocaleLowerCase();
  if (normalized.includes("codex")) return "CODEX";
  if (normalized.includes("gemini")) return "GEMINI";
  if (normalized.includes("claude")) return "CLAUDE";
  return "LOCAL";
}

/**
 * REQUIREMENT 2 (BACKEND READER) — reads real, already-persisted system
 * state BEFORE any Agent command is issued, so the Agent itself never
 * determines authoritative system state. Reuses the existing capability
 * registry read path (`../../software/capability-registrar/contract.ts`)
 * — no new registry, no new reader.
 */
async function readBackendContextBeforeDispatch(): Promise<{ capability_count: number; capability_index_source: string }> {
  const { getCapabilityIndex } = await import("../../software/capability-registrar/contract");
  const index = getCapabilityIndex();
  return { capability_count: index.length, capability_index_source: "software/capability-registrar/contract.ts#getCapabilityIndex" };
}

/**
 * The real Agent Host worker execution step — DNA_OS_DECISION ->
 * WORK_ORDER -> AGENT_SELECTOR -> AGENT_HOST -> SANDBOX_EXEC ->
 * AGENT_WORKER -> MACHINE_RESULT -> RESULT_INGRESS -> VERIFY ->
 * NEXT_DECISION, all through `../agent-gateway/contract.ts`'s
 * `runAgentWorkOrder` (Agent Host wiring, unmodified) and
 * `runCorrectiveLoop` (existing Decision Engine, unmodified) — this
 * function adds no new sandbox, no new decision logic, only the real
 * command-router entry point those two already-built pieces were
 * missing.
 */
/**
 * Builds the ONE real, unified work-unit representation (Owner, Phase
 * 1A) — a real `WorkOrder` whose `agent_run` field carries everything
 * `runAgentWorkOrder` needs. No second, ad hoc task-description shape.
 * `agent_run.workspace_id` (Owner, Phase 2) is the real TaskWorkspace
 * `createTaskWorkspace` already allocated — the Agent never chooses its
 * own cwd/source here; WorkspaceManager already decided it before this
 * function runs.
 */
function buildAgentHostWorkOrder(step: RouterStep, workerKind: WorkerKind, workspace: TaskWorkspace, workOrderId: string): WorkOrder {
  const localWorker = workerKind === "LOCAL" ? resolveWorker("LOCAL") : null;
  const instruction = workerKind === "LOCAL" && localWorker?.ok
    ? JSON.stringify({ action: "credential_probe" })
    : step.intent;
  return {
    operation: "MODIFY",
    target_type: "FILE",
    target_path: "(agent-host: no direct file target — see agent_run.workspace_id)",
    requested_change: step.intent,
    content: "",
    workspace_scope: workspace.allowed_write_workspace,
    mode: "sandbox",
    required_tests: [],
    forbidden_files: [],
    evidence: [],
    work_order_id: workOrderId,
    agent_run: {
      worker_kind: workerKind,
      instruction,
      workspace_id: workspace.workspace_id,
      assigned_source_paths: workspace.allowed_read_paths,
      dependency_read_paths: workspace.dependency_paths,
      workspace_path: workspace.allowed_write_workspace,
      timeout_ms: 60_000,
      expected_result_contract: "DNA_OS_AGENT_RESULT_V1",
    },
  };
}

/**
 * ตัวตนของ repository มาจาก software/repository-registry/ เท่านั้น — `root` เป็น
 * แค่กุญแจค้นหา ไม่ใช่ตัวตน (Owner, CONNECT_OWNER_SOFTWARE_WORK_TO_EXISTING_GIT_WORKTREE
 * PHASE A: "Do not substitute process.cwd() as repository identity").
 *
 * ต้องมีพยานสองทางที่เป็นอิสระต่อกันจึงจะถือว่าพิสูจน์แล้ว: แถว ACTIVE ในทะเบียน
 * ต้องชี้ `repository_root` มาที่ checkout นี้ และ `source_authority` ของแถวนั้น
 * ต้องปรากฏจริงใน `.git/config` ของ checkout เดียวกัน — ทะเบียนตอบว่า "ใคร"
 * ส่วน .git/config ตอบว่า "ที่นี่คือ repo นั้นจริงไหม" ทะเบียนอย่างเดียวยืนยัน
 * ตัวเองไม่ได้
 *
 * ตรงกันหลายแถว = คลุมเครือ คืน null ไม่เลือกให้เอง — และ null แปลว่าไม่แยก
 * worktree (คงพฤติกรรมเดิมไว้) ไม่ใช่เดาตัวตนขึ้นมา
 */
function resolveSelfRepository(root: string): RepositoryRegistration | null {
  let gitConfig: string;
  try {
    gitConfig = readFileSync(join(root, ".git", "config"), "utf8");
  } catch {
    return null;
  }
  const corroborated = listRepositories().filter(
    (r) => r.status === "ACTIVE" && r.repository_root === root && r.source_authority.length > 0 && gitConfig.includes(r.source_authority),
  );
  return corroborated.length === 1 ? corroborated[0]! : null;
}

async function runAgentHostStep(step: RouterStep, envelope: CommandEnvelope, options: RouteOptions): Promise<StepOutcome> {
  const backendContext = await readBackendContextBeforeDispatch();
  const workerKind = selectWorkerKind(step.intent);
  const workOrderId = canonicalWorkIdFrom(envelope, options);

  // WORKSPACE_MANAGER (Owner, Phase 2): DNA OS selects assigned MASTER_SOURCE
  // (read-only) and materializes a fresh TASK_WORKSPACE (read+write) BEFORE
  // Agent Host is ever invoked -- the Agent never picks its own cwd/source.
  const workspace = createTaskWorkspace({
    work_order_id: workOrderId,
    command_id: envelope.command_id,
    assigned_source: [process.cwd()],
    // Deliberately OUTSIDE MASTER_SOURCE entirely (Owner, Phase 2 —
    // "Source Separation") -- createTaskWorkspace's own overlap check
    // refuses any TASK_WORKSPACE root nested under assigned_source, and
    // process.cwd() (the repo root) IS assigned_source here.
    workspace_root: "/tmp/dna-os-agent-workspaces",
  });
  transitionWorkspace(workspace.workspace_id, "PREPARE_CONTEXT", "command-router: real WorkOrder built, about to dispatch");

  /**
   * P6 ISOLATED CODING (Owner, CONNECT_OWNER_SOFTWARE_WORK_TO_EXISTING_GIT_WORKTREE).
   *
   * ก่อนหน้านี้ของที่ Agent เขียนได้จริงคือไดเรกทอรีเปล่าใน /tmp ซึ่งไม่ใช่ git
   * worktree ไม่มี branch และไม่ผูกกับ repository ตัวใด — เส้น production ที่ทำ
   * การแยกจริง (control/agent-production-ingress/) มีอยู่ครบแต่ไม่เคยถูกเรียก
   * ตรงนี้คือจุดที่มันถูกเรียก ไม่ใช่ระบบใหม่
   *
   * `createTaskWorkspace` ข้างบนยังอยู่ในฐานะตัวตนของ task/lifecycle ตามที่ Owner
   * สั่งให้คงไว้ การผูกสองระบบเข้าด้วยกันใช้สะพานที่มีอยู่แล้ว
   * `linkSourceReservation` — ไม่สร้างสะพานใหม่ และไม่สร้าง workspace ระบบที่สอง
   *
   * FAIL CLOSED: ถ้าพิสูจน์ตัวตน repository ไม่ได้ หรือ ingress ไม่ผ่านสักด่าน
   * เราไม่แยก worktree และไม่แต่งตัวตนขึ้นมา — พฤติกรรมเดิมคงอยู่ทั้งดุ้น และ
   * เหตุผลจริงถูกบันทึกเป็น evidence ให้ Owner เห็น ไม่ใช่กลืนเงียบ
   */
  const repository = resolveSelfRepository(process.cwd());
  let isolationEvidence: string;
  if (!repository) {
    isolationEvidence = "source_isolation=NOT_APPLIED reason=NO_CORROBORATED_REPOSITORY_IDENTITY";
  } else {
    const ingress = await submitAgentWork({
      work_id: workOrderId,
      holder_agent_id: "control/command-router/router.ts#runAgentHostStep",
      // CLAIM เท่านั้น — ingress ไปพิสูจน์กับทะเบียนเองอีกรอบ ไม่ได้เชื่อเรา
      requested_owner: repository.owner,
      requested_repository: repository.repository,
      candidate: {
        candidate_id: `owner-software-work-${envelope.command_id}`,
        name: `owner-software-work-${envelope.command_id}`,
        kind: "resource",
        source_location: `control/command-router/router.ts#runAgentHostStep/${envelope.command_id}`,
        owner: "control/command-router/router.ts",
        input: [], output: [], side_effects: [], dependencies: [],
        behavior: step.intent,
        version: "1.0.0",
        evidence_refs: [`command:${envelope.command_id}`, `work_order:${workOrderId}`],
        // งานหนึ่งครั้งของ Agent คือหลักฐานทางวิศวกรรม ไม่ใช่ capability ใหม่ —
        // EXECUTION_EVIDENCE จึงเป็นชนิดที่ตรง และ domain ถูกอนุมานจากชนิดนี้
        // โดย control/event-pipeline/domain-classification.ts ไม่ใช่เราเลือกเอง
        domain: "ENGINEERING_EVIDENCE",
        resource_type: "EXECUTION_EVIDENCE",
        data_classification: "INTERNAL",
        source_system: "dna-os-infrastructure",
        scope: "owner-software-change",
        requested_owner: repository.owner,
        requested_repository: repository.repository,
      },
      // ขอบเขตจริงที่งานนี้แตะ — ไม่ว่างจึงทำให้ ingress สร้าง git worktree จริง
      resource_scope: [repository.repository_root],
      lease_ms: 120_000,
      correlation_id: envelope.command_id,
    }, () => createPersistentFileStore());

    if (ingress.workspace) {
      const link = linkSourceReservation(workspace.workspace_id, ingress.workspace.reservation_id, workOrderId);
      isolationEvidence = `source_isolation=APPLIED repository_id=${ingress.resolved_repository_id} reservation_id=${ingress.workspace.reservation_id} branch_ref=${ingress.workspace.branch_ref} worktree_path=${ingress.workspace.worktree_path} base_commit_sha=${ingress.workspace.base_commit_sha} link_ok=${link.ok} ingress_stage=${ingress.final_stage} ingress_status=${ingress.final_status}`;
    } else {
      isolationEvidence = `source_isolation=NOT_APPLIED repository_id=${ingress.resolved_repository_id ?? "none"} ingress_stage=${ingress.final_stage} ingress_status=${ingress.final_status} reason=${ingress.reason}`;
    }
  }

  const workOrder = buildAgentHostWorkOrder(step, workerKind, workspace, workOrderId);
  const result = await runAgentWorkOrder(workOrder, { kind: "DIRECT", correlation_id: envelope.command_id, work_id: workOrderId }, process.env);

  const loopOutcome = await runCorrectiveLoop(result, "command-router");

  /**
   * AGENT_MESSAGE -> AGENT_QUESTION (Owner, USE_EXISTING_CONTINUATION_MODEL ข้อ 4)
   *
   * Agent Host บันทึกทุกข้อความที่ Agent พูดระหว่างทางไว้เป็น evidence แล้ว
   * อ่านกลับด้วย `loadEvidenceForTask` ตัวเดิม ไม่ใช่ช่องทางใหม่
   *
   * กฎแยก "คำถาม" ออกจาก "รายงาน" เป็นกฎเดียว ตรวจได้ ไม่มีโมเดลมาตัดสิน:
   * ข้อความสุดท้ายที่มีเครื่องหมายคำถามคือคำถาม เมื่อมีคำถาม งานนี้ไม่ใช่งานที่
   * จบแล้ว มันคืองานที่รอเจ้าของ — ซึ่งระบบมีสถานะของมันอยู่แล้วคือ
   * OWNER_REVIEW ที่ toGatewayStatus แปลเป็น WAITING_OWNER_DECISION
   * และเป็นสถานะเดียวที่ `ownerDecision()` ยอมรับคำตอบ
   */
  const spokenLines = loadEvidenceForTask(result.task_id)
    .filter((e) => e.source.endsWith("#agent-message"))
    .map((e) => String((e.payload as { agent_message?: unknown } | null)?.agent_message ?? ""))
    .filter((t) => t.trim() !== "");
  const agentQuestion = [...spokenLines].reverse().find((t) => /[?？]/.test(t)) ?? null;

  /**
   * งานนี้ "รอเจ้าของ" เมื่อ Agent ถามเอง หรือเมื่อ Decision Engine ตัดสินจาก
   * evidence จริงว่า requires_owner_approval — สองอย่างนี้คือช่องถามเดียวกัน
   * ที่ระบบมีอยู่แล้ว ไม่ใช่สองระบบ (Owner, USE_EXISTING_CONTINUATION_MODEL ข้อ 2)
   *
   * เดิม OWNER_REVIEW_REQUIRED ถูกลดเหลือสตริงใน evidence แล้วงานถูกปิดเป็น
   * FAILED ทั้งที่มันไม่ได้ล้มเหลว มันกำลังรอคำตอบ — และเมื่อปิดเป็น FAILED
   * `ownerDecision()` ก็รับคำตอบไม่ได้อีกเลย เพราะประตูรับคำตอบเปิดเฉพาะกับ
   * WAITING_OWNER_DECISION เท่านั้น
   */
  const needsOwner = agentQuestion !== null || loopOutcome.state === "OWNER_REVIEW_REQUIRED";
  const status: CapabilityResultStatus = needsOwner
    ? "OWNER_REVIEW"
    : result.status === "PASS" ? "COMPLETED" : result.status === "BLOCKED" || result.status === "FAIL_CLOSED" ? "BLOCKED" : "FAILED";
  return {
    status,
    evidenceEntries: [
      evidence("agent-host", `backend_reader capability_count=${backendContext.capability_count} source=${backendContext.capability_index_source}`),
      evidence("agent-host", isolationEvidence),
      evidence("agent-host", `work_order_id=${result.work_order_id} workspace_id=${result.workspace_id} launch_id=${result.launch_id ?? "none"} task_id=${result.task_id} worker_id=${result.worker_id} status=${result.status} error_code=${result.error_code ?? "none"} exit_code=${result.exit_code} agent_pid=${result.runtime.agent_pid} sandbox_profile_hash=${result.runtime.sandbox_profile_hash ?? "none"}`),
      evidence("agent-host", `result_id=${result.result_id} verification_id=${result.verification_id ?? "none"} evidence_refs=${result.evidence_refs.join(",")} corrective_loop_state=${loopOutcome.state} decision_id=${loopOutcome.decision_id ?? "none"}`),
      // สิ่งที่ Decision Engine บอกให้ทำต่อ — เดิมเหลือแค่ id ตรงนี้
      ...(loopOutcome.next_action ? [evidence("decision-engine", `next_action=${loopOutcome.next_action}`)] : []),
      ...(loopOutcome.decision_reason ? [evidence("decision-engine", `decision_reason=${loopOutcome.decision_reason}`)] : []),
      // ทุกคำที่ Agent พูด เรียงตามที่มันพูดจริง
      ...spokenLines.map((text) => evidence("agent", text)),
    ],
    nextAction: agentQuestion ?? loopOutcome.next_action ?? null,
    artifacts: [
      { kind: "agent_host_work_order_id", ref: result.work_order_id },
      { kind: "agent_host_task_id", ref: result.task_id },
      ...result.artifacts.map((a) => ({ kind: "agent_host_artifact", ref: a })),
    ],
    warnings: status === "BLOCKED" ? [`agent-host task ${result.task_id} ended ${result.status} (error_code=${result.error_code})`] : [],
    summary: agentQuestion ?? `agent-host task "${result.task_id}" worker=${workerKind} status=${result.status} corrective_loop=${loopOutcome.state}`,
  };
}

/**
 * Generic path for any capability whose `endpoint.kind === "connector"`
 * (see ./types.ts's `EndpointReference`). Never imports a provider
 * folder directly — always through `executeConnectorCommand`, which
 * looks up that provider's own dependency-closed `ConnectorInvoker`.
 * `auth_required: true` maps to `BLOCKED` (the existing status this
 * repo already uses for "reached the real gate honestly, correctly
 * found nothing usable" — see the `capability.health_status ===
 * "NOT_CONNECTED"` branch above for the same status choice) with an
 * `AUTH_REQUIRED`-prefixed summary so a caller can distinguish "no
 * credential yet" from a genuine failure without a new
 * CapabilityResultStatus value — see this STEP's own commit note on why
 * that closed union was left untouched.
 */
async function runEngineeringStep(step: RouterStep, envelope: CommandEnvelope, options: RouteOptions): Promise<StepOutcome> {
  const workId = canonicalWorkIdFrom(envelope, options);
  const isolated = await resolveIsolatedEngineeringCheckout(process.cwd(), workId);
  if (!isolated.ok) {
    return {
      status: "BLOCKED",
      evidenceEntries: [evidence("engineering-runtime", `isolated_checkout=FAILED reason_code=${isolated.reason_code} ${isolated.detail}`)],
      artifacts: [{ kind: "engineering_work_id", ref: workId }],
      warnings: [isolated.detail],
      summary: isolated.detail,
    };
  }
  const payload = step.payload ?? envelope.payload;
  const proposedWrites = proposedWritesFromPayload(payload);
  try {
    const loop = await runAutonomousEngineeringLoop({
      command_id: envelope.command_id,
      work_id: workId,
      intent_text: step.intent,
      payload,
      checkout_root: isolated.checkout_root,
      selected_capability_id: step.capability_id,
      proposed_writes: proposedWrites,
    });
    const result = loop.completion;
    const publication = loop.publication;
    const engineeringStatus = result?.status ?? loop.status;
    const lineageNote = `command_id=${envelope.command_id} work_id=${loop.work_id} reservation_id=${result?.lineage.reservation_id ?? "none"} changed_path=${result?.lineage.changed_path ?? "none"} worktree_path=${result?.lineage.worktree_path ?? "none"} manifest_id=${result?.lineage.manifest_id ?? "none"} admission_decision=${result?.lineage.admission_decision ?? "none"} integration_status=${result?.lineage.integration_status ?? "none"} isolated_checkout=${isolated.isolated} checkout_root=${isolated.checkout_root} dna_os_commit_sha=${publication?.lineage.dna_os_commit_sha ?? "none"} github_destination=${publication?.lineage.github_owner && publication.lineage.github_repository ? `${publication.lineage.github_owner}/${publication.lineage.github_repository}` : "none"} publish_status=${publication?.lineage.publish_status ?? "not_attempted"} pre_publish_remote_sha=${publication?.lineage.pre_publish_remote_sha ?? "none"} post_publish_remote_sha=${publication?.lineage.post_publish_remote_sha ?? "none"} autonomous_loop_status=${loop.status} lifecycle_stage=${loop.lifecycle?.stage ?? "none"} worker_id=${loop.worker_id ?? "none"} repair_count=${loop.repair_count}`;
    const status = loop.status === "VERIFIED" ? "COMPLETED"
      : loop.status === "CI_PENDING" ? "RUNNING"
      : loop.status === "OWNER_REVIEW" ? "OWNER_REVIEW"
        : loop.status === "REJECTED" ? "FAILED"
          : loop.status;
    return {
      status,
      evidenceEntries: [
        evidence("engineering-runtime", `engineering_status=${engineeringStatus} reason_code=${loop.reason_code} coding_write_applied=${result?.coding.write_applied ?? false}`),
        evidence("engineering-runtime", lineageNote),
        evidence("engineering-runtime", loop.detail),
        ...(publication ? [evidence("engineering-runtime", `github_publish_status=${publication.status} reason_code=${publication.reason_code} ${publication.detail}`)] : []),
        ...(loop.github_proof ? [evidence("engineering-runtime", `github_permanence_status=${loop.github_proof.status} lineage_verified=${loop.github_proof.lineage_verified} expected_files_verified=${loop.github_proof.expected_files_verified} ci_required=${loop.github_proof.ci_required} remote_sha=${loop.github_proof.remote_sha}`)] : []),
        ...(loop.workspace_cleanup.length > 0 ? [evidence("engineering-runtime", `workspace_cleanup=${loop.workspace_cleanup.map((row) => `${row.workspace_id}:${row.status}`).join(",")}`)] : []),
        ...(loop.registry_written ? [evidence("engineering-runtime", "registry_write_after_verify=true")] : [evidence("engineering-runtime", `registry_write_after_verify=false registry_written=${loop.registry_written}`)]),
      ],
      artifacts: [
        { kind: "engineering_work_id", ref: loop.work_id },
        ...(result?.lineage.reservation_id ? [{ kind: "engineering_reservation_id", ref: result.lineage.reservation_id }] : []),
        ...(result?.lineage.manifest_id ? [{ kind: "engineering_manifest_id", ref: result.lineage.manifest_id }] : []),
        ...(result?.lineage.changed_path ? [{ kind: "engineering_changed_path", ref: result.lineage.changed_path }] : []),
        ...(publication?.lineage.dna_os_commit_sha ? [{ kind: "engineering_commit_sha", ref: publication.lineage.dna_os_commit_sha }] : []),
        ...(publication?.lineage.post_publish_remote_sha ? [{ kind: "engineering_remote_sha", ref: publication.lineage.post_publish_remote_sha }] : []),
      ],
      warnings: status === "BLOCKED" || status === "FAILED" || status === "OWNER_REVIEW" ? [loop.detail] : [],
      summary: loop.owner_result,
    };
  } finally {
    if (isolated.proof) removePublicationProofCheckout(isolated.proof);
  }
}

async function runConnectorStep(step: RouterStep, envelope: CommandEnvelope, capabilityId: string): Promise<StepOutcome> {
  const stepEnvelope: CommandEnvelope = { ...envelope, intent: step.intent, payload: step.payload };
  const outcome = await executeConnectorCommand(capabilityId, stepEnvelope);

  if (outcome.ok) {
    return { status: "COMPLETED", evidenceEntries: [...outcome.evidence], artifacts: outcome.artifacts.map((a) => ({ kind: a.kind, ref: a.ref })), warnings: [], summary: outcome.summary };
  }
  if (outcome.auth_required) {
    return {
      status: "BLOCKED",
      evidenceEntries: [...outcome.evidence, evidence("connector-execution-boundary", "AUTH_REQUIRED")],
      artifacts: [],
      warnings: [`AUTH_REQUIRED: "${capabilityId}" has no usable credential binding yet — no token was faked, no call was made to the external provider`],
      summary: outcome.summary,
    };
  }
  return { status: "FAILED", evidenceEntries: [...outcome.evidence], artifacts: [], warnings: [], summary: outcome.summary };
}

async function runStep(step: RouterStep, envelope: CommandEnvelope, options: RouteOptions): Promise<StepOutcome> {
  const capability = getCapability(step.capability_id);

  if (!capability) {
    return { status: "FAILED", evidenceEntries: [evidence("router", `unknown capability_id "${step.capability_id}"`)], artifacts: [], warnings: [], summary: `unknown capability_id "${step.capability_id}"` };
  }
  if (capability.health_status === "NOT_CONNECTED") {
    return {
      status: "BLOCKED",
      evidenceEntries: [evidence("router", `capability "${capability.capability_id}" is NOT_CONNECTED (repo_id=${capability.repo_id})`)],
      artifacts: [],
      warnings: [`"${capability.capability_id}" is not connected — no call was made`],
      summary: `capability "${capability.capability_id}" is not connected in this checkout`,
    };
  }

  if (capability.capability_id === "execution") return runExecutionStep(step, envelope, options);
  if (capability.capability_id === "github") return runGithubStep(step, envelope);
  if (capability.capability_id === "research-engine") return runResearchEngineStep();
  if (capability.capability_id === "permission-reasoner") return runPermissionReasonerStep(step, envelope, options);
  if (capability.capability_id === "dispatcher") return runDispatcherStep(step, envelope);
  if (capability.capability_id === "agent-host") return runAgentHostStep(step, envelope, options);
  if (capability.capability_id === "engineering-runtime") return runEngineeringStep(step, envelope, options);
  if (capability.capability_id === "os-login") return runOsLoginStep(step);
  if (capability.capability_id === "os-ui") return runOsUiStep(step);
  if (capability.capability_id === "voice-bridge") return runVoiceBridgeStep(step, envelope);
  if (capability.endpoint.kind === "connector") return runConnectorStep(step, envelope, capability.capability_id);

  // CONNECTED but this router build has no wiring for it yet — never fake a result.
  return {
    status: "FAILED",
    evidenceEntries: [evidence("router", `capability "${capability.capability_id}" is CONNECTED but has no router wiring implemented`)],
    artifacts: [],
    warnings: [],
    summary: `capability "${capability.capability_id}" has no router implementation yet`,
  };
}

/**
 * The single public entry point: one Owner command in, one combined
 * `CapabilityResult` out — whether it took one step or several. Steps run
 * strictly in order; the sequence stops at the first step that does not
 * return `COMPLETED`.
 */
export async function routeOwnerCommand(envelope: CommandEnvelope, commandText: string, options: RouteOptions = {}): Promise<CapabilityResult> {
  let steps: readonly RouterStep[];
  /** บันทึกไว้เป็นหลักฐาน ไม่ใช่ให้คนอ่านผลลัพธ์เดาเอาเองว่ามาจากทางไหน */
  let routingSource: RoutingSource = "FALLBACK_RAW_TEXT";
  let routingNote = "";

  if (options.steps && options.steps.length > 0) {
    steps = options.steps;
    routingNote = "caller supplied explicit steps — neither structured context nor raw text was consulted";
  } else {
    // ผลที่ ../owner-command-semantics/ พิสูจน์แล้วมาก่อนข้อความดิบเสมอ
    // ข้อความดิบไม่มีสิทธิ์ทับค่าที่ resolver พิสูจน์ไปแล้ว — เมื่อเข้ากิ่งนี้
    // classifyCommand จะไม่ถูกเรียกเลย
    const relationshipQuery = relationshipQueryFromPayload(envelope.payload);
    if (relationshipQuery) {
      const q = relationshipQuery;
      const evidenceRows = q.evidence_refs.map((ref) => evidence("relationship-query", ref));
      const summary = q.status === "RELATIONSHIP_RESOLVED"
        ? `relationship_status=RESOLVED source_capability_id=${q.source_capability_id} target_capability_id=${q.target_capability_id} relationship_id=${q.relationship_id} relationship_kind=${q.relationship_kind} lock_status=${q.lock_status} runtime_status=${q.runtime_status}`
        : `relationship_status=${q.status} source_mention=${q.source_mention} target_mention=${q.target_mention}`;
      return terminal(envelope, "owner-backbone", q.status === "RELATIONSHIP_RESOLVED" ? "COMPLETED" : "BLOCKED", summary, evidenceRows, [], q.status === "RELATIONSHIP_RESOLVED" ? null : "BOUNDED_RELATIONSHIP_VERIFIER_REQUIRED");
    }

    const proven = provenCapabilityIdsFromContext(envelope.payload);

    if (proven.length > 1) {
      // resolver พิสูจน์ได้มากกว่าหนึ่ง = กำกวมจริง ไม่ใช่เรื่องที่ router จะเดา
      // ใช้สถานะ OWNER_REVIEW ที่มีอยู่แล้ว ไม่ได้สร้างสถานะใหม่
      return terminal(envelope, "router", "OWNER_REVIEW",
        `structured_owner_context proved ${proven.length} capabilities for this command — router refuses to guess`,
        [evidence("router", `routing_source=STRUCTURED_OWNER_CONTEXT candidates=${proven.join(",")}`)], [],
        "Owner must pick one candidate capability explicitly");
    }

    if (proven.length === 1) {
      routingSource = "STRUCTURED_OWNER_CONTEXT";
      const ignoredEngineering = isBusinessCapabilityId(proven[0]) && readEngineeringCodingIntent(envelope.payload)
        ? " engineering_coding_intent ignored — Business Runtime has zero source-write authority"
        : "";
      routingNote = `selected_capability_id=${proven[0]} proven by control/owner-command-semantics (status=RESOLVER_MATCHED, evidence present, id exists in ./capability-registry.ts)${ignoredEngineering}`;
      steps = [{ capability_id: proven[0], intent: envelope.intent, payload: envelope.payload }];
    } else {
      // ยังไม่มี target ที่ resolve ได้ — คงพฤติกรรมเดิมไว้ แต่ต้องติดป้ายว่า
      // เส้นทางนี้ตัดสินจากข้อความดิบ ไม่ใช่จากสิ่งที่พิสูจน์แล้ว
      routingSource = "FALLBACK_RAW_TEXT";
      const classification: ClassificationOutcome = classifyCommand(commandText);
      if (classification.status === "OWNER_REVIEW") {
        return terminal(envelope, "router", "OWNER_REVIEW", classification.reason, [evidence("router", `routing_source=FALLBACK_RAW_TEXT candidates=${classification.candidates.join(",")}`)], [], "Owner must pick one candidate capability explicitly");
      }
      if (classification.status === "UNSUPPORTED_COMMAND") {
        if (readEngineeringCodingIntent(envelope.payload)) {
          routingSource = "STRUCTURED_OWNER_CONTEXT";
          routingNote = "engineering_coding_intent present; no Business capability matched — ENGINEERING coding path";
          steps = [{ capability_id: "engineering-runtime", intent: envelope.intent, payload: envelope.payload }];
        } else {
          return terminal(envelope, "router", "FAILED", classification.reason, [evidence("router", "routing_source=FALLBACK_RAW_TEXT UNSUPPORTED_COMMAND")], [], "UNSUPPORTED_COMMAND");
        }
      } else {
        const ignoredEngineering = isBusinessCapabilityId(classification.capability.capability_id) && readEngineeringCodingIntent(envelope.payload)
          ? " engineering_coding_intent ignored — Business Runtime has zero source-write authority"
          : "";
        routingNote = `selected_capability_id=${classification.capability.capability_id} matched by match_keyword_sets on raw commandText — no proven capability was present in structured_owner_context${ignoredEngineering}`;
        steps = [{ capability_id: classification.capability.capability_id, intent: envelope.intent, payload: envelope.payload }];
      }
    }
  }

  const allEvidence: CapabilityResultEvidence[] = [
    evidence("control/command-router/router.ts#routeOwnerCommand", `routing_source=${routingSource} ${routingNote}`),
  ];
  const allArtifacts: CapabilityResultArtifact[] = [];
  const allWarnings: string[] = [];
  let lastCapabilityId = "router";
  let lastStatus: CapabilityResultStatus = "PENDING";
  let lastSummary = "no step executed";
  // คำถาม/สิ่งที่ต้องทำต่อที่ step เป็นคนบอก — ถ้า step ไม่ได้บอก ค่อยใช้ค่าที่สรุปจากสถานะ
  let lastNextAction: string | null | undefined;

  for (const step of steps) {
    const outcome = await runStep(step, envelope, options);
    allEvidence.push(...outcome.evidenceEntries);
    allArtifacts.push(...outcome.artifacts);
    allWarnings.push(...outcome.warnings);
    lastCapabilityId = step.capability_id;
    lastStatus = outcome.status;
    lastSummary = outcome.summary;
    if (outcome.nextAction !== undefined) lastNextAction = outcome.nextAction;

    if (outcome.status !== "COMPLETED") {
      // Multi-worker sequence stops here — Owner sees this one outcome, never a partial list of sub-steps.
      break;
    }
  }

  return admitAndBuildResult(
    envelope,
    lastCapabilityId,
    lastStatus,
    steps.length > 1 ? `${steps.length}-step command finished at "${lastCapabilityId}": ${lastSummary}` : lastSummary,
    allEvidence,
    allArtifacts,
    allWarnings,
    lastNextAction ?? (lastStatus === "COMPLETED" ? null : lastStatus === "OWNER_REVIEW" ? "OWNER_REVIEW" : lastStatus === "BLOCKED" ? "BLOCKED" : "RETRY_OR_ESCALATE"),
    options.parentTaskId ?? null,
  );
}
