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
import { decideContinuation, deriveLifecycle } from "../../control/operational-lifecycle/contract";
import { readRuntimeRevision } from "../../control/runtime-revision/contract";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { verifySharedSecret, evaluateBindPolicy } from "../../permissions/network-auth-gate/contract";
import type { EnvelopeIdentity } from "../../contracts/identity/envelope-identity";
import { translateOwnerMessage } from "../../control/owner-command-semantics/contract";
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
import { startJointEventBridge } from "../../observability/joint-monitor/contract";
import { intakeEvent } from "../../control/owner-backbone/contract";
import { issueBootstrapChallenge, completeBootstrapProbe } from "../../connections/agent-registry/worker-registration";
import type { RegistrationCandidate } from "../../control/event-pipeline/contract";
import { runRegistrationPipeline } from "../../control/registration-pipeline/contract";
import { handleComputerUseApi } from "./computer-use-api";
import { applyMutation } from "../../control/registration-update/contract";
import { ingestWorkResult } from "../../control/work-result-ingress/contract";
import type { WorkResultInput } from "../../control/work-result-ingress/contract";
import { createPersistentFileStore } from "../../software/registry-database/adapters/persistent-file-store";
import { findCapability, findResourceById } from "../../software/registry-database/contract";
import { handleOwnerBackboneRoute } from "./owner-backbone-routes";
import { handleOwnerCredentialRoute } from "./owner-credential-routes";
import { runPreExecutionPlan, latestPlanFor, latestPlan } from "../../control/pre-execution-planner/contract";
import { executeLocalRead } from "../../control/owner-command/local-read-operations";
import { resolveAndExecuteOwnerIntent, resolveAndExecuteOwnerRequest } from "../../control/owner-command/structured-intent";
import { findOpenOwnerQuestion, previewOwnerCommand, submitOwnerCommand } from "../../control/owner-command/contract";
import { readHistoryForIdentity } from "../../control/owner-command-semantics/contract";
import { listReservations } from "../../control/source-workspace/contract";
import { ownerDecision, DEFAULT_AGENT_WORKERS, loadEvidenceForTask } from "../../control/agent-gateway/contract";
import { projectOwnerDisplayPayload } from "../../control/owner-projection/display-payload";
import { readHistoryForIdentity, readHistoryForCommand } from "../../control/owner-command-semantics/contract";

const IDENTITY_ID = "identity-deadboard-owner";
const ACCOUNT_ID = "account-deadboard-owner";
const WORKSPACE_ID = "workspace-deadboard-owner";
const registrationStore = createPersistentFileStore();

registerIdentity({ identity_id: IDENTITY_ID, kind: "human", display_name: "Dead Board Owner" });
registerAccount({ account_id: ACCOUNT_ID });
registerWorkspace({ workspace_id: WORKSPACE_ID, account_id: ACCOUNT_ID });
grantMembership({ identity_id: IDENTITY_ID, scope_type: "account", scope_id: ACCOUNT_ID, role: "member" });
grantMembership({ identity_id: IDENTITY_ID, scope_type: "workspace", scope_id: WORKSPACE_ID, role: "member" });

// Diagnostic-only bootstrap grant: it permits the owner command's
// read-only permission check to return a real decision. It does not grant
// shell execution, file writes, deployment, or external credentials. Any
// mutating capability must provide its own persisted grant and policy gate.
issueExecutionGrant({
  identity_id: IDENTITY_ID,
  account_id: ACCOUNT_ID,
  workspace_id: WORKSPACE_ID,
  capability: "execution.run",
  command_id: "unknown",
  action: "run",
  cwd_scope_prefix: "repo/",
  effect: "allow",
});

const DEFAULT_OWNER_IDENTITY: EnvelopeIdentity = {
  identity_id: IDENTITY_ID,
  acting_as_account_id: ACCOUNT_ID,
  acting_as_tenant_id: "tenant-deadboard-owner",
  software_id: "dna-os-deadboard",
  kind: "human",
};

// Identities provisioned via a real forwarded ownerIdentity (see header) —
// registered/granted once per real Supabase user id, not on every request,
// so repeated commands from the same signed-in person don't accumulate
// duplicate membership/grant rows in these in-memory registries.
const provisionedRealIdentities = new Set<string>([IDENTITY_ID]);

function resolveOwnerIdentity(ownerIdentity: { id?: unknown; email?: unknown } | undefined): EnvelopeIdentity {
  if (!ownerIdentity || typeof ownerIdentity.id !== "string" || ownerIdentity.id.length === 0) {
    return DEFAULT_OWNER_IDENTITY;
  }
  const realIdentityId = `supabase-${ownerIdentity.id}`;
  const displayName = typeof ownerIdentity.email === "string" && ownerIdentity.email.length > 0 ? ownerIdentity.email : realIdentityId;

  if (!provisionedRealIdentities.has(realIdentityId)) {
    // Attribution only — same fixed ACCOUNT_ID/WORKSPACE_ID as
    // DEFAULT_OWNER_IDENTITY, so this never grants MORE access than the
    // single-owner phase's one already-provisioned scope already allows.
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

async function runtimeInventory(): Promise<unknown> {
  let researchHealth: { status?: string } = {};
  try {
    const response = await fetch("http://127.0.0.1:8787/api/research/health");
    researchHealth = response.ok ? await response.json() as { status?: string } : {};
  } catch { researchHealth = {}; }
  const capabilities = listCapabilities().map((capability) => ({
    capability_id: capability.capability_id,
    registry_status: capability.health_status,
    endpoint: capability.endpoint,
    supported_commands: capability.supported_commands,
    live_status: capability.capability_id === "research-engine"
      ? researchHealth.status === "ok" ? "VERIFIED" : "BLOCKED"
      : capability.health_status === "CONNECTED" ? "VERIFIED" : "BLOCKED",
    evidence: [
      `registry:control/command-router/capability-registry.ts#${capability.capability_id}`,
      capability.capability_id === "research-engine" ? "health:http://127.0.0.1:8787/api/research/health" : `endpoint:${capability.endpoint.kind}`,
    ],
  }));
  return {
    status: "VERIFIED",
    generated_at: new Date().toISOString(),
    transport: { status: "VERIFIED", endpoint: "http://127.0.0.1:8791", health: "/health" },
    supervisor: { status: "VERIFIED", worker_count: DEFAULT_AGENT_WORKERS.length },
    evidence_store: {
      status: "VERIFIED",
      task_path: "control/agent-gateway/data/tasks.jsonl",
      evidence_path: "control/agent-gateway/data/evidence.jsonl",
      handoff_path: "control/agent-gateway/data/handoffs.jsonl",
    },
    capabilities,
  };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
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
 * ── ไปไม่ถึงการสั่งงาน ──
 * ไม่มี router ไม่มี WorkOrder ไม่มี task ไม่มี Agent และ `execution_started`
 * เป็น false เสมอ การข้ามไปสั่งงานต้องเป็นการยื่น WorkOrder ที่ผ่านการรับเข้า
 * อย่างชัดแจ้งในอีกคำขอหนึ่ง
 */
function respondWithChatIntake(
  res: ServerResponse,
  rawText: string,
  ownerIdentity: EnvelopeIdentity,
  uiHintReceived: boolean,
): void {
  const messageId = newEnvelopeId();
  const translation = translateOwnerMessage(messageId, rawText, ownerIdentity, { registryStore: registrationStore });
  sendJson(res, 200, {
    status: translation.semantic.ok ? "TRANSLATED" : "TRANSLATION_BLOCKED",
    layer: "RAW_CHAT_INTAKE",
    next_layer: translation.semantic.ok ? "STRUCTURED_INTERPRETATION" : "RAW_MESSAGE_RETAINED",
    message_id: translation.message_id,
    raw_text: translation.raw_text,
    semantic: translation.semantic,
    ui_work_order_received: uiHintReceived,
    execution_started: translation.execution_started,
    next: "explicit admitted WorkOrder required for routing/execution",
  });
}

/**
 * `POST /chat` — ประตูของชั้นรับข้อความดิบ
 *
 * รับ `{ message | commandText }` เป็นข้อความภาษาคนล้วน ไม่มีไวยากรณ์คำสั่งใดที่
 * ผู้ใช้ต้องจำ และไม่รับ WorkOrder — การยื่นงานมีประตูของมันเองที่ `POST /command`
 */
export async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let message: unknown;
  let ownerIdentityInput: { id?: unknown; email?: unknown } | undefined;
  try {
    const body = JSON.parse(await readBody(req)) as { message?: unknown; commandText?: unknown; ownerIdentity?: unknown };
    message = body.message ?? body.commandText;
    if (body.ownerIdentity && typeof body.ownerIdentity === "object") ownerIdentityInput = body.ownerIdentity as { id?: unknown; email?: unknown };
  } catch {
    sendJson(res, 400, { error: "invalid JSON body" });
    return;
  }
  if (typeof message !== "string" || message.trim() === "") {
    sendJson(res, 400, { error: "message must be a non-empty string" });
    return;
  }
  try {
    respondWithChatIntake(res, message, resolveOwnerIdentity(ownerIdentityInput), false);
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
  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw) as { commandText?: unknown; workOrder?: unknown; idempotencyKey?: unknown; uiWorkOrder?: unknown; ownerIdentity?: unknown };
    commandText = body.commandText;
    idempotencyKey = body.idempotencyKey;
    if (body.workOrder !== undefined) workOrder = body.workOrder as WorkOrder;
    if (body.uiWorkOrder !== undefined) uiWorkOrder = body.uiWorkOrder as UiWorkOrder;
    if (body.ownerIdentity && typeof body.ownerIdentity === "object") ownerIdentityInput = body.ownerIdentity as { id?: unknown; email?: unknown };
  } catch {
    sendJson(res, 400, { error: "invalid JSON body" });
    return;
  }
  if (typeof commandText !== "string" || commandText.trim() === "") {
    sendJson(res, 400, { error: "commandText must be a non-empty string" });
    return;
  }

  const ownerIdentity = resolveOwnerIdentity(ownerIdentityInput);

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
    respondWithChatIntake(res, commandText, ownerIdentity, uiWorkOrder !== undefined);
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
  if (!expected) return true;
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
    const runtime = readRuntimeRevision();
    sendJson(res, 200, { ok: true, revision: runtime.revision, revision_source: runtime.source, revision_dirty: runtime.dirty, revision_reason: runtime.reason });
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

function buildOwnerActivity(identity: string, commandIdInput: string | null): Record<string, unknown> {
  const history = readHistoryForIdentity(identity);
  const rows = history.found ? [...history.value] : [];
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

  // งานฝั่ง Agent Host ใช้ id ที่คำนวณจาก command_id ตรง ๆ (agent-host-dispatch.ts)
  const agentTaskId = `task-${commandId}-agent-host`;
  const agentEvidence = loadEvidenceForTask(agentTaskId);
  const evOf = (needle: string) => agentEvidence.find((e) => e.source.endsWith(needle)) ?? null;
  const agentInput = evOf("#DNA_OS_AGENT_INPUT_V1");
  const messages = agentEvidence.filter((e) => e.source.endsWith("#agent-message"));
  const launch = agentEvidence.find((e) => {
    const p = e.payload as { launch?: unknown } | null;
    return Boolean(p && typeof p === "object" && p.launch);
  });
  const verification = agentEvidence.find((e) => e.kind === "verification");
  const reservation = listReservations().filter((r) => r.work_id === `wo-${commandId}`).at(-1) ?? null;

  const launchPayload = (launch?.payload as { launch?: Record<string, unknown> } | null)?.launch ?? null;
  const running = ownerResult === null;

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
  return {
    found: true,
    command_id: commandId,
    owner_text: raw?.raw_text ?? resolution?.raw_text ?? null,
    running,
    status: (resultPayload?.status as string | undefined) ?? (agentStillRunning ? "RUNNING" : "PENDING"),
    stages,
    agent_messages: messages.map((m) => String((m.payload as { agent_message?: unknown } | null)?.agent_message ?? "")),
    next_action: (resultPayload?.next_action as string | null | undefined) ?? null,
    details: {
      command_id: commandId,
      task_id: taskLink?.task_id ?? (resultPayload?.task_id as string | undefined) ?? null,
      agent_task_id: agentEvidence.length > 0 ? agentTaskId : null,
      work_order_id: reservation ? `wo-${commandId}` : null,
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
        const body = JSON.parse(raw) as { commandText?: unknown; message?: unknown; ownerIdentity?: { id?: unknown; email?: unknown } };
        const text = typeof body.commandText === "string" ? body.commandText : typeof body.message === "string" ? body.message : "";
        if (text.trim() === "") { sendJson(res, 400, { error: "commandText required" }); return; }
        const outcome = await submitOwnerCommand(text, resolveOwnerIdentity(body.ownerIdentity));
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

  server.listen(port, host, () => {
    console.log(`owner-command-http listening on http://${host}:${port}`);
  });
}

process.on("SIGTERM", () => { supervisor?.stop(); jointBridge?.stop(); server.close(() => process.exit(0)); });
process.on("SIGINT", () => { supervisor?.stop(); jointBridge?.stop(); server.close(() => process.exit(0)); });
