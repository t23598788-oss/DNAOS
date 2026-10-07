/**
 * หน้าที่: the first real runtime transport for `control/owner-command/`
 * (its own contract.ts has said "NOT_YET_BUILT: no runtime transport
 * wires Owner input into this yet" until now). A local, loopback-only
 * HTTP server so an external process (the Dead Board Next.js app, a
 * separate repo/process) can drive the real
 * OWNER → owner-command → command-router → policy pipeline over the
 * network instead of importing this repo's TypeScript directly across a
 * repo boundary.
 *
 * Scope: the same command line also accepts an explicit sandbox Work Order.
 * It still goes through the existing owner-command -> command-router ->
 * dispatcher path; admission, validator, policy, worker and evidence stay
 * in their existing contracts. No direct file operation is exposed here.
 *
 * Identity (2026-08-20 fix — Owner Work Order: "login... แยกกันจนไม่เชื่อม
 * วงจร"): the Account/Workspace/execution-grant scope is still one fixed,
 * real, in-memory registration (single-owner dev phase, unchanged) — but
 * WHO is attributed as the issuer is no longer a hardcoded placeholder.
 * dna-os-deadboard's own `app/api/infra-command/route.ts` already calls
 * `requireAuth(ADMIN_TIER)` — a REAL Supabase JWT verification — before it
 * ever reaches this server; it forwards that already-verified user's
 * `id`/`email` as `ownerIdentity`. This server uses that only to LABEL the
 * `EnvelopeIdentity.identity_id` for evidence/audit (so a command's
 * evidence trail shows the real signed-in person, not a generic
 * placeholder) — it is never trusted for authorization: grants/permission
 * scope still come from the one already-provisioned Account/Workspace
 * below, so a caller cannot use this field to claim more access than the
 * fixed single-owner grant already allows. No credential, token, or
 * password is ever read, stored, or forwarded — `ownerIdentity` carries
 * only a user id and email, exactly what `requireAuth` already exposed.
 * If `ownerIdentity` is absent (e.g. a direct loopback call with no
 * upstream auth), the prior fixed placeholder identity is still used —
 * same real-store registration pattern
 * ../../control/owner-command/tests/owner-command.test.ts already uses,
 * never a hand-built literal passed around unregistered.
 *
 * Input: HTTP POST /command { commandText: string, workOrder?: WorkOrder, idempotencyKey?: string, ownerIdentity?: { id: string, email: string } }.
 * Output: HTTP 200 JSON { envelope, lifecycle, result, surface, rendered }
 * mirroring `SubmitOwnerCommandOutcome`; GET /health for liveness.
 * Dependency ที่อนุญาต: ../../control/owner-command/contract.ts,
 * ../../contracts/identity/envelope-identity.ts,
 * ../../permissions/access-control/*-registry.ts,
 * ../../permissions/software-scope/*-registry.ts. Node's built-in `http`
 * only — no framework, no new dependency.
 * สิ่งที่ห้ามแตะ: this server performs no request authentication of its
 * own (see the identity note above — auth happens in the external
 * caller). Never give this a PUBLIC Railway domain / public internet
 * exposure without adding real request auth here first (2026-08-24,
 * migration hardening — verified live, this file had zero auth). Binding
 * host is env-driven (`HOST`, default `127.0.0.1`) so this can run inside
 * a Railway container (which requires binding wider than loopback to be
 * reachable even over Railway's *private* network) — but "reachable on
 * Railway's private network" and "reachable from the public internet" are
 * different things; only the former is authorized here. The Work Order is
 * handed to the existing router/dispatcher; this transport never executes
 * it directly.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { decideContinuation, deriveLifecycle } from "../../control/operational-lifecycle/contract";
import { readRuntimeRevision } from "../../control/runtime-revision/contract";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { verifySharedSecret, evaluateBindPolicy } from "../../permissions/network-auth-gate/contract";
import type { EnvelopeIdentity } from "../../contracts/identity/envelope-identity";
import { languageEventsSince, onLanguageStage, publishLanguageStage } from "../../control/owner-command-semantics/contract";
import { spawnConversationRuntime, composeOwnerAskHttpBody, latestOwnerResponse, peekOwnerResponse, presentOwnerResponse, type ConversationRuntimeHandle, type ConversationResult } from "../../control/conversation-runtime/contract";
import { ingestCommandEnvelope, newEnvelopeId } from "../../control/owner-command/input-gateway";
import { registerIdentity } from "../../permissions/access-control/identity-registry";
import { grantMembership, listMembershipsForIdentity } from "../../permissions/access-control/membership-registry";
import { getIdentityRegistration } from "../../permissions/access-control/identity-registry";
import { registerAccount } from "../../permissions/software-scope/account-registry";
import { registerWorkspace } from "../../permissions/software-scope/workspace-registry";
import { issueExecutionGrant, listExecutionGrantsForIdentity } from "../../permissions/execution-policy/contract";
import type { ExecutionPolicyContext } from "../../permissions/execution-policy/contract";
import { DEFAULT_AGENT_WORKERS, startAgentGatewaySupervisor, getTask, getResult, explain, loadAllHandoffs, loadHandoffsForTask } from "../../control/agent-gateway/contract";
import type { WorkOrder } from "../../control/agent-gateway/types";
import type { UiWorkOrder } from "../../connections/os-ui/work-order";
import { listCapabilities } from "../../control/command-router/capability-registry";
import { classifyCommand, type RouteOptions } from "../../control/command-router/contract";
import { resolveGoogleWorkspaceReadIntentFromText } from "../../connections/google-workspace/owner-text-intent";
import { parseSheetsOwnerText } from "../../connections/google-workspace/sheets-owner-text";
import {
  CALENDAR_SERVICE_ID,
  DRIVE_SERVICE_ID,
  GMAIL_SERVICE_ID,
  SHEETS_SERVICE_ID,
} from "../../connections/google-workspace/contract";
import { issueOwnerCapabilityBindingPolicy, matchingCapabilityBindingPolicy } from "../../control/local-resource-access/contract";
import { startJointEventBridge } from "../../observability/joint-monitor/contract";
import { startWriteFailureBridge, AUTOMATIC_AGENT_DISPATCH_ENABLED } from "../../control/write-failure-bridge/contract";
import { intakeEvent } from "../../control/owner-backbone/contract";
import { issueBootstrapChallenge, completeBootstrapProbe } from "../../connections/agent-registry/worker-registration";
import type { RegistrationCandidate } from "../../control/event-pipeline/contract";
import { runRegistrationPipeline } from "../../control/registration-pipeline/contract";
import { handleComputerUseApi } from "./computer-use-api";
import { coreNodeUnavailableForCapability } from "./mac-local-agent-gate";
import { listOwnerSessions, validateOwnerSession } from "../../control/owner-authentication/contract";
import { applyMutation } from "../../control/registration-update/contract";
import { ingestWorkResult } from "../../control/work-result-ingress/contract";
import type { WorkResultInput } from "../../control/work-result-ingress/contract";
import { createPersistentFileStore } from "../../software/registry-database/adapters/persistent-file-store";
import { findCapability, findResourceById } from "../../software/registry-database/contract";
import { handleOwnerBackboneRoute } from "./owner-backbone-routes";
import { handleOwnerCredentialRoute } from "./owner-credential-routes";
import { handleGoogleOauthRoute, renderGoogleOauthHtml } from "./google-oauth-routes";
import { handleGoogleOauthClientAdmissionRoute } from "./google-oauth-client-admission-routes";
import { handleGoogleOauthDiscoveryRoute } from "./google-oauth-discovery-routes";
import { runPreExecutionPlan, latestPlanFor, latestPlan } from "../../control/pre-execution-planner/contract";
import { executeLocalRead } from "../../control/owner-command/local-read-operations";
import { resolveAndExecuteOwnerIntent, resolveAndExecuteOwnerRequest } from "../../control/owner-command/structured-intent";
import { findOpenOwnerQuestion, previewOwnerCommand, submitOwnerCommand, lineageForCommand } from "../../control/owner-command/contract";
import { resolveEntryContext } from "../../control/entry-context/contract";
import { readEngineeringCodingIntent } from "../../control/engineering-runtime/contract";
import { readHistoryForIdentity } from "../../control/owner-command-semantics/contract";
import { resolutionFor } from "../../control/resource-selection/contract";
import { listReservations } from "../../control/source-workspace/contract";
import { ownerDecision, loadAllEvidence } from "../../control/agent-gateway/contract";
import { projectOwnerDisplayPayload } from "../../control/owner-projection/display-payload";
import { projectOwnerActivity } from "../../control/event-pipeline/contract";
import { readHistoryForCommand, readTaskState } from "../../control/owner-command-semantics/contract";
import type { HistoryRecord } from "../../control/owner-command-semantics/contract";
import { currentStateProjection } from "../../control/work-session-state/contract";
import { listConnectionDeclarations } from "../../connections/connection-registry/declaration-registry";
import { providerMetadataFor } from "../../connections/connection-registry/provider-metadata";
import { resolveProviderBrandAsset } from "../../connections/connection-registry/brand-asset-resolver";
import type { ConnectionDeclaration } from "../../contracts/connector/connection-declaration";
import type { CapabilityLookupResult, CapabilityRow, EvidenceRow, RelationshipRow, ResourceRow } from "../../software/registry-database/types";

const IDENTITY_ID = "identity-deadboard-owner";
const ACCOUNT_ID = "account-deadboard-owner";
const WORKSPACE_ID = "workspace-deadboard-owner";
const registrationStore = createPersistentFileStore();

/**
 * FLIP_PRODUCTION_OWNER_CONVERSATION_TO_ISOLATED_RUNTIME (Owner UNLOCK,
 * 2026-09-06). This process no longer calls `translateOwnerMessage`/
 * `resolveOwnerCommandSemantics` in-process — both real call sites
 * (`respondWithChatIntake`, `GET /owner/language`) below go through this
 * handle instead. `registrationStore` (above) is never handed across that
 * boundary; only plain JSON (`ConversationRequest`) crosses.
 *
 * Lazily (re)spawned: a request that finds the child dead (crashed, never
 * started) triggers exactly one respawn attempt before failing closed —
 * this file never falls back to calling the semantics layer directly.
 */
/** Process start clock for /health runtime_instance — operational observability only. */
const PROCESS_STARTED_AT = new Date().toISOString();

function readConversationRuntimeBuildIdentity(): {
  artifact_path: string | null;
  artifact_bytes: number | null;
  artifact_mtime: string | null;
  build_id: string | null;
  build_hash: string | null;
  build_time: string | null;
  build_from_commit: string | null;
  build_from_commit_dirty: boolean | null;
  branch: string | null;
  local_worktree: string | null;
  stale_runtime_build: boolean;
  stale_reason: string | null;
} {
  const artifactPath = join(process.cwd(), "control/conversation-runtime/dist/control/conversation-runtime/main.js");
  const manifestPath = join(process.cwd(), "control/conversation-runtime/dist/build-manifest.json");
  let artifact_bytes: number | null = null;
  let artifact_mtime: string | null = null;
  let artifact_path: string | null = null;
  if (existsSync(artifactPath)) {
    const st = statSync(artifactPath);
    artifact_path = artifactPath;
    artifact_bytes = st.size;
    artifact_mtime = st.mtime.toISOString();
  }
  let build_id: string | null = null;
  let build_hash: string | null = null;
  let build_time: string | null = null;
  let build_from_commit: string | null = null;
  let build_from_commit_dirty: boolean | null = null;
  let branch: string | null = null;
  let local_worktree: string | null = null;
  if (existsSync(manifestPath)) {
    try {
      const m = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
      build_id = typeof m.BUILD_ID === "string" ? m.BUILD_ID : null;
      build_hash = typeof m.BUILD_HASH === "string" ? m.BUILD_HASH : null;
      build_time = typeof m.BUILD_TIME === "string" ? m.BUILD_TIME : null;
      build_from_commit = typeof m.BUILD_FROM_COMMIT === "string" ? m.BUILD_FROM_COMMIT : null;
      build_from_commit_dirty = typeof m.BUILD_FROM_COMMIT_DIRTY === "boolean" ? m.BUILD_FROM_COMMIT_DIRTY : null;
      branch = typeof m.BRANCH === "string" ? m.BRANCH : null;
      local_worktree = typeof m.LOCAL_WORKTREE === "string" ? m.LOCAL_WORKTREE : null;
    } catch {
      /* leave nulls — never invent */
    }
  }
  const source = readRuntimeRevision();
  let stale_runtime_build = false;
  let stale_reason: string | null = null;
  if (!artifact_path || !artifact_bytes) {
    stale_runtime_build = true;
    stale_reason = "CONVERSATION_RUNTIME_ARTIFACT_MISSING";
  } else if (!build_from_commit) {
    stale_runtime_build = true;
    stale_reason = "BUILD_MANIFEST_MISSING_COMMIT";
  } else if (source.revision && build_from_commit !== source.revision) {
    stale_runtime_build = true;
    stale_reason = "STALE_RUNTIME_BUILD";
  }
  return {
    artifact_path,
    artifact_bytes,
    artifact_mtime,
    build_id,
    build_hash,
    build_time,
    build_from_commit,
    build_from_commit_dirty,
    branch,
    local_worktree,
    stale_runtime_build,
    stale_reason,
  };
}

let conversationRuntimeHandle: ConversationRuntimeHandle | null = null;
function conversationRuntime(): ConversationRuntimeHandle {
  if (!conversationRuntimeHandle || !conversationRuntimeHandle.isAlive()) {
    try {
      conversationRuntimeHandle = spawnConversationRuntime();
    } catch (error) {
      // Surface precise build/entrypoint failures (missing/empty/unreadable dist)
      // instead of a vague later timeout — still fail-closed, never in-process fallback.
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
  return conversationRuntimeHandle;
}

/**
 * Knowledge/fact-owner answers stay in the conversation runtime (Connection
 * Index, self-knowledge). Only a resolved executable Owner command is
 * forwarded through the existing MCP submit_command tool. This is not a
 * second MCP, classifier, or Thai-phrase table.
 *
 * CONVERSATION_RUNTIME_LIVE_IO_V1: when raw Owner text uniquely matches a
 * registered connector capability (e.g. google-workspace via "gmail"),
 * forward into the existing submitOwnerCommand path even if the conversation
 * layer also produced a read-only Connection Index answer — execution must
 * not be swallowed by self-knowledge.
 */
/**
 * Same connector-forward gate used by POST /chat. Exported so the Owner
 * language ingress can be proven to reuse it — not a second classifier.
 */
export function shouldForwardStructuredIntentToExistingMcp(
  result: ConversationResult,
  ownerPayload: Record<string, unknown> | null,
  commandText: string = "",
): boolean {
  if (readEngineeringCodingIntent(ownerPayload)) return true;
  if (commandText.trim().length > 0) {
    const classified = classifyCommand(commandText);
    if (classified.status === "MATCHED") {
      const id = classified.capability.capability_id;
      if (classified.capability.endpoint.kind === "connector" || id === "permission-reasoner") {
        return true;
      }
    }
  }
  const name = result.intent?.intent ?? "";
  if (
    name === "SELF_KNOWLEDGE_QUERY"
    || name === "SELF_WORK_STATUS"
    || name.startsWith("SELF_EXPLANATION_")
    || name.startsWith("CAPABILITY_FOLDER_LAW_")
    || name.startsWith("CAUSAL_EXPLANATION_")
    || name.startsWith("UNSUPPORTED_")
    || name === "SUBJECT_AMBIGUOUS"
    || name === "UNRESOLVED_LANGUAGE"
  ) return false;
  if (result.status !== "ANSWERED") return false;
  const semantic = result.semantic_outcome as { ok?: boolean; context?: { resolved_state?: string; read_only_knowledge?: unknown } } | null;
  if (!semantic?.ok || semantic.context?.read_only_knowledge) return false;
  return semantic.context?.resolved_state === "RESOLVED";
}

function ensureOwnerGoogleReadPolicy(ai_identity: string, session_id: string): void {
  if (matchingCapabilityBindingPolicy(ai_identity, session_id)) return;
  // Owner Surface principal: allow Google READ services already registered on this machine.
  // Does not invent write rights — allowed_actions stay SEARCH/READ/DOWNLOAD only.
  issueOwnerCapabilityBindingPolicy({
    ai_identity,
    session_id,
    effect: "ALLOW",
    enabled_binding_ids: [GMAIL_SERVICE_ID, CALENDAR_SERVICE_ID, DRIVE_SERVICE_ID, SHEETS_SERVICE_ID, "*"],
    allowed_actions: ["SEARCH", "READ", "DOWNLOAD"],
    visible_data_classes: ["REMOTE_OBJECT"],
    approval_required_actions: [],
    allowed_connection_ids: ["connection.google.workspace.v1"],
    read_scope: [],
    write_scope: [],
    publish_scope: [],
    network_destinations: ["https://www.googleapis.com", "https://gmail.googleapis.com", "https://www.googleapis.com/drive", "https://sheets.googleapis.com", "https://www.googleapis.com/calendar"],
    expires_at: null,
  });
}

function existingExecutionRouteOptions(ownerIdentity: EnvelopeIdentity): Pick<RouteOptions, "executionRequestBase" | "executionPolicyContext"> {
  const entry = resolveEntryContext({
    identity_id: ownerIdentity.identity_id,
    account_id: ownerIdentity.acting_as_account_id ?? ACCOUNT_ID,
    workspace_id: WORKSPACE_ID,
    command_id: "unknown",
  });
  return {
    executionRequestBase: entry.executionRequestBase,
    executionPolicyContext: entry.context,
  };
}

async function invokeExistingMcpSubmitCommand(
  commandText: string,
  ownerIdentity: EnvelopeIdentity,
  ownerPayload: Record<string, unknown> | null,
  workId: string | null,
): Promise<unknown> {
  const classified = classifyCommand(commandText);
  const ai_identity = typeof ownerPayload?.ai_identity === "string" ? ownerPayload.ai_identity : ownerIdentity.identity_id;
  const session_id = typeof ownerPayload?.session_id === "string" ? ownerPayload.session_id : `owner-surface:${ownerIdentity.identity_id}`;
  const basePayload: Record<string, unknown> = {
    ...(ownerPayload ?? {}),
    // Owner surface principal — required by google-workspace Owner capability policy gate.
    ai_identity,
    session_id,
  };

  let routeOptions: RouteOptions = {
    ...(workId ? { work_id: workId } : {}),
    envelope_payload: basePayload,
    ...existingExecutionRouteOptions(ownerIdentity),
  };

  if (classified.status === "MATCHED" && classified.capability.capability_id === "google-workspace") {
    ensureOwnerGoogleReadPolicy(ai_identity, session_id);
    const intent = resolveGoogleWorkspaceReadIntentFromText(commandText);
    if (intent) {
      const payload: Record<string, unknown> = { ...basePayload };
      if (intent === "google.calendar.events.list" && typeof payload.calendar_id !== "string") {
        payload.calendar_id = "primary";
      }
      if (intent === "google.gmail.messages.search" && typeof payload.q !== "string") {
        payload.q = "in:inbox";
      }
      if (intent === "google.drive.files.search" && typeof payload.q !== "string") {
        payload.q = "trashed=false";
      }
      if (intent === "google.sheets.values.read" || intent === "google.sheets.spreadsheets.metadata") {
        payload.owner_text = commandText;
        const sheetsParse = parseSheetsOwnerText(commandText);
        if (sheetsParse.spreadsheet_id && typeof payload.spreadsheet_id !== "string") {
          payload.spreadsheet_id = sheetsParse.spreadsheet_id;
        }
        if (sheetsParse.spreadsheet_name && typeof payload.spreadsheet_name !== "string") {
          payload.spreadsheet_name = sheetsParse.spreadsheet_name;
        }
        if (sheetsParse.range && typeof payload.range !== "string") {
          payload.range = sheetsParse.range;
        }
        if (sheetsParse.sheet_tab && typeof payload.sheet_tab !== "string") {
          payload.sheet_tab = sheetsParse.sheet_tab;
        }
      }
      routeOptions = {
        ...routeOptions,
        steps: [{ capability_id: "google-workspace", intent, payload }],
      };
    }
  }

  const outcome = await submitOwnerCommand(commandText, ownerIdentity, routeOptions);
  return {
    dna_os_command_id: outcome.envelope.command_id,
    dna_os_work_id: outcome.work_id,
    dna_os_task_id: outcome.result.task_id,
    dna_os_result_status: outcome.result.status,
    evidence: outcome.result.evidence,
    artifacts: outcome.result.artifacts,
    summary: outcome.result.summary,
    lifecycle: outcome.lifecycle,
    result: outcome.result,
    surface: outcome.surface,
  };
}

const LANGUAGE_OWNER_IDENTITY: EnvelopeIdentity = {
  identity_id: IDENTITY_ID,
  acting_as_account_id: ACCOUNT_ID,
  acting_as_tenant_id: "tenant-deadboard-owner",
  software_id: "dna-os-deadboard",
  kind: "human",
};

function ownerIdentityForLanguagePath(req: IncomingMessage): EnvelopeIdentity {
  const authenticated = resolveAuthenticatedOwnerIdentity(req);
  if (!authenticated) return LANGUAGE_OWNER_IDENTITY;
  return resolveOwnerIdentity(authenticated) ?? LANGUAGE_OWNER_IDENTITY;
}

/**
 * Lift existing submitOwnerCommand fields onto the language JSON.
 * Does not infer execution from display text.
 */
export function canonicalExecutionFieldsFromMcp(mcp: unknown): {
  readonly command_id: string | null;
  readonly work_id: string | null;
  readonly task_id: string | null;
  readonly status: string | null;
  readonly execution_started: true;
  readonly work_order_created: boolean;
  readonly task_created: boolean;
  readonly evidence_refs: readonly unknown[];
  readonly capability_id: string | null;
  readonly provider: string | null;
  readonly action: string | null;
} {
  const row = mcp && typeof mcp === "object" && !Array.isArray(mcp) ? mcp as Record<string, unknown> : {};
  const result = row.result && typeof row.result === "object" && !Array.isArray(row.result)
    ? row.result as Record<string, unknown>
    : {};
  const command_id = typeof row.dna_os_command_id === "string" && row.dna_os_command_id.trim() !== ""
    ? row.dna_os_command_id
    : null;
  const work_id = typeof row.dna_os_work_id === "string" && row.dna_os_work_id.trim() !== ""
    ? row.dna_os_work_id
    : null;
  const task_id = typeof row.dna_os_task_id === "string" && row.dna_os_task_id.trim() !== ""
    ? row.dna_os_task_id
    : (typeof result.task_id === "string" && result.task_id.trim() !== "" ? result.task_id : null);
  const status = typeof row.dna_os_result_status === "string" && row.dna_os_result_status.trim() !== ""
    ? row.dna_os_result_status
    : (typeof result.status === "string" && result.status.trim() !== "" ? result.status : null);
  const evidence = Array.isArray(row.evidence) ? row.evidence : (Array.isArray(result.evidence) ? result.evidence : []);
  const capability_id = typeof result.capability_id === "string" ? result.capability_id : null;
  const provider = typeof result.provider === "string" ? result.provider : (typeof result.connection_id === "string" ? result.connection_id : null);
  const action = typeof result.action === "string" ? result.action : (typeof result.intent === "string" ? result.intent : null);
  return {
    command_id,
    work_id,
    task_id,
    status,
    execution_started: true,
    work_order_created: work_id !== null,
    task_created: task_id !== null,
    evidence_refs: evidence,
    capability_id,
    provider,
    action,
  };
}

function ownerVisibleMcpSummary(mcp: unknown): string | null {
  if (!mcp || typeof mcp !== "object") return null;
  const row = mcp as Record<string, unknown>;
  const surface = row.surface as { owner_response?: unknown } | undefined;
  if (typeof surface?.owner_response === "string" && surface.owner_response.trim()) return surface.owner_response;
  if (typeof row.summary === "string" && row.summary.trim()) return row.summary;
  const result = row.result as { summary?: unknown; message?: unknown } | undefined;
  if (typeof result?.summary === "string" && result.summary.trim()) return result.summary;
  if (typeof result?.message === "string" && result.message.trim()) return result.message;
  return null;
}

function projectLanguageAnswerForOwnerSurface(body: Record<string, unknown>): Record<string, unknown> {
  const screen = body.owner_screen as { visible_text?: unknown } | undefined;
  const visible = (typeof body.answer === "string" && body.answer.trim() !== "" ? body.answer : null)
    ?? (typeof screen?.visible_text === "string" && screen.visible_text.trim() !== "" ? screen.visible_text : null);
  if (!visible) return body;
  const semantic = body.semantic && typeof body.semantic === "object" && !Array.isArray(body.semantic)
    ? body.semantic as Record<string, unknown>
    : {};
  const priorContext = semantic.context && typeof semantic.context === "object" && !Array.isArray(semantic.context)
    ? semantic.context as Record<string, unknown>
    : {};
  const existing = priorContext.read_only_knowledge;
  const existingReply = existing && typeof existing === "object" && !Array.isArray(existing)
    ? (existing as { owner_reply_th?: unknown }).owner_reply_th
    : null;
  const reply = typeof existingReply === "string" && existingReply.trim() !== "" ? existingReply : visible;
  return {
    ...body,
    semantic: {
      ...semantic,
      ok: true,
      context: {
        ...priorContext,
        read_only_knowledge: { owner_reply_th: reply },
      },
    },
  };
}

/**
 * GET /owner/language is the Owner Surface ingress. Knowledge answers stay
 * on the conversation result. A registered connector match (gmail / drive /
 * calendar / sheets) reuses the same in-process submitOwnerCommand forward
 * as POST /chat so self-knowledge cannot swallow the live read.
 */
async function languageBodyWithExistingCommandForward(
  result: ConversationResult,
  text: string,
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  const body = composeOwnerAskHttpBody(result, "READ_ONLY_LANGUAGE");
  if (!shouldForwardStructuredIntentToExistingMcp(result, null, text)) {
    return projectLanguageAnswerForOwnerSurface(body);
  }
  const mcp = await invokeExistingMcpSubmitCommand(text, ownerIdentityForLanguagePath(req), null, null);
  const visible = ownerVisibleMcpSummary(mcp)
    ?? "คำสั่งไปที่ submitOwnerCommand แล้ว แต่ยังไม่มีข้อความสรุปจากผลลัพธ์";
  const semantic = body.semantic && typeof body.semantic === "object" && !Array.isArray(body.semantic)
    ? body.semantic as Record<string, unknown>
    : {};
  const priorContext = semantic.context && typeof semantic.context === "object" && !Array.isArray(semantic.context)
    ? semantic.context as Record<string, unknown>
    : {};
  const owner_screen = body.owner_screen && typeof body.owner_screen === "object"
    ? { ...(body.owner_screen as Record<string, unknown>), visible_text: visible }
    : { visible_text: visible };
  const execution = canonicalExecutionFieldsFromMcp(mcp);
  return {
    ...body,
    mcp,
    ...execution,
    execution_path: "/owner/submit-command",
    EXECUTION_STARTED: true,
    owner_response: visible,
    answer: visible,
    owner_screen,
    semantic: {
      ...semantic,
      ok: true,
      context: {
        ...priorContext,
        read_only_knowledge: { owner_reply_th: visible },
      },
    },
  };
}

registerIdentity({ identity_id: IDENTITY_ID, kind: "human", display_name: "Dead Board Owner" });
registerAccount({ account_id: ACCOUNT_ID });
registerWorkspace({ workspace_id: WORKSPACE_ID, account_id: ACCOUNT_ID });
grantMembership({ identity_id: IDENTITY_ID, scope_type: "account", scope_id: ACCOUNT_ID, role: "member" });
grantMembership({ identity_id: IDENTITY_ID, scope_type: "workspace", scope_id: WORKSPACE_ID, role: "member" });

// Identities provisioned via a real forwarded ownerIdentity (see header) —
// registered/granted once per real Supabase user id, not on every request,
// so repeated commands from the same signed-in person don't accumulate
// duplicate membership/grant rows in these in-memory registries.
const provisionedRealIdentities = new Set<string>();

function resolveOwnerIdentity(ownerIdentity: { id?: unknown; email?: unknown } | undefined): EnvelopeIdentity | null {
  if (!ownerIdentity || typeof ownerIdentity.id !== "string" || ownerIdentity.id.length === 0) return null;
  const realIdentityId = `supabase-${ownerIdentity.id}`;
  const displayName = typeof ownerIdentity.email === "string" && ownerIdentity.email.length > 0 ? ownerIdentity.email : realIdentityId;

  if (!provisionedRealIdentities.has(realIdentityId)) {
    // Scope is fixed by this server; the forwarded identity only selects the
    // authenticated human principal and never expands account/workspace scope.
    registerIdentity({ identity_id: realIdentityId, kind: "human", display_name: displayName });
    grantMembership({ identity_id: realIdentityId, scope_type: "account", scope_id: ACCOUNT_ID, role: "member" });
    grantMembership({ identity_id: realIdentityId, scope_type: "workspace", scope_id: WORKSPACE_ID, role: "member" });
    issueExecutionGrant({
      identity_id: realIdentityId,
      account_id: ACCOUNT_ID,
      workspace_id: WORKSPACE_ID,
      capability: "execution.run",
      command_id: "unknown",
      action: "run",
      cwd_scope_prefix: "repo/",
      effect: "allow",
    });
    provisionedRealIdentities.add(realIdentityId);
  }

  return {
    identity_id: realIdentityId,
    acting_as_account_id: ACCOUNT_ID,
    acting_as_tenant_id: "tenant-deadboard-owner",
    software_id: "dna-os-deadboard",
    kind: "human",
  };
}

/**
 * Bind the Owner Command caller to the existing Owner Authentication store.
 *
 * The browser must not manufacture or forward an identity for an execution
 * request. Only an active session that passed human verification can supply
 * the principal. Multiple active sessions are accepted only when they all
 * resolve to the same Owner identity; different identities are ambiguous and
 * therefore fail closed.
 */
/**
 * Bind this request to an Owner principal that `validateOwnerSession`
 * already accepts. The session pointer is `x-dna-os-owner-session` —
 * the same header `connections/dna-os-mcp/caller-context.ts` already
 * uses. It is a pointer into the Owner Authentication store, not proof
 * by itself and not a caller-selected identity in the JSON body.
 *
 * A presented pointer that fails validation fails closed (no fallback),
 * so a stale header cannot inherit some other session on disk. When no
 * pointer is presented, an unambiguous human-verified session already in
 * the store may still bind — same scan this transport already used.
 */
function ownerSessionPointerFromRequest(req: IncomingMessage): string | null {
  const raw = req.headers["x-dna-os-owner-session"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveAuthenticatedOwnerIdentity(req?: IncomingMessage): { id: string } | null {
  const presented = req ? ownerSessionPointerFromRequest(req) : null;
  if (presented !== null) {
    const verified = validateOwnerSession(presented);
    if (!verified.ok) return null;
    const id = verified.session.owner_identity.trim();
    return id.length > 0 ? { id } : null;
  }
  const active = listOwnerSessions()
    .filter((session) => session.state === "ACTIVE")
    .filter((session) => String(session.authenticated_via).startsWith("human-verification"))
    .filter((session) => validateOwnerSession(session.session_id).ok)
    .map((session) => session.owner_identity.trim())
    .filter(Boolean);
  const identities = [...new Set(active)];
  return identities.length === 1 ? { id: identities[0]! } : null;
}

function buildExecutionPolicyContext(identityId: string): ExecutionPolicyContext {
  return {
    identity: getIdentityRegistration(identityId)?.identity,
    memberships: listMembershipsForIdentity(identityId),
    grants: listExecutionGrantsForIdentity(identityId),
    command: {
      command_id: "unknown",
      required_capability: "execution.run",
      allowed_actions: ["run"],
      allowed_cwd_scope_prefixes: ["repo/"],
    },
  };
}

let supervisor: ReturnType<typeof startAgentGatewaySupervisor> | undefined;
let jointBridge: ReturnType<typeof startJointEventBridge> | undefined;
let writeFailureBridge: ReturnType<typeof startWriteFailureBridge> | undefined;

async function runtimeInventory(): Promise<unknown> {
  let researchHealth: { status?: string } = {};
  try {
    const response = await fetch("http://127.0.0.1:8787/api/research/health");
    researchHealth = response.ok ? await response.json() as { status?: string } : {};
  } catch { researchHealth = {}; }
  const revision = readRuntimeRevision();
  const routerCapabilities = listCapabilities();
  const canonicalRows = registrationStore.listCapabilities();
  const canonicalMetadataRows = registrationStore.listCapabilityRows?.() ?? [];
  const canonicalMetadataById = new Map(canonicalMetadataRows.map((row) => [row.capability_id, row]));
  const resourceRows = registrationStore.listResourceRows?.() ?? [];
  const resourceLinks = registrationStore.listResourceCapabilityLinks?.() ?? [];
  const relationshipRows = registrationStore.listRelationshipRows?.() ?? [];
  const evidenceRows = registrationStore.listEvidenceRows?.() ?? [];
  const connections = listConnectionDeclarations();

  const canonicalByRoute = new Map<string, CapabilityLookupResult>();
  for (const row of canonicalRows) {
    for (const edge of (row.relationships ?? [])) {
      if (edge.relationship_kind === "CAPABILITY_TO_API" && edge.to_id.startsWith("route:")) {
        canonicalByRoute.set(edge.to_id.slice("route:".length), row);
      }
    }
  }

  const resourceById = new Map(resourceRows.map((row) => [row.resource_id, row]));
  const relationshipsByCanonicalCapability = new Map<string, RelationshipRow[]>();
  for (const edge of relationshipRows) {
    if (edge.from_type === "FILE" && edge.to_type === "CAPABILITY") {
      const list = relationshipsByCanonicalCapability.get(edge.to_id) ?? [];
      list.push(edge);
      relationshipsByCanonicalCapability.set(edge.to_id, list);
    }
  }

  function resourcesForCanonical(row: CapabilityLookupResult | null): ResourceRow[] {
    if (!row) return [];
    const linked = resourceLinks.filter((link) => link.capability_id === row.capability_id).map((link) => link.resource_id);
    const legacy = (relationshipsByCanonicalCapability.get(row.capability_id) ?? []).map((edge) => edge.from_id);
    return [...new Set([...linked, ...legacy])].map((id) => resourceById.get(id)).filter((x): x is ResourceRow => Boolean(x));
  }

  function latestEvidence(row: CapabilityLookupResult | null, resources: readonly ResourceRow[]): EvidenceRow | null {
    const resourceIds = new Set(resources.map((resource) => resource.resource_id));
    return [...evidenceRows]
      .filter((evidence) => (row && evidence.related_capability_id === row.capability_id) || (evidence.related_resource_id !== null && resourceIds.has(evidence.related_resource_id)))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .at(-1) ?? null;
  }

  function resolveConnection(capability: ReturnType<typeof listCapabilities>[number], canonical: CapabilityLookupResult | null): ConnectionDeclaration | null {
    const endpointModule = capability.endpoint.kind === "not_yet_built" ? null : capability.endpoint.module;
    const canonicalIds = new Set([capability.capability_id, canonical?.capability_id].filter((x): x is string => Boolean(x)));
    return connections.find((connection) =>
      (endpointModule !== null && connection.execution_boundary === endpointModule) ||
      canonicalIds.has(connection.executor_capability_id ?? "") ||
      connection.provider_id === capability.capability_id,
    ) ?? null;
  }

  const capabilities = routerCapabilities.map((capability) => {
    const registered = true;
    const wired = capability.endpoint.kind !== "not_yet_built";
    const live = capability.capability_id === "research-engine" && researchHealth.status === "ok";
    const status = !wired ? "BLOCKED" : live ? revision.dirty ? "LIVE" : "VERIFIED" : "EXECUTABLE";
    const canonical = canonicalByRoute.get(capability.capability_id) ?? null;
    const canonicalMetadata = canonical ? canonicalMetadataById.get(canonical.capability_id) ?? null : null;
    const relatedResources = resourcesForCanonical(canonical);
    const sourceResource = relatedResources[0] ?? resourceRows.find((resource) => capability.endpoint.kind !== "not_yet_built" && resource.source_location === capability.endpoint.module) ?? null;
    const connection = resolveConnection(capability, canonical);
    const evidence = latestEvidence(canonical, sourceResource ? [sourceResource] : relatedResources);
    const apiRoute = canonical?.relationships?.find((edge) => edge.relationship_kind === "CAPABILITY_TO_API" && edge.to_id.startsWith("route:"))?.to_id.slice("route:".length) ?? null;
    const provider = connection?.provider_id ?? null;
    const providerMetadata = provider ? providerMetadataFor(provider) : null;
    const providerBrand = provider ? resolveProviderBrandAsset(provider) : null;
    const mcpTools = capability.capability_id === "dispatcher" ? ["submit_work_result"] : [];
    return {
    capability_id: capability.capability_id,
    repo_id: capability.repo_id,
    contract: capability.contract,
    registry_status: capability.health_status,
    permission_requirement: capability.permission_requirement,
    health_status: capability.health_status,
    endpoint: capability.endpoint,
    supported_commands: capability.supported_commands,
    registered,
    wired,
    live,
    executable: wired,
    status,
    canonical_capability: canonical ? {
      capability_id: canonical.capability_id,
      canonical_name: canonical.canonical_name,
      purpose: canonicalMetadata?.purpose ?? null,
      input_contract: canonicalMetadata?.input_contract ?? canonical.input_contract,
      output_contract: canonicalMetadata?.output_contract ?? canonical.output_contract,
      verified_at: canonicalMetadata?.verified_at ?? null,
    } : null,
    resource: sourceResource ? {
      resource_id: sourceResource.resource_id,
      source_location: sourceResource.source_location,
      version: sourceResource.version,
      status: sourceResource.status,
      resolution: canonical ? "CAPABILITY_RELATIONSHIP" : "EXACT_SOURCE_LOCATION_MATCH",
    } : null,
    connection: connection ? {
      provider: connection.provider_id,
      connection_type: connection.connection_type,
      protocol: connection.protocol,
      endpoint: connection.endpoint,
      availability: connection.state,
      relationship_state: connection.executor_capability_id === null ? "UNBOUND" : canonical && connection.executor_capability_id === canonical.capability_id ? "BOUND" : "DECLARED_NOT_JOINED",
      executor_capability_id: connection.executor_capability_id,
      auth_type: connection.credential_ref?.kind ?? null,
      evidence_ref: connection.verification_evidence_id ?? null,
    } : null,
    api: { api_route: apiRoute, api_relationship_status: apiRoute ? "BOUND" : "NOT_FOUND" },
    mcp: { available: true, bound_to_capability: mcpTools.length > 0, tools: mcpTools },
    provider_metadata: providerMetadata ? {
      provider_id: providerMetadata.provider_id,
      display_name: providerMetadata.display_name,
      brand_slug: providerMetadata.brand_slug,
      brand_icon_url: null, // production UI must not hotlink; use brand_asset_ref
      brand_icon_source: providerMetadata.brand_icon_source,
      source: providerMetadata.source,
      parent_provider_id: providerMetadata.parent_provider_id,
      official_brand_source_ref: providerMetadata.official_brand_source_ref,
      asset_state: providerBrand?.asset_state ?? providerMetadata.asset_state,
      brand_asset_ref: providerBrand?.brand_asset_ref ?? null,
      remote_render_url: null,
      fallback_used: providerBrand?.fallback_used ?? true,
    } : null,
    last_verified: evidence?.created_at ?? canonicalMetadata?.verified_at ?? null,
    verification_evidence_id: evidence?.evidence_id ?? null,
    resource_version: sourceResource?.version ?? null,
    evidence: [
      `registry:control/command-router/capability-registry.ts#${capability.capability_id}`,
      capability.capability_id === "research-engine" ? "health:http://127.0.0.1:8787/api/research/health" : `endpoint:${capability.endpoint.kind}`,
    ],
    };
  });
  return {
    status: revision.dirty ? "BLOCKED" : "LIVE",
    generated_at: new Date().toISOString(),
    revision,
    transport: { status: revision.dirty ? "LIVE" : "VERIFIED", endpoint: "http://127.0.0.1:8791", health: "/health" },
    supervisor: { status: revision.dirty ? "LIVE" : "VERIFIED", worker_count: DEFAULT_AGENT_WORKERS.length },
    evidence_store: {
      status: revision.dirty ? "LIVE" : "VERIFIED",
      task_path: "control/agent-gateway/data/tasks.jsonl",
      evidence_path: "control/agent-gateway/data/evidence.jsonl",
      handoff_path: "control/agent-gateway/data/handoffs.jsonl",
    },
    capabilities,
    mcp_servers: [{
      server: "dna-os-mcp",
      version: "1.0.0",
      transport: ["streamable-http", "stdio"],
      endpoint: "http://127.0.0.1:8793/mcp",
      tools: ["submit_command", "submit_registration_candidate", "lookup_capability", "get_resource", "get_task", "submit_work_result", "get_system_status"],
      source: "connections/dna-os-mcp/server.ts + tool-registry.ts",
    }],
  };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(payload);
}

function languageStageFrame(event: { event_id: string; stage: string }): string {
  return `id: ${event.event_id}\nevent: language_progress\ndata: ${JSON.stringify(event)}\n\n`;
}

function monitorActivityFrame(payload: unknown): string {
  return `event: monitor_activity\ndata: ${JSON.stringify(payload)}\n\n`;
}

/**
 * ชั้นแรกของลำดับ canonical: คน -> raw chat intake -> language translator ->
 * structured interpretation -> command receiver/processor -> Agent
 *
 * ── ทำไมต้องมีประตูของตัวเอง ──
 * ก่อนหน้านี้ชั้นนี้มีชีวิตอยู่ได้ก็ต่อเมื่อมีคนเคาะ `POST /command` ซึ่งเป็นชื่อ
 * ของชั้นที่อยู่ถัดไปอีกสองชั้น ผู้ใช้จึงต้อง "ยิงเข้าท่อคำสั่ง" ถึงจะพูดภาษาคนได้
 * ทั้งที่ข้อความดิบไม่ควรรู้จักคำว่า command เลย
 *
 * ── ไม่มีตัวแปลตัวที่สอง ──
 * ทั้ง `POST /chat` และสาขาภาษาอิสระของ `POST /command` เรียกฟังก์ชันนี้ตัวเดียว
 * ซึ่งเรียก `translateOwnerMessage` เดิม ที่บันทึกข้อความดิบลง
 * `semantic-history.jsonl` **ก่อน** ปล่อยโมเดลแยกกล่องทำงาน และรอดแม้โมเดลล้ม
 *
 * ── สั่งงานบนคำขอเดียวกันเมื่อ Owner ยื่นคำสั่งที่ execute ได้ ──
 * Knowledge answers stay in the conversation runtime. An Owner-presented
 * engineering_coding_intent, or a resolved executable command, is submitted
 * in-process through submitOwnerCommand on this same request. The result
 * returns in the same HTTP JSON (`mcp`). This is not a second MCP.
 */
async function respondWithChatIntake(
  res: ServerResponse,
  rawText: string,
  ownerIdentity: EnvelopeIdentity,
  uiHintReceived: boolean,
  req?: IncomingMessage,
  ownerPayload: Record<string, unknown> | null = null,
): Promise<void> {
  const messageId = newEnvelopeId();
  let result: ConversationResult;
  try {
    result = await conversationRuntime().request({
      request_id: messageId,
      trace_id: messageId,
      owner_identity: { identity_id: ownerIdentity.identity_id, kind: ownerIdentity.kind },
      text: rawText,
    });
  } catch (error) {
    // FAIL CLOSED — never translateOwnerMessage() in-process, never any
    // execution-plane path. A dead/unreachable conversation runtime is
    // reported as unavailable, deterministically, and nothing else runs.
    sendJson(res, 503, { error: "CONVERSATION_RUNTIME_UNAVAILABLE", detail: error instanceof Error ? error.message : String(error), message_id: messageId });
    return;
  }
  const forwardToMcp = shouldForwardStructuredIntentToExistingMcp(result, ownerPayload, rawText);
  let mcp: unknown = null;
  if (forwardToMcp) {
    mcp = await invokeExistingMcpSubmitCommand(rawText, ownerIdentity, ownerPayload, null);
  }
  sendJson(res, 200, {
    ...composeOwnerAskHttpBody(result, "RAW_CHAT_INTAKE"),
    message_id: result.request_id,
    raw_text: rawText,
    mcp,
    ui_work_order_received: uiHintReceived,
    next_layer: forwardToMcp ? "EXISTING_MCP_SUBMIT_COMMAND" : (result.final_semantic_state === "ANSWERABLE_READ_ONLY" || result.status === "ANSWERED" ? "STRUCTURED_INTERPRETATION" : "RAW_MESSAGE_RETAINED"),
    execution_started: forwardToMcp,
    next: forwardToMcp ? "Owner Surface → submitOwnerCommand (same request)" : "conversation answer from authoritative DNA OS records; executable Owner commands go through existing MCP submit_command",
  });
}

/**
 * `POST /chat` — ประตูของชั้นรับข้อความดิบ
 *
 * รับ `{ message | commandText }` เป็นข้อความภาษาคนล้วน ไม่มีไวยากรณ์คำสั่งใดที่
 * ผู้ใช้ต้องจำ และไม่รับ WorkOrder — การยื่นงานมีประตูของมันเองที่ `POST /command`
 */
function ownerPresentedPayload(body: Record<string, unknown>): Record<string, unknown> | null {
  const payload = body.payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) return payload as Record<string, unknown>;
  if (body.engineering_coding_intent && typeof body.engineering_coding_intent === "object") {
    const presented: Record<string, unknown> = { engineering_coding_intent: body.engineering_coding_intent };
    if (Array.isArray(body.proposed_writes)) presented.proposed_writes = body.proposed_writes;
    return presented;
  }
  return null;
}

export async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let message: unknown;
  let ownerIdentityInput: { id?: unknown; email?: unknown } | undefined;
  let ownerPayload: Record<string, unknown> | null = null;
  try {
    const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
    message = body.message ?? body.commandText;
    if (body.ownerIdentity && typeof body.ownerIdentity === "object") ownerIdentityInput = body.ownerIdentity as { id?: unknown; email?: unknown };
    ownerPayload = ownerPresentedPayload(body);
  } catch {
    sendJson(res, 400, { error: "invalid JSON body" });
    return;
  }
  if (typeof message !== "string" || message.trim() === "") {
    sendJson(res, 400, { error: "message must be a non-empty string" });
    return;
  }
  if (!ownerIdentityInput || typeof ownerIdentityInput.id !== "string" || ownerIdentityInput.id.length === 0) {
    sendJson(res, 401, { error: "authenticated owner identity required" });
    return;
  }
  try {
    const ownerIdentity = resolveOwnerIdentity(ownerIdentityInput);
    if (!ownerIdentity) { sendJson(res, 401, { error: "authenticated owner identity required" }); return; }
    await respondWithChatIntake(res, message, ownerIdentity, false, req, ownerPayload);
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

export async function handleCommand(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let commandText: unknown;
  let workOrder: WorkOrder | undefined;
  let uiWorkOrder: UiWorkOrder | undefined;
  let idempotencyKey: unknown;
  let ownerIdentityInput: { id?: unknown; email?: unknown } | undefined;
  let commandPayload: Record<string, unknown> | null = null;
  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw) as Record<string, unknown> & { commandText?: unknown; workOrder?: unknown; idempotencyKey?: unknown; uiWorkOrder?: unknown; ownerIdentity?: unknown };
    commandText = body.commandText;
    idempotencyKey = body.idempotencyKey;
    if (body.workOrder !== undefined) workOrder = body.workOrder as WorkOrder;
    if (body.uiWorkOrder !== undefined) uiWorkOrder = body.uiWorkOrder as UiWorkOrder;
    if (body.ownerIdentity && typeof body.ownerIdentity === "object") ownerIdentityInput = body.ownerIdentity as { id?: unknown; email?: unknown };
    commandPayload = ownerPresentedPayload(body);
  } catch {
    sendJson(res, 400, { error: "invalid JSON body" });
    return;
  }
  if (typeof commandText !== "string" || commandText.trim() === "") {
    sendJson(res, 400, { error: "commandText must be a non-empty string" });
    return;
  }
  if (!ownerIdentityInput || typeof ownerIdentityInput.id !== "string" || ownerIdentityInput.id.length === 0) {
    sendJson(res, 401, { error: "authenticated owner identity required" });
    return;
  }

  const ownerIdentity = resolveOwnerIdentity(ownerIdentityInput);
  if (!ownerIdentity) { sendJson(res, 401, { error: "authenticated owner identity required" }); return; }

  if (uiWorkOrder) {
    const denied = coreNodeUnavailableForCapability("connections/os-ui");
    if (denied) {
      sendJson(res, 503, denied);
      return;
    }
  }

  try {
    // A structured WorkOrder is the existing DNA OS admission path. Keep
    // free-form/UI commands on their existing owner-command router path;
    // only this branch connects HTTP input to the already-built durable
    // Input Gateway -> Controller -> Agent Gateway pipeline.
    if (workOrder) {
      const submittedAt = new Date();
      const envelope = {
        envelope_id: newEnvelopeId(),
        identity: ownerIdentity,
        intent_text: commandText,
        work_order: workOrder,
        submitted_at: submittedAt.toISOString(),
        expires_at: new Date(submittedAt.getTime() + 5 * 60_000).toISOString(),
        idempotency_key: typeof idempotencyKey === "string" && idempotencyKey.length > 0 ? idempotencyKey : newEnvelopeId(),
      };
      const lifecycle = await ingestCommandEnvelope(envelope, "owner-command-http");
      sendJson(res, 200, { envelope, lifecycle, task: getTask(lifecycle.task_id), result: getResult(lifecycle.task_id), explanation: explain(lifecycle.task_id) });
      return;
    }

    // ภาษาคนที่มาถึงประตูนี้ถูกส่งต่อให้ชั้นเดียวกับ POST /chat — ไม่มีตัวแปล
    // ตัวที่สองและไม่มีการบันทึกซ้ำ ประตูนี้คงไว้เพื่อผู้เรียกเดิมเท่านั้น
    // `uiWorkOrder` ไม่ใช่ทางลัด: มันเป็นคำใบ้ของหน้าจอที่ติดมากับข้อความดิบ
    // ไม่ใช่สัญญางานที่ผ่านการรับเข้า
    await respondWithChatIntake(res, commandText, ownerIdentity, uiWorkOrder !== undefined, req, commandPayload);
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Agent submission only. Admission, classification, splitting,
 * registration, and final DNA decision all live in
 * control/work-result-ingress/ (control/work-result-ingress/contract.ts's
 * ingestWorkResult) — this transport only parses the body and reports
 * whatever that real ingress returns. It never executes a handoff itself
 * and never promotes an agent claim.
 */
async function handleAgentHandoff(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let input: WorkResultInput;
  try {
    input = JSON.parse(await readBody(req)) as WorkResultInput;
  } catch {
    sendJson(res, 400, { status: "DNA_BLOCKED", error: "invalid JSON body" });
    return;
  }

  const result = ingestWorkResult(input, { store: registrationStore });

  if (result.blocker) {
    const status = result.blocker.startsWith("WORK_ORDER_NOT_ADMITTED") ? 403
      : result.blocker.startsWith("WORK_ORDER_NOT_ACTIVE") || result.blocker.startsWith("DUPLICATE_ACTIVE_SUBMISSION") ? 409
      : result.blocker.startsWith("HANDOFF_ADMISSION_FAILED") ? 400
      : 500;
    sendJson(res, status, { status: "DNA_BLOCKED", error: result.blocker, task_id: result.task_id });
    return;
  }

  // A submitting agent's VERIFIED is deliberately returned as
  // DNA_VALIDATING. Only DNA OS's existing confirmDnaOsDecision path may
  // produce DNA_VERIFIED/DNA_FAILED/DNA_BLOCKED final decisions.
  const httpStatus = result.status === "REGISTERED" ? 201 : result.status === "PARTIALLY_REGISTERED" ? 200 : 422;
  sendJson(res, httpStatus, {
    status: result.dna_os_decision,
    ingress_status: result.status,
    handoff_id: result.handoff_id,
    artifacts: result.artifacts,
    next_decision: result.next_decision,
    task_id: result.task_id,
    next: "existing DNA OS validator/evidence flow",
  });
}

// Forbidden-content check: scoped to free-text fields only (purpose,
// evidence_refs) — never the whole serialized body, and never path/id
// metadata (source_location, candidate_id, canonical_name, scope,
// version), which legitimately contains words like "sql" as a plain file
// extension (e.g. software/registry-database/migrations/0001_....sql).
// This registration schema has no content field at all — every value here
// is metadata/references, never file content — so this check exists only
// as a defense-in-depth guard against an actual leaked secret or a raw
// SQL statement pasted into free text, matched by shape, not by the bare
// word "sql" appearing anywhere in a path.
const FORBIDDEN_CONTENT_PATTERN = /\b(password|api[_-]?key|secret|token|create\s+table|alter\s+table|drop\s+table|insert\s+into|select\s+\*\s+from)\b/i;
function findForbiddenContent(candidate: any, evidenceRefs: unknown): string | null {
  const freeTextFields: string[] = [String(candidate?.purpose ?? "")];
  if (Array.isArray(evidenceRefs)) freeTextFields.push(...evidenceRefs.map(String));
  const hit = freeTextFields.find((value) => FORBIDDEN_CONTENT_PATTERN.test(value));
  return hit ?? null;
}

async function handleRegistryCandidate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: any; try { body = JSON.parse(await readBody(req)); } catch { sendJson(res, 400, { ingress_status: "UNRESOLVED", reason_code: "INVALID_JSON", registration_status: "FAILED", error: "INVALID_JSON" }); return; }
  if (!body.request_id || !body.source_type || !body.source_id || !body.correlation_id || !body.candidate || !Array.isArray(body.evidence_refs) || !body.submitted_at) { sendJson(res, 400, { ingress_status: "UNRESOLVED", reason_code: "REGISTRATION_SCHEMA_INVALID", registration_status: "FAILED", error: "REGISTRATION_SCHEMA_INVALID" }); return; }
  const forbiddenHit = findForbiddenContent(body.candidate, body.evidence_refs);
  if (forbiddenHit !== null) { sendJson(res, 400, { ingress_status: "REJECTED", reason_code: "FORBIDDEN_REGISTRATION_FIELD", registration_status: "FAILED", error: "FORBIDDEN_REGISTRATION_FIELD" }); return; }
  if (!body.ownerIdentity?.id) { sendJson(res, 401, { ingress_status: "REJECTED", reason_code: "SOURCE_IDENTITY_REQUIRED", registration_status: "FAILED", error: "SOURCE_IDENTITY_REQUIRED" }); return; }
  const c = body.candidate;
  // Domain Classification fields are read from the request but never
  // trusted on their own — evaluateRegistration/registerCandidate always
  // re-derive the true domain from resource_type before anything is
  // normalized, fingerprinted, or written. An external caller cannot pick
  // `domain: SOFTWARE_CONTROL_PLANE` to smuggle a business resource_type through.
  // ingress_metadata/relationships are read from the request but never
  // trusted structurally — validateIngressMetadata/registerCandidate's
  // relationship validation both re-check every value against the real,
  // closed vocabularies before anything is written.
  const candidate: RegistrationCandidate = { candidate_id: String(c.candidate_id), name: String(c.canonical_name ?? c.name ?? ""), kind: c.kind === "capability" ? "capability" : "resource", source_location: String(c.source_location ?? ""), owner: String(body.source_id), input: Object.keys(c.input_contract ?? {}), output: Object.keys(c.output_contract ?? {}), side_effects: Array.isArray(c.side_effects) ? c.side_effects : [], dependencies: Array.isArray(c.dependencies) ? c.dependencies : [], behavior: String(c.purpose ?? ""), version: String(c.version ?? "1.0.0"), evidence_refs: body.evidence_refs, domain: String(c.domain ?? ""), resource_type: String(c.resource_type ?? ""), data_classification: String(c.data_classification ?? ""), source_system: String(body.source_system ?? body.source_type ?? ""), scope: String(c.scope ?? ""), ingress_metadata: c.ingress_metadata ?? undefined, relationships: Array.isArray(c.relationships) ? c.relationships : undefined } as RegistrationCandidate;
  try {
    const result = runRegistrationPipeline(candidate, registrationStore, body.correlation_id);
    const httpStatus = result.status === "REGISTERED" ? 201 : result.status === "UNRESOLVED" ? 422 : 200;
    const written = result.status === "REGISTERED";
    const duplicateOf = result.status === "DUPLICATE" ? { candidate_id: null, resource_id: result.duplicate_of.resource_id, capability_id: result.duplicate_of.capability_id } : null;
    const reasonCode = result.status === "REGISTERED" ? null : result.reason_code;
    // Registration Ingress Contract — result semantics (locked, see
    // software/registry-database/README.md): `ingress_status` is the one
    // authoritative, final result (REGISTERED/DUPLICATE/REJECTED/
    // UNRESOLVED) — any caller deciding what to do next reads this field
    // and only this field. `registration_status` is an informational,
    // legacy-shaped label reconstructed for evidence/debugging only —
    // never the field an external system should branch on. Under the
    // single-owner pipeline (STEP "Refactor Registration Pipeline to
    // Single-Owner Sequential Stages") Classification and Duplicate
    // Resolution both run before the Writer is ever called, so the two
    // fields no longer legitimately disagree the way they briefly could
    // when the store's own write path also made a silent duplicate
    // decision — see control/registration-pipeline/README.md.
    sendJson(res, httpStatus, {
      request_id: body.request_id,
      ingress_status: result.status,
      reason_code: reasonCode,
      duplicate_of: duplicateOf,
      registration_status: legacyRegistrationStatusLabel(result),
      registration_command_id: written ? `registration-command-${body.request_id}` : null,
      resource_id: result.status === "REGISTERED" ? result.resource_id : null,
      capability_id: result.status === "REGISTERED" ? result.capability_id : null,
      decision_id: `decision-${body.request_id}`,
      evidence_id: body.evidence_refs[0] ?? null,
      database_status: written ? "CANONICAL_STORE_COMMITTED" : "NOT_WRITTEN",
      correlation_id: body.correlation_id,
      work_item_task_id: result.status === "UNRESOLVED" ? result.work_item_task_id : null,
    });
  } catch (error) {
    sendJson(res, 500, { ingress_status: "UNRESOLVED", reason_code: "INTERNAL_ERROR", registration_status: "FAILED", error: error instanceof Error ? error.message : String(error), request_id: body.request_id });
  }
}
// Reconstructs the pre-refactor decision-label vocabulary
// (APPROVED_FOR_REGISTRATION/DOMAIN_REJECTED/INGRESS_METADATA_INVALID/
// DUPLICATE_EXACT/DUPLICATE_SEMANTIC/UNRESOLVED_DOMAIN/etc.) purely for
// backward-compatible, informational display — never computed by
// re-running any stage, only by reading the one real PipelineResult
// runRegistrationPipeline() already produced.
function legacyRegistrationStatusLabel(result: ReturnType<typeof runRegistrationPipeline>): string {
  if (result.status === "REGISTERED") return "APPROVED_FOR_REGISTRATION";
  if (result.status === "DUPLICATE") return result.reason_code;
  if (result.status === "UNRESOLVED") return result.failed_stage === "DUPLICATE_RESOLUTION" ? "UNRESOLVED_DUPLICATE" : "UNRESOLVED_DOMAIN";
  // REJECTED
  if (result.failed_stage === "VALIDATION") return result.reason_code === "EVIDENCE_REQUIRED" ? "REJECTED_EVIDENCE" : result.reason_code;
  if (result.failed_stage === "CLASSIFICATION") return result.reason_code === "INGRESS_METADATA_INVALID" ? "INGRESS_METADATA_INVALID" : "DOMAIN_REJECTED";
  return result.reason_code;
}

// POST /registry/update — the canonical Existing Registration Update
// path (control/registration-update/'s applyMutation). Distinct from
// POST /registry/candidates (CREATE/REGISTER, Classification + Duplicate
// Resolution + Writer): this endpoint only ever mutates a row that
// already exists — no classification, no duplicate check, never a new
// resource/capability row. See control/registration-update/README.md.
async function handleRegistryUpdate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: any;
  try { body = JSON.parse(await readBody(req)); } catch { sendJson(res, 400, { status: "REJECTED", reason_code: "INVALID_MUTATION_PAYLOAD", error: "INVALID_JSON" }); return; }
  if (!body.resource_id || !body.capability_id || !body.expected_current_version || !body.mutation_type || !body.correlation_id) {
    sendJson(res, 400, { status: "REJECTED", reason_code: "INVALID_MUTATION_PAYLOAD", error: "UPDATE_SCHEMA_INVALID" });
    return;
  }
  try {
    const result = applyMutation(
      {
        resource_id: String(body.resource_id),
        capability_id: String(body.capability_id),
        expected_current_version: String(body.expected_current_version),
        mutation_type: String(body.mutation_type),
        mutation_payload: body.mutation_payload,
        evidence_refs: Array.isArray(body.evidence_refs) ? body.evidence_refs : [],
        correlation_id: String(body.correlation_id),
      },
      registrationStore,
    );
    sendJson(res, result.status === "APPLIED" ? 200 : 409, result);
  } catch (error) {
    sendJson(res, 500, { status: "REJECTED", reason_code: null, error: error instanceof Error ? error.message : String(error) });
  }
}
// capability_id, canonical_name, and semantic_fingerprint were all already
// supported by software/registry-database/lookup.ts's findCapability() —
// this handler previously only ever read body.capability_id and silently
// ignored the others. No new lookup logic here, just reaching the same
// existing contract this folder's own README requires every external
// caller to go through (findCapability(), never a raw store method).
async function handleRegistryLookup(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: any;
  try { body = JSON.parse(await readBody(req)); } catch { sendJson(res, 400, { error: "INVALID_JSON" }); return; }
  const query = {
    ...(typeof body?.capability_id === "string" ? { capability_id: body.capability_id } : {}),
    ...(typeof body?.canonical_name === "string" ? { canonical_name: body.canonical_name } : {}),
    ...(typeof body?.semantic_fingerprint === "string" ? { semantic_fingerprint: body.semantic_fingerprint } : {}),
  };
  const capability = Object.keys(query).length > 0 ? findCapability(query, registrationStore) : null;
  sendJson(res, 200, { matches: capability ? [capability] : [], lookup_layer: "software/registry-database/lookup.ts", raw_sql_exposed: false });
}

/**
 * Network auth gate (2026-08-24, migration hardening — verified live and
 * flagged independently by two reviews: this server had none of its own,
 * relying entirely on loopback-only reachability plus an external caller's
 * (dna-os-deadboard's) already-verified Supabase auth. `ownerIdentity` is
 * NEVER trusted for authorization (see the identity note above) — but the
 * single-owner grant it falls back to already IS full execution.run
 * access, so on a public network that reassurance doesn't mean what it
 * looks like it means. Real decision logic lives in
 * `permissions/network-auth-gate/` (shared with dna-os-circuit/runtime,
 * to avoid two independently-drifting copies of a security check) — this
 * is just the thin Node-`http`-specific glue around it.
 */
function requireSharedSecret(req: IncomingMessage, res: ServerResponse): boolean {
  const expected = process.env.OWNER_COMMAND_HTTP_SHARED_SECRET;
  if (!expected || expected.length === 0) {
    sendJson(res, 503, { error: "write authentication is not configured" });
    return false;
  }
  if (verifySharedSecret(req.headers.authorization, expected)) return true;
  sendJson(res, 401, { error: "unauthorized" });
  return false;
}

/** Exported for tests only — mirrors dna-os-circuit/runtime/server.ts's exported `startCircuitServer`: a test binds this to an ephemeral port (0) itself, real HTTP, never the hardcoded production port. `isMainModule` below still gates the real self-start/supervisor boot, so importing this in a test never triggers production startup. */
export const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    // `revision` is additive: existing callers that only read `ok` are
    // unaffected. It answers "which source revision is this process actually
    // running", which nothing could answer before — see
    // control/runtime-revision/contract.ts for why a null here is honest
    // rather than filled in.
    //
    // LIVE_RUNTIME_INSTANCE_PROOF_V1: `runtime_instance` is operational
    // observability only (PID / worktree / build / child) so agents can detect
    // STALE_SOURCE_CONTEXT or STALE_RUNTIME_BUILD before trusting old proofs.
    const runtime = readRuntimeRevision();
    const build = readConversationRuntimeBuildIdentity();
    const child = conversationRuntimeHandle;
    sendJson(res, 200, {
      ok: true,
      revision: runtime.revision,
      revision_source: runtime.source,
      revision_dirty: runtime.dirty,
      revision_reason: runtime.reason,
      runtime_instance: {
        pid: process.pid,
        ppid: process.ppid,
        port: Number(process.env.PORT) || 8791,
        worktree: process.cwd(),
        started_at: PROCESS_STARTED_AT,
        launch_agent_label: process.env.XPC_SERVICE_NAME ?? null,
        branch: build.branch,
        source_sha: runtime.revision,
        build_from_commit: build.build_from_commit,
        build_hash: build.build_hash,
        build_id: build.build_id,
        build_time: build.build_time,
        artifact_path: build.artifact_path,
        artifact_bytes: build.artifact_bytes,
        artifact_mtime: build.artifact_mtime,
        stale_runtime_build: build.stale_runtime_build,
        stale_reason: build.stale_reason,
        conversation_child_pid: child?.pid ?? null,
        conversation_child_alive: child ? child.isAlive() : null,
        conversation_child_ready: child ? child.isReady() : null,
      },
    });
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD" && !requireSharedSecret(req, res)) {
    return;
  }
  /**
   * Computer Use API — ทุกเส้นทางผ่าน adapter เดียวที่ ./computer-use-api.ts
   * ไฟล์นี้ไม่ตัดสินสิทธิ์เอง แค่ส่ง method/path/body ต่อ
   */
  if (req.url?.startsWith("/computer-use/")) {
    const cuPath = req.url.split("?")[0];
    if (req.method === "GET") {
      const reply = handleComputerUseApi("GET", cuPath, null);
      if (reply) { sendJson(res, reply.status, reply.body); return; }
    }
    if (req.method === "POST") {
      void readBody(req).then((raw) => {
        let parsed: unknown = {};
        // parse ไม่ได้ = ปฏิเสธ ไม่ใช่เดาว่าเป็น {}
        try { parsed = raw ? JSON.parse(raw) : {}; }
        catch { sendJson(res, 400, { ok: false, reason_code: "INVALID_JSON_BODY" }); return; }
        const reply = handleComputerUseApi("POST", cuPath, parsed);
        if (reply) sendJson(res, reply.status, reply.body);
        else sendJson(res, 404, { ok: false, reason_code: "UNKNOWN_COMPUTER_USE_ENDPOINT", detail: cuPath });
      });
      return;
    }
    sendJson(res, 404, { ok: false, reason_code: "UNKNOWN_COMPUTER_USE_ENDPOINT", detail: cuPath });
    return;
  }
  if (req.method === "GET" && req.url === "/runtime/inventory") {
    void runtimeInventory().then((inventory) => sendJson(res, 200, inventory)).catch((error) => sendJson(res, 500, { status: "FAILED", error: error instanceof Error ? error.message : String(error) }));
    return;
  }
  if (req.method === "GET" && req.url === "/monitor/activity") {
    void import("./monitor-activity-projection")
      .then((m) => m.buildMonitorActivitySnapshot())
      .then((snapshot) => sendJson(res, 200, snapshot))
      .catch((error) => sendJson(res, 500, { status: "FAILED", error: error instanceof Error ? error.message : String(error) }));
    return;
  }
  if (req.method === "GET" && req.url === "/monitor/activity/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    let closed = false;
    const sendSnapshot = (): void => {
      void import("./monitor-activity-projection")
        .then((m) => m.buildMonitorActivitySnapshot())
        .then((snapshot) => { if (!closed) res.write(monitorActivityFrame(snapshot)); })
        .catch((error) => { if (!closed) res.write(monitorActivityFrame({ status: "FAILED", error: error instanceof Error ? error.message : String(error), generated_at: new Date().toISOString() })); });
    };
    res.write("retry: 3000\n\n");
    sendSnapshot();
    const interval = setInterval(sendSnapshot, 3000);
    req.on("close", () => { closed = true; clearInterval(interval); });
    return;
  }
  if (req.method === "GET" && req.url === "/state/current") {
    sendJson(res, 200, currentStateProjection());
    return;
  }
  /**
   * Frontend language boundary — read-only by construction.
   *
   * This uses the existing semantic contract and registry/read paths, but does
   * not call /owner/intent, submitOwnerCommand, preview, planner, router or
   * agent gateway. `persist:false` also keeps a language question from adding
   * semantic-history rows. Execution remains behind the existing POST routes.
   */
  if (req.method === "GET" && req.url?.startsWith("/owner/language-events")) {
    const params = new URL(req.url, "http://127.0.0.1").searchParams;
    const requestId = params.get("request_id") ?? "";
    if (requestId.trim() === "") { sendJson(res, 400, { error: "request_id required" }); return; }
    const headerId = req.headers["last-event-id"];
    const lastEventId = (Array.isArray(headerId) ? headerId[0] : headerId) ?? params.get("since") ?? null;
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const delivered = new Set<string>();
    const replayed = languageEventsSince(requestId, lastEventId);
    for (const event of replayed) { delivered.add(event.event_id); res.write(languageStageFrame(event)); }
    res.write(`: replayed ${replayed.length} language event(s) after ${lastEventId ?? "the beginning"}\n\n`);
    let unsubscribe = () => {};
    const finishIfTerminal = (event: { event_id: string; terminal: boolean }) => {
      if (!event.terminal) return;
      unsubscribe();
      try { res.end(); } catch { /* browser disconnected */ }
    };
    if (replayed.some((event) => event.terminal)) { try { res.end(); } catch { /* browser disconnected */ } return; }
    unsubscribe = onLanguageStage(requestId, (event) => {
      if (delivered.has(event.event_id)) return;
      delivered.add(event.event_id);
      try { res.write(languageStageFrame(event)); } catch { unsubscribe(); }
      finishIfTerminal(event);
    });
    req.on("close", unsubscribe);
    res.on("close", unsubscribe);
    return;
  }

  /**
   * Canonical Owner Surface language ingress.
   *
   * Conversation remains isolated. When Owner text uniquely matches a
   * registered connector capability, this reuses the existing POST /chat
   * submitOwnerCommand forward — it does not add a second router.
   */
  if (req.method === "GET" && req.url?.startsWith("/owner/language?")) {
    const params = new URL(req.url, "http://127.0.0.1").searchParams;
    const text = params.get("text") ?? "";
    if (text.trim() === "") { sendJson(res, 400, { error: "text required" }); return; }
    const requestId = params.get("request_id") ?? newEnvelopeId();
    const traceId = params.get("trace_id") ?? requestId;
    publishLanguageStage(requestId, { stage: "OWNER_TEXT_RECEIVED", status: "COMPLETED", detail: "Core รับข้อความ Owner แล้ว", program_id: "owner-command-http", source_file: "transport/owner-command-http/server.ts", source_function: "createServer callback (/owner/language)", source_line: 702, evidence_ref: null, input_summary: text, operation_summary: "รับข้อความ Owner ผ่าน HTTP", reason: "เริ่มต้น read-only language request", decision: "ACCEPTED", next_program: "owner-command-semantics", next_action: "ตีความความหมาย" }, "transport/owner-command-http/server.ts#owner/language", traceId);
    // FLIP_PRODUCTION_OWNER_CONVERSATION_TO_ISOLATED_RUNTIME (Owner UNLOCK,
    // 2026-09-06): resolution now happens in a separate OS process, so the
    // fine-grained SEMANTIC_INTERPRETATION_COMPLETED/RELATIONSHIP_LOOKUP_*
    // stage events that `onStage` used to relay in real time can no longer
    // be observed mid-resolution without inventing a second IPC channel
    // (forbidden by this UNLOCK's scope). What this file still emits, from
    // its own process, using the SAME publishLanguageStage/LanguageStageType
    // this endpoint already had: a start bracket now, and a terminal
    // COMPLETED/FAILED bracket when the runtime replies — enough for
    // `GET /owner/language-events`'s SSE stream to always terminate, at
    // coarser granularity than before. The endpoint's own JSON response
    // shape below is unchanged.
    void (async () => {
      let result: ConversationResult;
      try {
        result = await conversationRuntime().request({
          request_id: requestId,
          trace_id: traceId,
          owner_identity: { identity_id: "identity-owner-language-read-only", kind: "human" },
          text,
          persist: false,
        }, 120_000, (event) => {
          const stage = event as { stage?: string; status?: "STARTED" | "COMPLETED" | "FAILED"; detail?: string; event_id?: string; program_id?: string | null; source_file?: string | null; source_function?: string | null; source_line?: number | null; evidence_ref?: string | null; input_summary?: string | null; operation_summary?: string | null; output_summary?: string | null; reason?: string | null; decision?: string | null; next_program?: string | null; next_action?: string | null; target_type?: string | null; target_id?: string | null; target_display_name?: string | null; blocker_kind?: string | null; blocker_detail?: string | null };
          if (!stage.stage || !stage.status || typeof stage.detail !== "string") return;
          publishLanguageStage(requestId, { stage: stage.stage as never, status: stage.status, detail: stage.detail, event_id: stage.event_id, program_id: stage.program_id, source_file: stage.source_file, source_function: stage.source_function, source_line: stage.source_line, evidence_ref: stage.evidence_ref, input_summary: stage.input_summary, operation_summary: stage.operation_summary, output_summary: stage.output_summary, reason: stage.reason, decision: stage.decision, next_program: stage.next_program, next_action: stage.next_action, target_type: stage.target_type, target_id: stage.target_id, target_display_name: stage.target_display_name, blocker_kind: stage.blocker_kind, blocker_detail: stage.blocker_detail }, "core:control/owner-command-semantics/resolver.ts", traceId);
        });
      } catch (error) {
        // FAIL CLOSED — never resolveOwnerCommandSemantics() in-process.
        publishLanguageStage(requestId, { stage: "LANGUAGE_PROCESSOR_FAILED", status: "FAILED", detail: error instanceof Error ? error.message : String(error), program_id: "owner-command-http", source_file: "transport/owner-command-http/server.ts", source_function: "createServer callback (/owner/language)", source_line: 731, evidence_ref: null }, "transport/owner-command-http/server.ts#owner/language", traceId);
        sendJson(res, 503, { error: "CONVERSATION_RUNTIME_UNAVAILABLE", detail: error instanceof Error ? error.message : String(error) });
        return;
      }
      sendJson(res, 200, await languageBodyWithExistingCommandForward(result, text, req));
    })();
    return;
  }
  if (req.method === "GET" && req.url?.startsWith("/owner/response")) {
    const params = new URL(req.url, "http://127.0.0.1").searchParams;
    const requestId = params.get("request_id");
    const state = requestId ? peekOwnerResponse(requestId) : latestOwnerResponse();
    if (!state) { sendJson(res, 404, { error: "OWNER_RESPONSE_NOT_FOUND", render_from: "owner_response_state" }); return; }
    sendJson(res, 200, {
      schema: "OWNER_RESPONSE_PROJECTION_V1",
      render_from: "owner_response_state",
      owner_response_state: state,
      owner_screen: presentOwnerResponse(state),
    });
    return;
  }
  if (req.method === "POST" && req.url === "/owner/display-payload") {
    void readBody(req).then(async (raw) => {
      try {
        const body = JSON.parse(raw) as { canonical_result?: unknown };
        if (!body.canonical_result || typeof body.canonical_result !== "object" || Array.isArray(body.canonical_result)) { sendJson(res, 400, { error: "canonical_result required" }); return; }
        sendJson(res, 200, projectOwnerDisplayPayload(body.canonical_result as Record<string, unknown>));
      } catch { sendJson(res, 400, { error: "invalid JSON body" }); }
    });
    return;
  }
  if (req.method === "POST" && req.url === "/workers/bootstrap") {
    void readBody(req).then((raw) => { try { const result = issueBootstrapChallenge(JSON.parse(raw)); sendJson(res, "error" in result ? 400 : 201, result); } catch { sendJson(res, 400, { error: "invalid JSON body" }); } });
    return;
  }
  const probeMatch = req.url?.match(/^\/workers\/bootstrap\/([^/?]+)\/probe$/);
  if (req.method === "POST" && probeMatch) {
    // completeBootstrapProbe is async: without awaiting it this handler serialized a
    // pending Promise and answered "{}" while the registration had actually succeeded.
    void readBody(req).then(async (raw) => { try { const result = await completeBootstrapProbe({ ...JSON.parse(raw), challenge_id: decodeURIComponent(probeMatch[1]) }); sendJson(res, "error" in result ? 400 : 200, result); } catch { sendJson(res, 400, { error: "invalid JSON body" }); } });
    return;
  }
  // ชั้นแรกของลำดับ canonical มาก่อน /command เสมอ — ภาษาคนไม่ต้องรู้จักคำว่า command
  if (req.method === "POST" && req.url === "/chat") {
    void handleChat(req, res);
    return;
  }
  if (req.method === "POST" && req.url === "/command") {
    void handleCommand(req, res);
    return;
  }
  if (req.method === "POST" && req.url === "/local/operation") {
    const denied = coreNodeUnavailableForCapability("control/owner-command/local-read-operations");
    if (denied) {
      sendJson(res, 503, denied);
      return;
    }
    void readBody(req).then(async (raw) => { try { const value = await executeLocalRead(JSON.parse(raw)); sendJson(res, (value as any).result?.status === "BLOCKED" ? 403 : 200, value); } catch { sendJson(res, 400, { error: "invalid JSON body" }); } });
    return;
  }
  /**
   * OWNER COMMAND -> ROUTER (Owner, CONNECT_OWNER_SURFACE_TO_EXISTING_COMMAND_ENVELOPE_PATH).
   *
   * `control/owner-command/`'s own header calls submitOwnerCommand "the single
   * public entry point" — it สร้าง CommandEnvelope, เรียก semantics, ส่งเข้า
   * routeOwnerCommand, ติดตาม lifecycle แล้วคืน work_id ครบในครั้งเดียว และเมื่อ
   * router จำแนกได้เป็น capability `agent-host` มันจะเข้า runAgentHostStep ซึ่ง
   * เป็นที่เดียวที่ buildAgentHostWorkOrder ผลิต WorkOrder ที่มี agent_run
   *
   * แต่ไม่มี transport ใดในระบบเรียกมันเลย — วัดแล้ว 0 ผู้เรียกใน production
   * ผลคือข้อความจากหน้าจอ Owner ไปได้ไกลสุดแค่ owner-backbone ซึ่งไม่เคยสร้าง
   * envelope และไม่เคยถึง Agent เส้นนี้คือการต่อท่อที่ขาดนั้น ไม่ใช่ตัวแปลใหม่:
   * ข้อความดิบเข้าไปเหมือนเดิม กฎการแปลงเป็น WorkOrder ยังเป็นของ router ทั้งหมด
   */
  /**
   * OWNER TURN — CLASSIFICATION WITHOUT EXECUTION.
   *
   * หน้าจอ Owner มีช่องพิมพ์ช่องเดียว แต่ข้อความที่พิมพ์เข้ามามีสองชนิดปนกัน:
   * คำถาม (ตอบได้ทันที ไม่กระทบอะไร) กับคำสั่งให้ลงมือ (ต้องให้ Owner ยืนยันก่อน)
   * เส้นนี้ตอบว่า "ถ้าส่งข้อความนี้จริง มันจะไปที่ capability ไหน" โดยไม่รันอะไรเลย
   *
   * ตัวตัดสินคือ `previewOwnerCommand` ที่ control/owner-command/ มีอยู่แล้วและ
   * เขียนไว้เพื่อการนี้โดยตรง ("so a caller — or a confirmation prompt — can show
   * the Owner which capability a command WOULD go to before it actually runs")
   * ไม่ใช่ตัวจำแนกตัวใหม่ และไม่ใช่ LLM — เป็น router ตัวเดิมที่เป็นเจ้าของกฎนี้อยู่แล้ว
   *
   * เบราว์เซอร์ห้ามเป็นคนจำแนกเอง: ก่อนหน้านี้ chat.mjs มีตาราง keyword ของตัวเอง
   * ที่รู้จัก service แค่ 6 ตัว ทำให้ความสามารถที่เหลือของระบบเข้าไม่ถึงช่องพิมพ์เลย
   */
  /**
   * คำถามที่ Agent ถามค้างไว้และยังไม่ได้คำตอบ (Owner, USE_EXISTING_CONTINUATION_MODEL ข้อ 3)
   *
   * ไม่ใช่สโตร์บทสนทนาตัวใหม่ — อ่านจากสถานะงานที่มีอยู่แล้ว
   * (Task.status = WAITING_OWNER_DECISION + Task.next_action) ซึ่งเป็น
   * สถานะเดียวกับที่ `ownerDecision()` ยอมรับคำตอบ
   *
   * `conversation_id` ที่คืนไปคือ command_id ของคำสั่งต้นเรื่อง หน้าจอจึงผูก
   * คำถามกลับเข้าบทสนทนาเดิมได้โดยไม่ต้องมีคีย์ของตัวเอง
   */
/**
 * หน้าที่: ภาพ "ตอนนี้ระบบทำอะไรอยู่" ของคำสั่งหนึ่ง ประกอบจากหลักฐานที่ถูกเขียน
 * ไว้จริงระหว่างทาง — ไม่ใช่กลไกใหม่ และไม่ใช่การเดาจากเวลา
 *
 * กฎเดียวที่ทั้งไฟล์นี้ยึด: ขั้นตอนหนึ่งจะขึ้นว่า "ทำแล้ว" ได้ก็ต่อเมื่อมีของจริงที่
 * ชี้ได้ว่ามันเกิด (แถวใน semantic-history, แถวการจอง worktree, แถว evidence)
 * ไม่มีขั้นไหนถูกทำเครื่องหมายเพราะ "น่าจะถึงแล้ว"
 *
 * มีสถานะ ACTIVE อยู่กรณีเดียวและมันพิสูจน์ได้: คำสั่งถูกส่งให้ Agent แล้ว
 * (มี DNA_OS_AGENT_INPUT_V1) แต่ยังไม่มีหลักฐานว่าโปรเซสจบ (ยังไม่มี exit code)
 * — นั่นคือ "กำลังทำงานอยู่" ที่อ่านจากของจริง ไม่ใช่คำที่แต่งขึ้น
 */
interface ActivityStage {
  id: string;
  label: string;
  state: "DONE" | "ACTIVE" | "PENDING";
  /** ของจริงที่ทำให้ขั้นนี้ถูกนับ — ว่างเมื่อยัง PENDING */
  proof: string | null;
}

/**
 * GATE 0 — identity ที่ "เขียน" กับที่ "อ่าน" ต้องเป็นตัวเดียวกัน
 *
 * `resolveOwnerIdentity` เติม "supabase-" ให้ทุก ownerIdentity ที่ส่งเข้ามาจริง
 * แถวประวัติจึงถูกเขียนใต้ `supabase-<id>` ขณะที่ /owner/activity รับ `identity`
 * ดิบจาก query string มาใช้ตรง ๆ — พิสูจน์สดแล้วว่าคำสั่งที่เพิ่งส่งไม่ปรากฏบน
 * หน้าจอเลยแม้แต่ครั้งเดียวใน 86 poll เพราะคนละ bucket
 *
 * ไม่บังคับให้เหลือรูปเดียวย้อนหลัง เพราะแถวเก่าหลายร้อยแถวถูกเขียนด้วยรูปดิบ
 * ไปแล้ว การอ่านทั้งสองรูปแล้วรวมกันทำให้ทั้งของเก่าและของใหม่มองเห็นได้
 */
function identityCandidates(raw: string): readonly string[] {
  const bare = raw.startsWith("supabase-") ? raw.slice("supabase-".length) : raw;
  return [...new Set([raw, `supabase-${bare}`, bare])];
}

/** สถานะที่ task ยังเดินต่อได้ — ตราบใดที่อยู่ในชุดนี้ OWNER_RESULT ไม่ใช่จุดจบ */
const LIVE_TASK_STATES = new Set(["RECEIVED", "ROUTING", "POLICY_CHECK", "EXECUTING", "VERIFYING"]);

/**
 * GATE 0 — ช่วงที่งานเดินอยู่แต่ยังไม่ผูก task
 *
 * พิสูจน์สดแล้วว่ามีหน้าต่างจริงราว 1.25 วินาทีระหว่าง envelope `command_received`
 * กับ `admitted` ที่ยังไม่มี task_id ให้ readTaskState อ่าน ถ้าตอบ NO_TASK ช่วงนั้น
 * หน้าจอจะบอกว่า "ไม่มีงาน" ทั้งที่งานกำลังเดิน — ผิดจากความจริง
 *
 * `stage` ของ envelope เป็นสถานะจริงของ work ที่ input-gateway เขียนเอง จึงใช้เป็น
 * แหล่งความจริงลำดับสองได้ ไม่ใช่การเดา และไม่ได้มาจากข้อความของ Agent
 */
const ENVELOPE_STAGE_STATE: Readonly<Record<string, string>> = {
  command_received: "RUNNING",
  admitted: "RUNNING",
  dispatched: "RUNNING",
  completed: "COMPLETED",
  blocked: "BLOCKED",
  failed: "FAILED",
};
const LIVE_ENVELOPE_STAGES = new Set(["command_received", "admitted", "dispatched"]);

function buildOwnerActivity(identity: string, commandIdInput: string | null): Record<string, unknown> {
  const rows: HistoryRecord[] = [];
  const seenRows = new Set<string>();
  for (const candidate of identityCandidates(identity)) {
    const h = readHistoryForIdentity(candidate);
    if (!h.found) continue;
    for (const r of h.value) {
      const key = `${r.command_id}|${r.recorded_at}|${r.kind ?? "RESOLUTION"}`;
      if (seenRows.has(key)) continue;
      seenRows.add(key);
      rows.push(r);
    }
  }
  /**
   * คำสั่งล่าสุด = แถวที่ใหม่ที่สุด ไม่ว่ามันจะเป็นชนิดไหน
   *
   * เดิมยึด RAW_MESSAGE ซึ่งผิด: เส้น /owner/submit-command ไม่ได้เขียนแถวชนิดนั้น
   * (มันเรียก resolveOwnerCommandSemantics ตรง ไม่ผ่าน translateOwnerMessage)
   * ผลคือ projection ชี้ไปที่คำสั่งทดสอบของเมื่อวานแทนคำสั่งที่เพิ่งส่ง
   */
  const newest = [...rows].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at)).at(-1) ?? null;
  const commandId = commandIdInput ?? newest?.command_id ?? null;
  if (commandId === null) return { found: false, command_id: null, running: false, stages: [], details: {}, owner_text: null };

  const mine = rows.filter((r) => r.command_id === commandId);
  const rowOf = (kind: string) => mine.find((r) => (r.kind ?? "RESOLUTION") === kind) ?? null;
  // แถวแรกสุดของคำสั่งนี้คือหลักฐานว่า "รับคำสั่งแล้ว" — ชนิดไหนก็ได้ที่มาถึงก่อน
  const first = [...mine].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))[0] ?? null;
  const raw = rowOf("RAW_MESSAGE") ?? first;
  const resolution = rowOf("RESOLUTION");
  const taskLink = rowOf("TASK_LINK");
  const ownerResult = rowOf("OWNER_RESULT");

  /**
   * GATE 0 — command_id -> work_id -> task_id ต้องมาจากทะเบียนจริง
   *
   * `envelopes.jsonl` คือที่เดียวที่ถือ work_id และเป็นสายที่ /owner/submit-command
   * เขียนจริง ตัวฉายนี้เคยไม่อ่านมันเลย work_id จึงเกิดตอน submit แล้วหายไป
   * ไม่ประกอบ task id ขึ้นเอง: ลำดับการหาคือ envelope -> TASK_LINK -> ไม่พบ = null
   */
  const lineage = lineageForCommand(commandId);
  const lineageNewestFirst = [...lineage].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
  const workId = lineageNewestFirst.find((r) => typeof r.work_id === "string" && r.work_id !== "")?.work_id ?? null;
  const envelopeTaskId = lineageNewestFirst.find((r) => typeof r.task_id === "string" && r.task_id !== "")?.task_id ?? null;
  const realTaskId = envelopeTaskId ?? taskLink?.task_id ?? null;
  const latestEnvelope = lineageNewestFirst[0] ?? null;

  /** สถานะสดจาก gateway — ไม่ใช่ข้อความของ Agent และไม่ใช่การอนุมานจาก evidence */
  const liveTask = realTaskId !== null ? readTaskState(realTaskId) : null;
  const liveTaskState = liveTask !== null && liveTask.found ? liveTask.value : null;
  const liveTaskSource = liveTask !== null && liveTask.found ? liveTask.source : null;

  const lineageTaskIds = new Set<string>();
  if (realTaskId) lineageTaskIds.add(realTaskId);
  for (const row of lineageNewestFirst) {
    if (typeof row.task_id === "string" && row.task_id !== "") lineageTaskIds.add(row.task_id);
  }
  const agentEvidence = loadAllEvidence().filter((row) =>
    row.correlation_id === commandId
    || (workId !== null && row.work_order_id === workId)
    || lineageTaskIds.has(row.task_id),
  );
  const evOf = (needle: string) => agentEvidence.find((e) => e.source.endsWith(needle)) ?? null;
  const agentInput = evOf("#DNA_OS_AGENT_INPUT_V1");
  const messages = agentEvidence.filter((e) => e.source.endsWith("#agent-message"));
  const launch = agentEvidence.find((e) => {
    const p = e.payload as { launch?: unknown } | null;
    return Boolean(p && typeof p === "object" && p.launch);
  });
  const verification = agentEvidence.find((e) => e.kind === "verification");
  const reservation = workId !== null
    ? listReservations().filter((r) => r.work_id === workId).at(-1) ?? null
    : null;

  const launchPayload = (launch?.payload as { launch?: Record<string, unknown> } | null)?.launch ?? null;
  /**
   * GATE 0 ข้อ 4 — OWNER_RESULT ไม่ใช่จุดจบถ้า task ยังเปลี่ยนสถานะต่อได้
   *
   * เดิม `running = ownerResult === null` ซึ่งผิด: /owner/submit-command เขียน
   * OWNER_RESULT ภายใน 41 ms แล้วหน้าจอหลุดจาก running ทันที ทั้งที่ task จริง
   * เพิ่งเริ่มเดิน และเคยพบเคสที่ task กลายเป็น BLOCKED หลังจากนั้นชั่วโมงครึ่ง
   * ถ้ามี task จริงให้ยึดสถานะของ task เป็นหลัก ไม่มีจึงถอยไปใช้เกณฑ์เดิม
   */
  const envelopeState = latestEnvelope !== null ? (ENVELOPE_STAGE_STATE[latestEnvelope.stage] ?? null) : null;
  const running = liveTaskState !== null
    ? LIVE_TASK_STATES.has(liveTaskState.status)
    : latestEnvelope !== null ? LIVE_ENVELOPE_STAGES.has(latestEnvelope.stage) : ownerResult === null;

  const stage = (id: string, label: string, proof: string | null, active = false): ActivityStage =>
    ({ id, label, state: proof !== null ? "DONE" : active ? "ACTIVE" : "PENDING", proof });

  const agentStillRunning = agentInput !== null && launchPayload === null;

  const stages: ActivityStage[] = [
    stage("received", "รับคำสั่งแล้ว", first ? `semantic-history:${first.kind ?? "RESOLUTION"}@${first.recorded_at}` : null),
    stage("interpreted", "ตีความคำสั่ง", resolution ? `semantic-history:RESOLUTION@${resolution.recorded_at}` : null),
    stage("workspace", "เตรียมพื้นที่ทำงานแยก", reservation ? `reservation:${reservation.reservation_id}` : null),
    stage("branch", "สร้างกิ่งของงาน", reservation ? `branch_ref:${reservation.branch_ref}` : null),
    stage("dispatched", "ส่งคำสั่งให้ Agent", agentInput ? `evidence:${agentInput.evidence_id}` : null),
    stage("agent", messages.length > 0 ? `Agent ตอบกลับ ${messages.length} ข้อความ` : "Agent กำลังทำงาน",
      messages.length > 0 ? `evidence:${messages[messages.length - 1]!.evidence_id}` : null, agentStillRunning),
    stage("finished", "Agent ทำงานจบ", launchPayload ? `exit_code:${String(launchPayload.exitCode)}` : null, agentStillRunning),
    stage("verified", "ตรวจผลของ Agent", verification ? `evidence:${verification.evidence_id}` : null),
    stage("answered", "สรุปให้เจ้าของ", ownerResult ? `semantic-history:OWNER_RESULT@${ownerResult.recorded_at}` : null),
  ];

  const resultPayload = (ownerResult?.owner_visible_result ?? null) as Record<string, unknown> | null;
  const activity = projectOwnerActivity(commandId);
  const compactGroups = activity.processing_groups.map((group) => ({
    processing_group_id: group.processing_group_id,
    title: group.human_readable,
    actor_icon_ref: group.actor_icon_ref,
    working: group.working,
    status: group.status,
    details_available: true as const,
    details_reference: group.details_reference,
    steps: group.steps.map((step) => ({
      step_id: step.step_id,
      human_readable: step.human_readable,
      status: step.status,
      actor_icon_ref: step.actor_icon_ref,
    })),
  }));
  return {
    found: true,
    command_id: commandId,
    owner_text: raw?.raw_text ?? resolution?.raw_text ?? null,
    running,
    /**
     * GATE 0 ข้อ 5 — แปดฟิลด์ที่ Owner ต้องเห็น อยู่ระดับบนสุดของคำตอบ
     * current_state มาจาก gateway task store ตรง ๆ ไม่ใช่จากข้อความของ Agent
     * ไม่มี task จริง = บอก NO_TASK ไม่ใช่เดาว่า PENDING
     */
    status: liveTaskState?.status ?? envelopeState ?? (resultPayload?.status as string | undefined) ?? (agentStillRunning ? "RUNNING" : "PENDING"),
    work_id: workId,
    task_id: realTaskId,
    current_state: liveTaskState?.status ?? envelopeState ?? (realTaskId === null ? "NO_TASK" : "TASK_NOT_IN_STORE"),
    current_step: (stages.find((st) => st.state !== "DONE") ?? stages[stages.length - 1] ?? null)?.id ?? null,
    source_tool: liveTaskSource ?? (latestEnvelope !== null ? `control/owner-command/input-gateway.ts#${latestEnvelope.stage}` : null),
    evidence_id: verification?.evidence_id ?? agentEvidence.at(-1)?.evidence_id ?? null,
    updated_at: liveTaskState?.updated_at ?? latestEnvelope?.recorded_at ?? ownerResult?.recorded_at ?? null,
    /**
     * ADDITIVE (Owner, 2026-09-05 ข้อ 8) — สถานะทรัพยากรที่คำสั่งนี้ใช้จริง
     *
     * แปดฟิลด์เดิมด้านบนไม่ถูกแตะเลย ส่วนนี้อ่านจากที่เก็บของตัวเองที่
     * control/owner-command/ เขียนไว้ตอน resolve เจตนา ไม่ได้ประกอบขึ้นจาก
     * ข้อความของ Agent และไม่ได้แสดงสารบัญทรัพยากรทั้งหมด — มีเฉพาะตัวที่
     * คำสั่งนี้ต้องใช้ ไม่มีแถว = คำสั่งนี้ไม่ต้องใช้ทรัพยากรภายนอก
     */
    resource_resolution: (() => {
      const r = resolutionFor(commandId);
      if (r === null) return null;
      return { required_capabilities: r.required_capabilities, selected_resources: r.selected_resources,
        unresolved_capabilities: r.unresolved_capabilities };
    })(),
    resource_execution: (() => {
      const r = resolutionFor(commandId);
      if (r === null) return null;
      const running = r.executions.find((e) => e.status === "STARTED") ?? null;
      return { active_resource: running?.resource_id ?? null, active_capability: running?.capability_id ?? null,
        executions: r.executions, agent_invoked: r.agent_invoked };
    })(),
    stages,
    processing_groups: compactGroups,
    agent_messages: compactGroups.filter((group) => group.processing_group_id.startsWith("pg-agent-")).map((group) => group.title),
    next_action: (resultPayload?.next_action as string | null | undefined) ?? null,
    details: {
      command_id: commandId,
      task_id: realTaskId ?? (resultPayload?.task_id as string | undefined) ?? null,
      work_id: workId,
      agent_task_id: realTaskId,
      work_order_id: workId,
      reservation_id: reservation?.reservation_id ?? null,
      branch_ref: reservation?.branch_ref ?? null,
      worktree_path: reservation?.worktree_path ?? null,
      base_commit_sha: reservation?.base_commit_sha ?? null,
      launch_id: (launchPayload?.launchId as string | undefined) ?? null,
      agent_pid: (launchPayload?.pid as number | undefined) ?? null,
      exit_code: launchPayload ? (launchPayload.exitCode as number | null) : null,
      agent_cwd: (launchPayload?.cwd as string | undefined) ?? null,
      evidence_ids: agentEvidence.map((e) => e.evidence_id),
      verification_id: verification?.evidence_id ?? null,
      pipeline_lineage: activity.lineage,
      pipeline_details_references: compactGroups.map((group) => group.details_reference),
      agent_message_evidence_refs: messages.map((m) => m.evidence_id),
    },
  };
}

  /**
   * สายรายงานความคืบหน้าให้หน้าจอ Owner — อ่านอย่างเดียว ไม่สั่งอะไรทั้งสิ้น
   * ไม่ระบุ command_id = คำสั่งล่าสุดของเจ้าของคนนั้น
   */
  /**
   * ช่องตั้งค่า credential ของเจ้าของ — ตัวจริงอยู่ที่ ./owner-credential-routes.ts
   * ไฟล์นี้แค่แกะ body/query แล้วส่งต่อ ไม่ตัดสินสิทธิ์เอง และไม่แตะค่าความลับ
   */
  if (req.url?.startsWith("/owner/credential")) {
    const parsed = new URL(req.url, "http://127.0.0.1");
    void (async () => {
      let parsedBody: unknown = null;
      if (req.method === "POST") {
        const raw = await readBody(req);
        try { parsedBody = JSON.parse(raw); } catch { sendJson(res, 400, { error: "invalid JSON body" }); return; }
      }
      const reply = await handleOwnerCredentialRoute(req.method ?? "GET", parsed.pathname, parsed.searchParams, parsedBody);
      if (!reply) { sendJson(res, 404, { error: "not found" }); return; }
      sendJson(res, reply.status, reply.body);
    })();
    return;
  }

  /**
   * Google Workspace OAuth *client* Owner admission — config + Keychain secret only.
   * Never begins Google login; never returns client_secret.
   */
  if (req.url?.startsWith("/owner/google-workspace/oauth-client")) {
    const parsed = new URL(req.url, "http://127.0.0.1");
    void (async () => {
      let parsedBody: unknown = null;
      if (req.method === "POST") {
        const raw = await readBody(req);
        try { parsedBody = JSON.parse(raw); } catch { sendJson(res, 400, { error: "invalid JSON body" }); return; }
      }
      const discoveryReply = await handleGoogleOauthDiscoveryRoute(req.method ?? "GET", parsed.pathname, parsed.searchParams, parsedBody);
      if (discoveryReply) { sendJson(res, discoveryReply.status, discoveryReply.body); return; }
      const reply = await handleGoogleOauthClientAdmissionRoute(req.method ?? "GET", parsed.pathname, parsed.searchParams, parsedBody);
      if (!reply) { sendJson(res, 404, { error: "not found" }); return; }
      sendJson(res, reply.status, reply.body);
    })();
    return;
  }

  /**
   * Google Workspace OAuth — thin gate only. Lifecycle owns exchange/Keychain.
   * Never invent client_id/secret here; CONFIGURATION_REQUIRED until Owner admits.
   */
  if (req.url?.startsWith("/oauth/google/workspace")) {
    const parsed = new URL(req.url, "http://127.0.0.1");
    void (async () => {
      let parsedBody: unknown = null;
      if (req.method === "POST") {
        const raw = await readBody(req);
        try { parsedBody = JSON.parse(raw); } catch { sendJson(res, 400, { error: "invalid JSON body" }); return; }
      }
      const reply = await handleGoogleOauthRoute(req.method ?? "GET", parsed.pathname, parsed.searchParams, parsedBody);
      if (!reply) { sendJson(res, 404, { error: "not found" }); return; }
      if (reply.contentType?.startsWith("text/html")) {
        res.writeHead(reply.status, { "content-type": reply.contentType });
        res.end(renderGoogleOauthHtml(reply.body));
        return;
      }
      sendJson(res, reply.status, reply.body);
    })();
    return;
  }

  /**
   * แผนก่อนลงมือ — เริ่มแผนแล้วคืน plan_id ทันที ไม่รอให้จบ
   * หน้าจอจึงตามดูความคืบหน้าจริงได้ระหว่างทาง ไม่ใช่เห็นทีเดียวตอนจบ
   */
  if (req.method === "POST" && req.url === "/owner/plan") {
    void readBody(req).then((raw) => {
      try {
        const body = JSON.parse(raw) as { commandText?: unknown; command_id?: unknown };
        const text = typeof body.commandText === "string" ? body.commandText : "";
        if (text.trim() === "") { sendJson(res, 400, { error: "commandText required" }); return; }
        const commandId = typeof body.command_id === "string" && body.command_id !== "" ? body.command_id : `plan_${Date.now()}`;
        // ปล่อยให้เดินต่อเบื้องหลัง — ผลอ่านได้จาก GET /owner/plan
        void runPreExecutionPlan(commandId, text);
        sendJson(res, 202, { command_id: commandId, started: true });
      } catch { sendJson(res, 400, { error: "invalid JSON body" }); }
    });
    return;
  }
  if (req.method === "GET" && req.url?.startsWith("/owner/plan")) {
    const commandId = new URL(req.url, "http://127.0.0.1").searchParams.get("command_id");
    const plan = commandId ? latestPlanFor(commandId) : latestPlan();
    sendJson(res, 200, plan ?? { found: false });
    return;
  }

  /**
   * สถานะวงจรปฏิบัติการ — อ่านอย่างเดียว
   *
   * เป็นเส้นอ่านตามแบบเดิม (/owner/plan, /owner/activity) โดยเจตนา: เจ้าของสั่งไว้ว่า
   * ห้ามลงทะเบียน :5181 เป็นผู้บริโภคของเลน SYSTEM_STATE ในรอบนี้ หน้าจอจึงต้อง
   * *มาอ่าน* ความจริง ไม่ใช่ให้ระบบ *ส่ง* ไปหาหน้าจอ
   *
   * ทุกค่าคำนวณสดจากหลักฐานจริงทุกครั้งที่เรียก ไม่มีการเก็บสถานะขั้นไว้ที่ใด
   */
  if (req.method === "GET" && req.url?.startsWith("/owner/lifecycle")) {
    try {
      const stages = deriveLifecycle();
      sendJson(res, 200, { available: true, stages, continuation: decideContinuation(stages) });
    } catch (error) {
      // อ่านไม่ได้ ≠ ไม่มีขั้น — บอกตรง ๆ ว่าอ่านไม่ได้ ไม่ส่งรายการว่างที่ดูเหมือนจบแล้ว
      sendJson(res, 200, { available: false, stages: [], continuation: null,
        reason: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (req.method === "GET" && req.url?.startsWith("/owner/activity")) {
    const params = new URL(req.url, "http://127.0.0.1").searchParams;
    sendJson(res, 200, buildOwnerActivity(params.get("identity") ?? "identity-deadboard-owner", params.get("command_id")));
    return;
  }

  if (req.method === "GET" && req.url?.startsWith("/owner/pending-question")) {
    const identity = new URL(req.url, "http://127.0.0.1").searchParams.get("identity") ?? "identity-deadboard-owner";
    const pending = findOpenOwnerQuestion(identity);
    sendJson(res, 200, pending
      ? { pending: true, task_id: pending.task_id, conversation_id: pending.memory.conversation_id, parent_task_id: pending.memory.parent_task_id, question: pending.next_action, intent_text: pending.intent_text, asked_at: pending.updated_at }
      : { pending: false, task_id: null, conversation_id: null, parent_task_id: null, question: null, intent_text: null, asked_at: null });
    return;
  }

  /**
   * ทางตรงสำหรับ "ทำ"/"ไม่ทำ" — เรียก `ownerDecision` ตัวเดิมด้วยชุด adapter
   * เดียวกับผู้เรียก production ที่มีอยู่ (dna-os-circuit ใช้ DEFAULT_AGENT_WORKERS)
   * ไม่ได้ทำ continuation ที่นี่ นั่นเป็นหน้าที่ของ submitOwnerCommand
   */
  if (req.method === "POST" && req.url === "/owner/decision") {
    void readBody(req).then(async (raw) => {
      try {
        const body = JSON.parse(raw) as { task_id?: unknown; decision?: unknown };
        const taskId = typeof body.task_id === "string" ? body.task_id : "";
        const decision = body.decision === "ไม่ทำ" ? "ไม่ทำ" : body.decision === "ทำ" ? "ทำ" : null;
        if (taskId === "" || decision === null) { sendJson(res, 400, { error: "task_id and decision (ทำ|ไม่ทำ) required" }); return; }
        const task = await ownerDecision(taskId, decision, DEFAULT_AGENT_WORKERS);
        sendJson(res, task ? 200 : 404, task ?? { error: "TASK_NOT_FOUND" });
      } catch (error) { sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) }); }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/owner/preview") {
    void readBody(req).then((raw) => {
      try {
        const body = JSON.parse(raw) as { commandText?: unknown };
        const text = typeof body.commandText === "string" ? body.commandText : "";
        if (text.trim() === "") { sendJson(res, 400, { error: "commandText required" }); return; }
        const outcome = previewOwnerCommand(text);
        sendJson(res, 200, outcome.status === "MATCHED"
          ? { status: outcome.status, capability_id: outcome.capability.capability_id, permission_requirement: outcome.capability.permission_requirement, health_status: outcome.capability.health_status, supported_commands: outcome.capability.supported_commands }
          : outcome);
      } catch { sendJson(res, 400, { error: "invalid JSON body" }); }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/owner/submit-command") {
    void readBody(req).then(async (raw) => {
      try {
        const body = JSON.parse(raw) as Record<string, unknown> & { commandText?: unknown; message?: unknown; ownerIdentity?: { id?: unknown; email?: unknown }; work_id?: unknown; work_id_if_existing?: unknown };
        const text = typeof body.commandText === "string" ? body.commandText : typeof body.message === "string" ? body.message : "";
        if (text.trim() === "") { sendJson(res, 400, { error: "commandText required" }); return; }
        const authenticatedOwner = resolveAuthenticatedOwnerIdentity(req);
        if (!authenticatedOwner) {
          sendJson(res, 401, { error: "OWNER_AUTHENTICATION_REQUIRED", reason_code: "NO_UNAMBIGUOUS_HUMAN_VERIFIED_OWNER_SESSION" });
          return;
        }
        if (body.ownerIdentity?.id !== undefined && body.ownerIdentity.id !== authenticatedOwner.id) {
          sendJson(res, 403, { error: "OWNER_IDENTITY_MISMATCH", reason_code: "CALLER_IDENTITY_DOES_NOT_MATCH_AUTHENTICATED_OWNER" });
          return;
        }
        const ownerIdentity = resolveOwnerIdentity(authenticatedOwner);
        if (!ownerIdentity) { sendJson(res, 401, { error: "authenticated owner identity required" }); return; }
        const requestedWorkId = typeof body.work_id === "string" ? body.work_id : typeof body.work_id_if_existing === "string" ? body.work_id_if_existing : null;
        const presented = ownerPresentedPayload(body);
        const outcome = await submitOwnerCommand(text, ownerIdentity, {
          ...(requestedWorkId ? { work_id: requestedWorkId } : {}),
          ...(presented ? { envelope_payload: presented } : {}),
          ...existingExecutionRouteOptions(ownerIdentity),
        });
        sendJson(res, 200, {
          command_id: outcome.envelope.command_id, work_id: outcome.work_id,
          lifecycle: outcome.lifecycle, result: outcome.result,
          surface: outcome.surface, output_routing: outcome.output_routing,
        });
      } catch (error) {
        sendJson(res, 500, { error: "OWNER_COMMAND_FAILED", detail: error instanceof Error ? error.message : String(error) });
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/owner/intent") {
    void readBody(req).then(async (raw) => { try { const value = await resolveAndExecuteOwnerIntent(JSON.parse(raw)); sendJson(res, 200, value); } catch { sendJson(res, 400, { error: "INVALID_OWNER_INTENT" }); } });
    return;
  }
  if (req.method === "POST" && req.url === "/owner/request") {
    void readBody(req).then(async (raw) => {
      try {
        const body = JSON.parse(raw) as { structured_request?: unknown };
        if (!body.structured_request || typeof body.structured_request !== "object" || Array.isArray(body.structured_request)) {
          sendJson(res, 400, { error: "structured_request required; raw Owner language is not accepted at Core" });
          return;
        }
        sendJson(res, 200, await resolveAndExecuteOwnerIntent(body.structured_request));
      } catch { sendJson(res, 400, { error: "invalid JSON body" }); }
    });
    return;
  }
  if (req.method === "GET" && req.url?.startsWith("/owner/history")) {
    const query = new URL(req.url, "http://127.0.0.1").searchParams;
    // PIPE A: command_id is the correlation authority. When the caller names a
    // command, the answer is THAT command's own record - never the identity's
    // most recent one. An unknown command_id returns not-found rather than
    // silently substituting another command's result.
    const commandId = query.get("command_id");
    if (commandId) {
      const record = readHistoryForCommand(commandId);
      sendJson(res, record.found ? 200 : 404, record.found
        ? { records: [record.value], source: record.source, correlation: "COMMAND_ID" }
        : { records: [], source: record.source, unavailable: record.reason, correlation: "COMMAND_ID" });
      return;
    }
    const identity = query.get("identity") || "identity-deadboard-owner";
    const history = readHistoryForIdentity(identity);
    sendJson(res, 200, history.found ? { records: history.value, source: history.source, correlation: "IDENTITY_SCOPE" } : { records: [], source: history.source, unavailable: history.reason, correlation: "IDENTITY_SCOPE" });
    return;
  }
  if (req.method === "POST" && req.url === "/handoff") {
    void handleAgentHandoff(req, res);
    return;
  }
  if (req.method === "POST" && req.url === "/registry/candidates") { void handleRegistryCandidate(req, res); return; }
  if (req.method === "POST" && req.url === "/registry/update") { void handleRegistryUpdate(req, res); return; }
  const capabilityMatch = req.url?.match(/^\/registry\/capabilities\/([^/?]+)$/);
  if (req.method === "GET" && capabilityMatch) { const item = registrationStore.findCapabilityById(decodeURIComponent(capabilityMatch[1])); sendJson(res, item ? 200 : 404, item ?? { error: "CAPABILITY_NOT_FOUND" }); return; }
  const resourceMatch = req.url?.match(/^\/registry\/resources\/([^/?]+)$/);
  if (req.method === "GET" && resourceMatch) { const item = findResourceById(decodeURIComponent(resourceMatch[1]), registrationStore); sendJson(res, item ? 200 : 404, item ?? { error: "RESOURCE_NOT_FOUND" }); return; }
  if (req.method === "POST" && req.url === "/registry/lookup") { void handleRegistryLookup(req,res); return; }
  const taskMatch = req.url?.match(/^\/task\/([^/?]+)$/);
  if (req.method === "GET" && taskMatch) {
    const taskId = decodeURIComponent(taskMatch[1]);
    const task = getTask(taskId);
    if (!task) {
      sendJson(res, 404, { error: "task not found", task_id: taskId });
      return;
    }
    sendJson(res, 200, { task, result: getResult(taskId), explanation: explain(taskId), handoffs: loadHandoffsForTask(taskId) });
    return;
  }
  if (req.method === "GET" && req.url === "/handoffs") {
    sendJson(res, 200, { handoffs: loadAllHandoffs() });
    return;
  }
  // The REAL software circuit, read-only. Projection lives in
  // `software/system-graph/` and joins producers that already exist; this
  // route only serves it. `?probe=1` costs real health probes, so it is
  // opt-in rather than the default.
  // CAPABILITY ROUTE — ที่เดียวที่ Owner Application ใช้ถามว่า "capability นี้อยู่
  // ที่ไหน" แทนที่จะรู้จัก backend เดียวที่ hardcode ไว้ ชั้นนี้ join ทะเบียนเดิม
  // (canonical + runtime-targets + connection-declarations) ไม่ได้เก็บอะไรเอง
  // และไม่รู้จักชื่อ workflow ใดเลย capability ที่ลงทะเบียนถูกต้องจึง resolve ได้
  // โดยไม่ต้องแก้ route นี้
  if (req.method === "GET" && req.url?.startsWith("/capability/route/")) {
    const ref = decodeURIComponent(req.url.slice("/capability/route/".length).split("?")[0] ?? "");
    if (ref.length === 0) { sendJson(res, 400, { error: "CAPABILITY_REFERENCE_REQUIRED" }); return; }
    void import("../../control/capability-route/host-runtime")
      .then((m) => m.resolveRouteFromDisk(ref))
      // ROUTE_RESOLVED = 200; ทุกสถานะที่เหลือคือ "ยังเรียกไม่ได้" ซึ่งต้องอ่านออก
      // จาก HTTP status ด้วย ไม่ใช่ซ่อนความล้มเหลวไว้หลัง 200
      .then((r) => sendJson(res, r.outcome === "ROUTE_RESOLVED" ? 200 : 404, r))
      .catch((e) => sendJson(res, 500, { error: "ROUTE_RESOLUTION_UNAVAILABLE", detail: e instanceof Error ? e.message : String(e) }));
    return;
  }

  if (req.method === "GET" && req.url === "/canonical/lineage/research-engine/latest") {
    void import("../../connections/research-engine/lineage-bridge")
      .then((m) => sendJson(res, 200, m.readLatestResearchEngineCanonicalLineage()))
      .catch((e) => sendJson(res, 500, { error: "RESEARCH_ENGINE_CANONICAL_LINEAGE_UNAVAILABLE", detail: e instanceof Error ? e.message : String(e) }));
    return;
  }

  if (req.method === "GET" && req.url?.startsWith("/graph/system")) {
    const probeServices = /[?&]probe=1/.test(req.url);
    void import("../../software/system-graph/contract")
      .then((graph) => graph.buildSystemGraph({ probeServices }))
      .then((result) => sendJson(res, 200, result))
      .catch((error) => sendJson(res, 500, { error: "GRAPH_UNAVAILABLE", detail: error instanceof Error ? error.message : String(error) }));
    return;
  }

  // The canonical cross-system APPLICATION records, read-only. Identity and
  // relationships come from `software/registry-database/cross-system-store`;
  // this route only serves them. It resolves nothing on its own and holds no
  // state, so the UI cannot see an application the registry does not have.
  if (req.method === "GET" && req.url?.startsWith("/applications")) {
    void import("../../software/registry-database/cross-system-store")
      .then((cross) => {
        const applications = cross.listEntities()
          .filter((entity) => entity.entity_type === "APPLICATION")
          .map((entity) => ({ ...entity, resolution: cross.resolveApplication(entity.entity_id) }));
        sendJson(res, 200, { applications });
      })
      .catch((error) => sendJson(res, 500, { error: "APPLICATIONS_UNAVAILABLE", detail: error instanceof Error ? error.message : String(error) }));
    return;
  }

  // §1 — the owner-backbone edge. Last, so every existing route keeps
  // priority; it answers only /owner/* and otherwise returns false.
  if (handleOwnerBackboneRoute(req, res)) return;
  sendJson(res, 404, { error: "not found" });
});

const port = Number(process.env.PORT ?? 8791);
const host = process.env.HOST ?? "127.0.0.1";

const isMainModule = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const bindPolicy = evaluateBindPolicy(host, process.env.OWNER_COMMAND_HTTP_SHARED_SECRET);
  if (!bindPolicy.allowed) {
    console.error(`owner-command-http refusing to start: ${bindPolicy.reason}`);
    process.exit(1);
  }
  supervisor = startAgentGatewaySupervisor(DEFAULT_AGENT_WORKERS);

  /**
   * JOINT/VIOLATION -> EVENT INGRESS (Owner, CONNECTION 2 — เปิดในโปรเซสผู้ผลิต)
   *
   * hook ของ `observability/joint-monitor/client.ts` เป็น in-process จึงจับได้
   * เฉพาะสิ่งที่โปรเซสนี้ผลิตเอง โปรเซสนี้คือที่ที่ `control/agent-gateway/
   * gateway.ts#persistStatus` และ `control/command-router/router.ts` ทำงานจริง
   * จึงเป็นผู้ผลิต joint ตัวจริงของระบบ — ไม่ใช่ joint-monitor collector ซึ่ง
   * เป็นแค่ปลายทางที่รับ POST
   *
   * ไม่เปลี่ยนพฤติกรรมการรายงานเดิม: `reportJoint`/`reportViolation` ยัง POST
   * ไปที่ collector เหมือนเดิมทุกประการ สายนี้เป็นการแตกแขนงเพิ่มที่จุดผลิต
   *
   * ไม่เปิด Agent อัตโนมัติ: เส้นทางที่ decideAction ชี้ไปยัง agent-gateway
   * หยุดที่ EXECUTION_DISABLED ใน route-dispatch.ts ตามนโยบายที่ยังไม่เปิด
   */
  jointBridge = startJointEventBridge(intakeEvent);

  /**
   * WRITE AUDIT -> CORRECTIVE WORK (Owner, CONNECTION 3 — เปิดในโปรเซสผู้ผลิต)
   *
   * `execution/file-write/audit.ts#onWriteAudit` เป็น in-process เช่นเดียวกับ
   * hook ของ joint-monitor ด้านบน โปรเซสนี้คือที่ที่ `control/agent-gateway/
   * adapters/ai-write-adapter.ts` เรียก `executeFileWrite` /
   * `executeFileWriteSandboxed` จริง (ทั้งสองทางบันทึก audit ในโปรเซสเดียวกัน
   * ไม่มีการ fork) จึงเป็นผู้ผลิตเหตุการณ์ตัวจริง
   *
   * ก่อนหน้านี้ `startWriteFailureBridge` ถูกเรียกจาก tests/__pipeline__/
   * เท่านั้น การปฏิเสธจึงหยุดอยู่ที่ write-audit-log.json และไม่มีผู้บริโภค
   * ใน production — Owner ต้องเปิดไฟล์อ่านเองถึงจะรู้ว่าอะไรพัง
   *
   * ขอบเขตของสายนี้: เฉพาะเหตุการณ์ที่ผลิต ณ เวลาผลิตเท่านั้น 569 แถวเดิม
   * บนดิสก์จะไม่ถูก replay ย้อนหลัง และ `classifyWriteAudit` ปล่อยผ่านเฉพาะ
   * AUTHORIZED_OPERATION_FAILED (gate ALLOW แต่ status refused) — การปฏิเสธ
   * ที่เป็นผลของการป้องกันที่ทำงานถูกต้องจะไม่ถูกสั่งซ่อม
   *
   * ไม่เปิด Agent อัตโนมัติ: `AUTOMATIC_AGENT_DISPATCH_ENABLED` ยังเป็น false
   * `buildCorrectiveWorkOrder` จึงไม่สร้าง `agent_run` และ `submitTask` ที่
   * `defaultCreateTask` เรียกเป็นการให้ตัวตนของงานกับ Policy/Admission เท่านั้น
   * ไม่ใช่การลงมือทำ การเปิดสวิตช์เป็นการตัดสินใจของ Owner ไม่ใช่ผลข้างเคียง
   * ของการต่อสายนี้ — ยืนยันสถานะตอนเริ่มโปรเซสไว้ให้เห็นด้านล่าง
   */
  if (AUTOMATIC_AGENT_DISPATCH_ENABLED) {
    console.error("owner-command-http refusing to start: write-failure bridge requires AUTOMATIC_AGENT_DISPATCH_ENABLED=false at this stage");
    process.exit(1);
  }
  writeFailureBridge = startWriteFailureBridge();
  console.log("write-failure-bridge observing (automatic agent dispatch: disabled)");

  server.listen(port, host, () => {
    console.log(`owner-command-http listening on http://${host}:${port}`);
  });
}

function stopOwnedRuntime(): void {
  conversationRuntimeHandle?.stop();
  conversationRuntimeHandle = null;
  supervisor?.stop();
  jointBridge?.stop();
  writeFailureBridge?.stop();
}

process.on("SIGTERM", () => { stopOwnedRuntime(); server.close(() => process.exit(0)); });
process.on("SIGINT", () => { stopOwnedRuntime(); server.close(() => process.exit(0)); });
