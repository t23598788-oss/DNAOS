/**
 * หน้าที่: the Authority Router (Owner, "Authority Assembly Phase 1F").
 * The ONE place a `RequestedAction` (an Agent's DATA, never authority)
 * is resolved to a real executor — or refused, with NO fallback, when
 * none is registered. Reuses the EXISTING chain every real file-write
 * path in this repo already uses
 * (`control/ai-write-control/contract.ts#submitWriteRequest` ->
 * `permissions/write-gate/contract.ts#evaluateWriteIntent` ->
 * `execution/file-write/contract.ts#executeFileWrite`) for
 * FILE_CREATE/FILE_MODIFY — no new write mechanism, no new gate.
 *
 * Input: a `RequestedAction` + the artifact's real content (read from the
 * Agent's own workspace, never trusted as already-approved).
 * Output: `AuthorityRouterOutcome` — `EXECUTED` (real write happened,
 * through the real gate), `DENIED` (gate refused), or
 * `EXECUTOR_NOT_AVAILABLE` (no registered executor for this operation —
 * the ONLY response for every operation this phase does not build).
 * Dependency ที่อนุญาต: ./agent-execution-contract.ts,
 * ../ai-write-control/contract.ts, ../../permissions/write-gate/contract.ts,
 * ../../execution/file-write/contract.ts,
 * ../../software/capability-registrar/contract.ts.
 * สิ่งที่ห้ามแตะ: never add a branch that performs a real GIT/GITHUB/
 * SUPABASE/VERCEL/PACKAGE/CREDENTIAL/APPLE_EVENT/NETWORK/PROCESS_EXECUTE
 * operation this phase did not build a real executor for — those must
 * return EXECUTOR_NOT_AVAILABLE, never a silent shell/CLI fallback.
 */

import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { submitWriteRequest } from "../ai-write-control/contract";
import { evaluateWriteIntent } from "../../permissions/write-gate/contract";
import { executeFileWrite } from "../../execution/file-write/contract";
import type { RequestedAction, RequestedActionOperation } from "./agent-execution-contract";
import { ERROR_CODES } from "./agent-execution-contract";
import { macLocalAgentExecutionDecision } from "../../contracts/architecture/runtime-node-and-optional-provider";
import type { TaskWorkspace } from "./workspace-manager";
import type { AgentExecutionOrigin } from "./agent-host-dispatch";

/**
 * The admitted-execution context every caller MUST supply (Owner,
 * "PHASE 0 DECISION = APPROVED WITH CONSTRAINTS"). Composed ONLY of
 * types this repo already defines — no new identity vocabulary was
 * invented here:
 *   `workspace`  real `TaskWorkspace` from
 *                ./workspace-manager.ts#createTaskWorkspace. Carries the
 *                artifact confinement boundary (`allowed_write_workspace`),
 *                `work_order_id`, `command_id`, and `workspace_id` — the
 *                per-run allocation id. NOTE: this repo has NO
 *                `agent_run_id` field anywhere; `workspace_id` is the
 *                closest existing per-agent-run identifier and is used as
 *                such rather than minting a new one.
 *   `origin`     real `AgentExecutionOrigin` from ./agent-host-dispatch.ts.
 *                Carries task identity for ADMITTED_TASK execution.
 *   `authorization_reference`
 *                the SAME field name/shape as
 *                `DnaOsAgentInput.authorization_reference` — the task
 *                authorization evidence id, `null` when not measured.
 * This parameter is REQUIRED, not optional: an optional context would let
 * a caller silently skip artifact confinement.
 */
export interface RequestedActionContext {
  workspace: TaskWorkspace;
  origin: AgentExecutionOrigin;
  authorization_reference: string | null;
}

/** Every way an untrusted `artifact_ref` can point outside the Agent's own workspace. */
export type ArtifactEscapeClass =
  | "ABSOLUTE_OUTSIDE_WORKSPACE"
  | "RELATIVE_TRAVERSAL_ESCAPE"
  | "SYMLINK_ESCAPE"
  | "WORKSPACE_UNRESOLVABLE"
  | "ARTIFACT_UNRESOLVABLE";

export type ArtifactResolution =
  | { ok: true; resolved_path: string; workspace_real: string }
  | { ok: false; escape_class: ArtifactEscapeClass; detail: string };

/**
 * `artifact_ref` is UNTRUSTED INPUT (Owner). Containment is decided on
 * CANONICAL paths only — both sides go through `realpathSync`, so a
 * symlink inside the workspace pointing at the canonical target (or at
 * anything else outside) resolves to its real location and fails
 * containment like any other outside path. A relative ref is resolved
 * against the workspace, never against process cwd.
 */
export function resolveArtifactWithinWorkspace(artifact_ref: string, allowed_write_workspace: string): ArtifactResolution {
  const raw = artifact_ref.startsWith("artifact://") ? artifact_ref.slice("artifact://".length) : artifact_ref;

  let workspaceReal: string;
  try {
    workspaceReal = realpathSync(allowed_write_workspace);
  } catch (error) {
    return { ok: false, escape_class: "WORKSPACE_UNRESOLVABLE", detail: `allowed_write_workspace "${allowed_write_workspace}" does not resolve: ${error instanceof Error ? error.message : String(error)}` };
  }

  const lexical = isAbsolute(raw) ? resolve(raw) : resolve(workspaceReal, raw);

  let artifactReal: string;
  try {
    artifactReal = realpathSync(lexical);
  } catch (error) {
    return { ok: false, escape_class: "ARTIFACT_UNRESOLVABLE", detail: `artifact_ref "${artifact_ref}" does not resolve to a real path: ${error instanceof Error ? error.message : String(error)}` };
  }

  const rel = relative(workspaceReal, artifactReal);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    const lexicalRel = relative(workspaceReal, lexical);
    const escape_class: ArtifactEscapeClass = isAbsolute(raw)
      ? "ABSOLUTE_OUTSIDE_WORKSPACE"
      : lexicalRel.startsWith("..") || isAbsolute(lexicalRel)
        ? "RELATIVE_TRAVERSAL_ESCAPE"
        : "SYMLINK_ESCAPE";
    return { ok: false, escape_class, detail: `artifact realpath "${artifactReal}" is not contained in workspace realpath "${workspaceReal}"` };
  }
  return { ok: true, resolved_path: artifactReal, workspace_real: workspaceReal };
}

export type AuthorityRouterOutcome =
  | { status: "EXECUTED"; operation: RequestedActionOperation; detail: unknown }
  | { status: "DENIED"; operation: RequestedActionOperation; reason: string }
  | { status: "EXECUTOR_NOT_AVAILABLE"; operation: RequestedActionOperation; reason: string };

/**
 * Operations with a REAL registered executor today — additive only.
 * Every other `RequestedActionOperation` falls through to
 * EXECUTOR_NOT_AVAILABLE, with no fallback path of any kind.
 */
export const EXECUTOR_REGISTRY: Readonly<Record<RequestedActionOperation, boolean>> = {
  FILE_CREATE: true,
  FILE_MODIFY: true,
  FILE_DELETE: false,
  FILE_MOVE: false,
  PROCESS_EXECUTE: false,
  GIT_OPERATION: false,
  GITHUB_OPERATION: false,
  PACKAGE_OPERATION: false,
  CREDENTIAL_OPERATION: false,
  SUPABASE_OPERATION: false,
  VERCEL_OPERATION: false,
  NETWORK_OPERATION: false,
  // ── BIND_AGENT_TO_DNA_OS_OWNED_OS_UI_RESOURCE (Owner, 2026-08-31) ──
  // เลนนี้เปิดแล้ว แต่ผู้ลงมือยังเป็น `connections/os-ui/` ตัวเดิมทั้งหมด
  // Agent ไม่ได้ถือสิทธิ์ ไม่ได้เรียก macOS เอง และไม่ได้ตัดสินความเสี่ยงของตัวเอง
  APPLE_EVENT_OPERATION: true,
};

/**
 * ชนิดการกระทำที่ Agent ขอผ่านเลนนี้ได้ — อ่านและนำเสนอเท่านั้น
 *
 * `click`/`type`/`key` เปลี่ยนสภาพหน้าจอโดยตรง ยังไม่เปิดให้ Agent ขอในรอบนี้
 * ตามขอบเขตที่ Owner กำหนด การเปิดเพิ่มต้องเป็นคำตัดสินของ Owner ไม่ใช่ผลข้างเคียง
 * ของการที่ `connections/os-ui/` รองรับมันอยู่แล้ว
 */
const AGENT_REQUESTABLE_UI_ACTIONS: ReadonlySet<string> = new Set([
  "open_app", "open_url", "focus", "read_screen", "screenshot", "wait",
]);

/** ชนิดที่ต้องระบุแอปเป้าหมาย เพราะ os-ui เดินผ่าน macOS Accessibility */
const UI_ACTIONS_REQUIRING_APP: ReadonlySet<string> = new Set(["focus", "click", "type", "key"]);

/** ขอบเขตที่ประกาศให้ os-ui ตรวจ — เป็นคำอ้างที่ถูกตรวจ ไม่ใช่คำอ้างที่ถูกเชื่อ */
function declaredScopeFor(uiAction: string): string {
  if (uiAction === "open_url") return "https-url";
  if (uiAction === "open_path") return "repo-path";
  if (uiAction === "read_screen" || uiAction === "screenshot") return "screen";
  return "known-app";
}

interface FileWriteExecutionInput {
  action: RequestedAction;
  context: RequestedActionContext;
  requestingIdentity: { identity_id: string; acting_as_account_id: string; acting_as_tenant_id: string; software_id: string; kind: "ai_agent" };
}

/**
 * Upstream identity written into the EXISTING `WriteIntent.evidence[]`
 * (`{source, note}`) — a field this router previously left empty. This is
 * HUMAN_TRACEABLE ONLY: `WriteIntentEvidenceRef` has no typed id field, so
 * recovering `task_id`/`work_order_id`/`workspace_id` from it would mean
 * parsing free text. It is therefore NOT machine-reconstructable lineage
 * and is never reported as such. No schema field was added.
 */
function buildUpstreamEvidence(context: RequestedActionContext): readonly { source: string; note: string }[] {
  const taskIdentity = context.origin.kind === "ADMITTED_TASK" ? `task_id=${context.origin.task_id} command_id=${context.origin.command_id}` : `DIRECT correlation_id=${context.origin.correlation_id}`;
  return [
    { source: "control/agent-gateway/agent-authority-router.ts#routeRequestedAction", note: `${taskIdentity} work_order_id=${context.workspace.work_order_id} workspace_id=${context.workspace.workspace_id} (human-readable only — not a machine lineage link)` },
    { source: "control/agent-gateway/agent-execution-contract.ts#authorization_reference", note: context.authorization_reference ?? "NOT_MEASURED" },
  ];
}

/** Reuses control/agent-gateway/adapters/ai-write-adapter.ts's exact same chain — no reimplementation. */
async function executeFileWriteAction(input: FileWriteExecutionInput): Promise<AuthorityRouterOutcome> {
  const { action, context, requestingIdentity } = input;

  const resolved = resolveArtifactWithinWorkspace(action.artifact_ref, context.workspace.allowed_write_workspace);
  if (!resolved.ok) {
    return { status: "DENIED", operation: action.operation, reason: `ARTIFACT_OUTSIDE_WORKSPACE:${resolved.escape_class}: ${resolved.detail}` };
  }

  let content: string;
  try {
    content = readFileSync(resolved.resolved_path, "utf-8");
  } catch (error) {
    return { status: "DENIED", operation: action.operation, reason: `ARTIFACT_UNREADABLE: ${error instanceof Error ? error.message : String(error)}` };
  }

  const intentResult = submitWriteRequest(
    { operation: action.operation === "FILE_CREATE" ? "CREATE" : "MODIFY", capability: "agent_requested_action", target_type: "FILE", target_path: action.target, requested_change: `Requested by Agent Host dispatch, operation=${action.operation}`, evidence: buildUpstreamEvidence(context) },
    requestingIdentity,
  );
  if (!intentResult.ok) return { status: "DENIED", operation: action.operation, reason: `INTENT_REJECTED:${intentResult.reason}` };

  const { getWriteOwnershipIndex } = await import("../../software/capability-registrar/contract");
  const decision = evaluateWriteIntent(intentResult.intent, { registryIndex: getWriteOwnershipIndex() });
  if (decision.decision !== "ALLOW_CREATE" && decision.decision !== "ALLOW_MODIFY") {
    return { status: "DENIED", operation: action.operation, reason: `WRITE_GATE_${decision.decision}` };
  }

  const write = executeFileWrite(
    { correlation_id: intentResult.intent.correlation_id, intent_id: intentResult.intent.intent_id, gate_decision_id: decision.decision_id, operation: intentResult.intent.operation, target_type: "FILE", target_path: action.target, content, requesting_identity_id: requestingIdentity.identity_id },
    decision,
  );
  if (write.status !== "completed") return { status: "DENIED", operation: action.operation, reason: `WRITE_${write.refusal_code}` };
  return { status: "EXECUTED", operation: action.operation, detail: { write_id: write.write_id, resolved_path: write.resolved_path, bytes_written: write.bytes_written } };
}

/**
 * Agent ขอใช้ทรัพยากร OS/UI — DNA OS เป็นผู้ลงมือ ไม่ใช่ Agent
 *
 * ── ทำไมไม่ให้ Agent เรียก os-ui เอง ──
 * ถ้า Agent เรียก `runUiWorkOrder` ตรง ๆ มันจะเป็นผู้ประกอบ Work Order เอง
 * แปลว่ามันเลือกขอบเขต เลือกความเสี่ยง และยืนยันความเสี่ยงให้ตัวเอง ฟังก์ชันนี้
 * จึงรับจาก Agent แค่ "การกระทำ" กับ "เป้าหมาย" แล้ว **DNA OS ประกอบ Work Order
 * เอง** ทุกช่องที่เป็นอำนาจถูกกำหนดที่นี่ ไม่ใช่ที่ผู้ขอ
 *
 * ── ความเสี่ยงยืนยันโดยสายอำนาจ ไม่ใช่โดยผู้ขอ ──
 * `risk_confirmed` มาจากการที่งานนี้สืบกลับไปถึงคำสั่งของ Owner ได้จริง
 * (`origin.kind === "ADMITTED_TASK"` และมี `authorization_reference`) ไม่มีทางใด
 * ให้ Agent ตั้งค่านี้เอง
 *
 * ── ไม่มีท่อขนาน ──
 * ปลายทางคือ `connections/os-ui/adapter-contract.ts#runUiWorkOrder` ตัวเดิมที่
 * `control/command-router/router.ts` ใช้อยู่ — admission / allowlist / risk gate /
 * audit ชุดเดียวกัน ไม่มีการสร้าง implementation ที่สองของการควบคุมหน้าจอ
 */
async function executeAppleEventAction(action: RequestedAction, context: RequestedActionContext): Promise<AuthorityRouterOutcome> {
  const uiAction = action.artifact_ref;
  if (!AGENT_REQUESTABLE_UI_ACTIONS.has(uiAction)) {
    return { status: "DENIED", operation: action.operation, reason: `UI_ACTION_NOT_OPEN_TO_AGENT_LANE:${uiAction}` };
  }

  const ownerAuthorized = context.origin.kind === "ADMITTED_TASK" && context.authorization_reference !== null;

  const node = macLocalAgentExecutionDecision({ current_node: "CORE_NODE" });
  if (!node.execute) {
    return {
      status: "DENIED",
      operation: action.operation,
      reason: `${node.reason_code}: required_node=${node.required_node} current_node=${node.current_node} execution_attempted=${String(node.execution_attempted)}`,
    };
  }

  const { runUiWorkOrder } = await import("../../connections/os-ui/adapter-contract");
  const order = {
    ui_action: uiAction,
    target: action.target,
    scope: declaredScopeFor(uiAction),
    timeout_ms: 10_000,
    dry_run: false,
    risk_confirmed: ownerAuthorized,
    ...(UI_ACTIONS_REQUIRING_APP.has(uiAction) ? { app: action.target } : {}),
  };

  const outcome = await runUiWorkOrder(order as never);
  if (outcome.status === "COMPLETED") {
    return {
      status: "EXECUTED", operation: action.operation,
      detail: {
        ui_action: uiAction, target: action.target, os_ui_status: outcome.status,
        owner_authorized: ownerAuthorized, evidence: outcome.evidence,
        artifacts: outcome.artifacts, presentation: outcome.presentation,
      },
    };
  }
  return { status: "DENIED", operation: action.operation, reason: `OS_UI_${outcome.status}: ${outcome.summary}` };
}

/**
 * The single entry point: requested_action -> policy -> permission ->
 * write gate (if state-changing) -> executor registry -> executor ->
 * result. No caller may bypass this function to perform a
 * RequestedAction directly.
 */
export async function routeRequestedAction(action: RequestedAction, context: RequestedActionContext): Promise<AuthorityRouterOutcome> {
  if (!EXECUTOR_REGISTRY[action.operation]) {
    return { status: "EXECUTOR_NOT_AVAILABLE", operation: action.operation, reason: `${ERROR_CODES.EXECUTOR_NOT_AVAILABLE}: no registered executor for operation "${action.operation}" — no fallback to shell/CLI/raw tool exists or will be used` };
  }
  if (action.operation === "FILE_CREATE" || action.operation === "FILE_MODIFY") {
    return executeFileWriteAction({
      action,
      context,
      requestingIdentity: { identity_id: "agent-gateway-authority-router", acting_as_account_id: "account-dna-os-infrastructure", acting_as_tenant_id: "tenant-dna-os-infrastructure", software_id: "dna-os-agent-gateway", kind: "ai_agent" },
    });
  }
  if (action.operation === "APPLE_EVENT_OPERATION") {
    return executeAppleEventAction(action, context);
  }
  return { status: "EXECUTOR_NOT_AVAILABLE", operation: action.operation, reason: `${ERROR_CODES.EXECUTOR_NOT_AVAILABLE}: registry inconsistency` };
}
