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
import { dispatchTask, DEFAULT_AGENT_WORKERS, setVoiceBridgeEnabled, isVoiceBridgeEnabled, admitCompletedTask } from "../agent-gateway/contract";
import type { Status as DispatcherTaskStatus } from "../agent-gateway/contract";
import { parseOsLoginTarget, requestOsLogin } from "../../connections/os-login/adapter-contract";
import { openOsUi, parseOsUiTarget, runUiWorkOrder } from "../../connections/os-ui/adapter-contract";
import type { UiWorkOrder } from "../../connections/os-ui/work-order";
import { getCapability, listCapabilities } from "./capability-registry";
import { hostNowIso } from "./host-runtime";
import { reportJoint } from "../../observability/joint-monitor/contract";
import { executeConnectorCommand } from "../connector-execution-boundary/contract";
import type { CapabilityRegistration, ClassificationOutcome, RouterStep } from "./types";

export interface RouteOptions {
  /** Explicit multi-worker plan, executed in order. Omit to let the router classify `commandText` into exactly one step from `envelope.intent`/`envelope.payload`. */
  steps?: readonly RouterStep[];
  /** Required only when a step targets a capability whose registry entry has `permission_requirement: "execution-policy"`. Resolved by the caller (matches ../../permissions/execution-policy/types.ts's own stated boundary — this module never resolves identity/membership/grants itself). */
  executionPolicyContext?: ExecutionPolicyContext;
  /** Base fields (identity/account/workspace/cwd_scope) an execution-requiring step's permission request is built from. Required together with executionPolicyContext. */
  executionRequestBase?: Pick<ExecutionPermissionRequest, "identity_id" | "account_id" | "workspace_id" | "cwd_scope">;
}

function matchesText(cap: CapabilityRegistration, text: string): boolean {
  const normalized = text.toLocaleLowerCase();
  return cap.match_keyword_sets.some((set) => set.every((keyword) => normalized.includes(keyword.toLocaleLowerCase())));
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
): CapabilityResult {
  // Same rule as ./output-classifier.ts's classifyOutput: "dispatcher" is
  // the one capability_id that actually hands work to a real AgentAdapter
  // — this outer, router-level task record carries the same lane that
  // function would derive from the CapabilityResult below, so a single
  // command never disagrees with itself about which lane it's in.
  const task = admitCompletedTask({
    intent_text: envelope.intent,
    memory: { user_id: envelope.issued_by.identity_id, workspace_id: envelope.issued_by.acting_as_account_id, conversation_id: envelope.command_id, parent_task_id: null },
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

interface StepOutcome {
  status: CapabilityResultStatus;
  evidenceEntries: CapabilityResultEvidence[];
  artifacts: CapabilityResultArtifact[];
  warnings: string[];
  summary: string;
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
  if (options.steps && options.steps.length > 0) {
    steps = options.steps;
  } else {
    const classification: ClassificationOutcome = classifyCommand(commandText);
    if (classification.status === "OWNER_REVIEW") {
      return terminal(envelope, "router", "OWNER_REVIEW", classification.reason, [evidence("router", `candidates=${classification.candidates.join(",")}`)], [], "Owner must pick one candidate capability explicitly");
    }
    if (classification.status === "UNSUPPORTED_COMMAND") {
      return terminal(envelope, "router", "FAILED", classification.reason, [evidence("router", "UNSUPPORTED_COMMAND")], [], "UNSUPPORTED_COMMAND");
    }
    steps = [{ capability_id: classification.capability.capability_id, intent: envelope.intent, payload: envelope.payload }];
  }

  const allEvidence: CapabilityResultEvidence[] = [];
  const allArtifacts: CapabilityResultArtifact[] = [];
  const allWarnings: string[] = [];
  let lastCapabilityId = "router";
  let lastStatus: CapabilityResultStatus = "PENDING";
  let lastSummary = "no step executed";

  for (const step of steps) {
    const outcome = await runStep(step, envelope, options);
    allEvidence.push(...outcome.evidenceEntries);
    allArtifacts.push(...outcome.artifacts);
    allWarnings.push(...outcome.warnings);
    lastCapabilityId = step.capability_id;
    lastStatus = outcome.status;
    lastSummary = outcome.summary;

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
    lastStatus === "COMPLETED" ? null : lastStatus === "OWNER_REVIEW" ? "OWNER_REVIEW" : lastStatus === "BLOCKED" ? "BLOCKED" : "RETRY_OR_ESCALATE",
  );
}
