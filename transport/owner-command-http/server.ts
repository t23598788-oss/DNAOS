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
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { verifySharedSecret, evaluateBindPolicy } from "../../permissions/network-auth-gate/contract";
import type { EnvelopeIdentity } from "../../contracts/identity/envelope-identity";
import { submitOwnerCommand, renderOwnerSurface } from "../../control/owner-command/contract";
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
import { issueBootstrapChallenge, completeBootstrapProbe } from "../../connections/agent-registry/worker-registration";
import type { RegistrationCandidate } from "../../control/event-pipeline/contract";
import { runRegistrationPipeline } from "../../control/registration-pipeline/contract";
import { applyMutation } from "../../control/registration-update/contract";
import { ingestWorkResult } from "../../control/work-result-ingress/contract";
import type { WorkResultInput } from "../../control/work-result-ingress/contract";
import { createPersistentFileStore } from "../../software/registry-database/adapters/persistent-file-store";
import { findCapability, findResourceById } from "../../software/registry-database/contract";

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

    const outcome = await submitOwnerCommand(commandText, ownerIdentity, {
      ...(uiWorkOrder
        ? { steps: [{ capability_id: "os-ui", intent: commandText, payload: uiWorkOrder }] }
        : {}),
      executionPolicyContext: buildExecutionPolicyContext(ownerIdentity.identity_id),
      executionRequestBase: {
        identity_id: ownerIdentity.identity_id,
        account_id: ACCOUNT_ID,
        workspace_id: WORKSPACE_ID,
        cwd_scope: "repo/owner-command",
      },
    });
    sendJson(res, 200, { ...outcome, rendered: renderOwnerSurface(outcome.surface) });
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

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD" && !requireSharedSecret(req, res)) {
    return;
  }
  if (req.method === "GET" && req.url === "/runtime/inventory") {
    void runtimeInventory().then((inventory) => sendJson(res, 200, inventory)).catch((error) => sendJson(res, 500, { status: "FAILED", error: error instanceof Error ? error.message : String(error) }));
    return;
  }
  if (req.method === "POST" && req.url === "/workers/bootstrap") {
    void readBody(req).then((raw) => { try { const result = issueBootstrapChallenge(JSON.parse(raw)); sendJson(res, "error" in result ? 400 : 201, result); } catch { sendJson(res, 400, { error: "invalid JSON body" }); } });
    return;
  }
  const probeMatch = req.url?.match(/^\/workers\/bootstrap\/([^/?]+)\/probe$/);
  if (req.method === "POST" && probeMatch) {
    void readBody(req).then((raw) => { try { const result = completeBootstrapProbe({ ...JSON.parse(raw), challenge_id: decodeURIComponent(probeMatch[1]) }); sendJson(res, "error" in result ? 400 : 200, result); } catch { sendJson(res, 400, { error: "invalid JSON body" }); } });
    return;
  }
  if (req.method === "POST" && req.url === "/command") {
    void handleCommand(req, res);
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
  server.listen(port, host, () => {
    console.log(`owner-command-http listening on http://${host}:${port}`);
  });
}

process.on("SIGTERM", () => { supervisor?.stop(); server.close(() => process.exit(0)); });
process.on("SIGINT", () => { supervisor?.stop(); server.close(() => process.exit(0)); });
