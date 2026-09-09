/**
 * RAILWAY_REGISTERED_DEPLOY_MUTATION_V1 + REMOTE_PRODUCTION_EXECUTION_CLOSURE_V1
 * Narrow deploy of an existing Railway service revision. Discovery does not
 * enable the target. Unknown SHAs cannot deploy. No generic GraphQL.
 */

import { execFileSync } from "node:child_process";
import { listConnections } from "../../connections/connection-registry/contract";
import { resolveGithubCredential } from "../../connections/github/credential-resolution";
import { getCommit } from "../../connections/github/github-read-api";
import { DEPLOY_EXISTING_SERVICE_REVISION_MUTATION } from "../../connections/railway/router-invoker";
import { getConnectorInvoker } from "../connector-execution-boundary/registry";
import { listGithubPublicationProofs } from "../engineering-runtime/persist";
import { openOwnerReviewView } from "../canonical-view/contract";
import { evaluateCanonicalEvent, makeCanonicalEvent } from "../owner-notification/contract";
import { getDeploymentTarget } from "../work-production-pipeline/contract";
import { repoRoot } from "./host-runtime";
import {
  isRemoteTargetOwnerEnabled,
  lastCanonicalLineageRepair,
  lastRemoteProductionDiscovery,
  listRailwayDeployments,
  persistCanonicalLineageRepair,
  persistRailwayDeployCapability,
  persistRailwayDeployment,
  persistRemoteTargetEnablement,
  rememberCatchup,
} from "./persist";
import { isFixtureRevision } from "./remote-discovery";
import { inspectDeploymentTargets, remoteProductionGate } from "./closure";

export const CIRCUIT_TARGET_ID = "deploy://railway/dna-os-circuit";
const ENVIRONMENT_ID = "4d28eafa-9735-4405-a585-55ea354bafab";
const REPO_OWNER = "t23598788-oss";
const REPO_NAME = "-DNA-OS-INFRASTRUCTURE-";
const ALLOWED_SERVICES = ["dna-os-circuit", "joint-monitor", "owner-command-http"] as const;

function envelope(intent: string, extra: Record<string, unknown> = {}) {
  return {
    command_id: `cmd-railway-${intent}-${Date.now()}`,
    issued_by: {
      identity_id: "dna-os-railway-deploy",
      acting_as_account_id: "t23598788-oss",
      acting_as_tenant_id: "dna-os",
      software_id: "dna-os-infrastructure",
      kind: "service" as const,
    },
    intent: "connector.invoke",
    payload: { intent, ...extra },
    issued_at: new Date().toISOString(),
  };
}

function notify(kind: string, extra: Record<string, string | number | boolean | null> = {}): void {
  if (rememberCatchup(`railway-deploy-v1|${kind}`)) return;
  evaluateCanonicalEvent(makeCanonicalEvent({
    event_id: `evt:railway-deploy:${kind}`,
    event_type: "WORK_CHECKPOINT_COMPLETED",
    entity_id: `entity:deployment-target:${CIRCUIT_TARGET_ID}`,
    work_id: "work-railway-deploy-mutation",
    command_id: null,
    source_system: "dna-os-railway-deploy",
    previous_state: null,
    current_state: kind,
    severity: /FAIL|BLOCK/.test(kind) ? "WARN" : "INFO",
    owner_attention: kind === "OWNER_ENABLE_REQUIRED" || kind === "TARGET_READY_TO_ENABLE",
    action_required: kind === "OWNER_ENABLE_REQUIRED" || kind === "TARGET_READY_TO_ENABLE",
    evidence_refs: ["RAILWAY_REGISTERED_DEPLOY_MUTATION_V1"],
  }), { catchup: true, catchup_kind: kind, checkpoint: kind, ...extra });
}

function artifact(outcome: { artifacts: readonly { kind: string; ref: string }[] }, kind: string): string | null {
  return outcome.artifacts.find((row) => row.kind === kind)?.ref ?? null;
}

function artifactsNamed(outcome: { artifacts: readonly { kind: string; ref: string }[] }, prefix: string): { name: string; id: string }[] {
  return outcome.artifacts.filter((row) => row.kind.startsWith(prefix)).map((row) => ({ name: row.kind.slice(prefix.length), id: row.ref }));
}

export function constructRailwayDeployMutation(input: { service_id: string; environment_id: string; commit_sha: string }): {
  readonly document: string;
  readonly operation: "DEPLOY_EXISTING_SERVICE_REVISION";
  readonly variables: { serviceId: string; environmentId: string; commitSha: string };
  readonly GENERIC_GRAPHQL_EXPOSED: false;
} {
  return {
    document: DEPLOY_EXISTING_SERVICE_REVISION_MUTATION,
    operation: "DEPLOY_EXISTING_SERVICE_REVISION",
    variables: { serviceId: input.service_id, environmentId: input.environment_id, commitSha: input.commit_sha },
    GENERIC_GRAPHQL_EXPOSED: false,
  };
}

export function rejectGenericRailwayGraphql(payload: Record<string, unknown>): { ok: false; reason_code: "GENERIC_GRAPHQL_FORBIDDEN" } | { ok: true } {
  if ("query" in payload || "graphql" in payload || "mutation" in payload || "raw_graphql" in payload) {
    return { ok: false, reason_code: "GENERIC_GRAPHQL_FORBIDDEN" };
  }
  return { ok: true };
}

export function classifyGitAncestry(canonical: string, remote: string): "CANONICAL_BEHIND_REMOTE" | "CANONICAL_AHEAD_REMOTE" | "UNRELATED_HISTORY" | "ALIGNED" | "REMOTE_OBJECT_ABSENT" {
  if (canonical === remote) return "ALIGNED";
  const root = repoRoot();
  const has = (sha: string): boolean => {
    try {
      execFileSync("git", ["cat-file", "-t", sha], { cwd: root, stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  };
  const hasCanonical = has(canonical);
  const hasRemote = has(remote);
  if (hasCanonical && !hasRemote) return "REMOTE_OBJECT_ABSENT";
  if (!hasCanonical && hasRemote) return "CANONICAL_AHEAD_REMOTE";
  if (!hasCanonical && !hasRemote) return "UNRELATED_HISTORY";
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", canonical, remote], { cwd: root, stdio: "pipe" });
    return "CANONICAL_BEHIND_REMOTE";
  } catch { /* not ancestor */ }
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", remote, canonical], { cwd: root, stdio: "pipe" });
    return "CANONICAL_AHEAD_REMOTE";
  } catch {
    return "UNRELATED_HISTORY";
  }
}

export function classifyCurrentRemoteLineage(): {
  readonly CURRENT_LINEAGE_CLASSIFICATION: string;
  readonly CANONICAL_REGISTRY_STALE: boolean;
  readonly SOURCE_HISTORY_REWRITE: false;
  readonly REAL_CANONICAL_REVISION: string;
  readonly REAL_REMOTE_REVISION: string;
  readonly evidence: readonly string[];
} {
  const discovery = lastRemoteProductionDiscovery();
  const canonical = discovery?.lineage.REAL_CANONICAL_REVISION ?? "NOT_AVAILABLE";
  const remote = discovery?.lineage.REAL_REMOTE_REVISION ?? "NOT_AVAILABLE";
  const proofs = listGithubPublicationProofs();
  const remoteAdmitted = proofs.some((row) => row.remote_sha === remote || row.expected_sha === remote);
  const repair = lastCanonicalLineageRepair();
  if (remoteAdmitted && canonical !== remote && !isFixtureRevision(String(remote))) {
    persistCanonicalLineageRepair({
      schema: "CANONICAL_REGISTRY_REPAIR_V1",
      previous: canonical,
      next: remote,
      SOURCE_HISTORY_REWRITE: false,
      reason: "CANONICAL_REGISTRY_STALE",
      repaired_at: new Date().toISOString(),
    });
    return {
      CURRENT_LINEAGE_CLASSIFICATION: "CANONICAL_REGISTRY_STALE",
      CANONICAL_REGISTRY_STALE: true,
      SOURCE_HISTORY_REWRITE: false,
      REAL_CANONICAL_REVISION: String(remote),
      REAL_REMOTE_REVISION: String(remote),
      evidence: ["engineering-runtime github-publication-proofs"],
    };
  }
  const classificationRaw = (canonical === "NOT_AVAILABLE" || remote === "NOT_AVAILABLE")
    ? "REGISTRY_STALE"
    : classifyGitAncestry(canonical, remote);
  const classification = classificationRaw === "REMOTE_OBJECT_ABSENT" ? "CANONICAL_BEHIND_REMOTE" : classificationRaw;
  return {
    CURRENT_LINEAGE_CLASSIFICATION: classification,
    CANONICAL_REGISTRY_STALE: false,
    SOURCE_HISTORY_REWRITE: false,
    REAL_CANONICAL_REVISION: canonical,
    REAL_REMOTE_REVISION: remote,
    evidence: [`git-ancestry:${classificationRaw}`, repair ? "prior-repair" : "no-repair", "github-branch-head"],
  };
}

export async function resolveExistingRailwayServices(): Promise<{
  readonly project_id: string | null;
  readonly environment_id: string;
  readonly environment_name: string | null;
  readonly services: readonly {
    readonly name: string;
    readonly service_id: string | null;
    readonly target_id: string;
    readonly runtime_domain: string | null;
    readonly latest_deployment_id: string | null;
    readonly can_redeploy: boolean;
  }[];
  readonly NEW_RAILWAY_PROJECT_CREATED: false;
  readonly NEW_RAILWAY_SERVICE_CREATED: false;
}> {
  const invoker = getConnectorInvoker("railway");
  const env = invoker ? await invoker(envelope("railway.environment_status")) : null;
  const project_id = env ? artifact(env, "project_id") : null;
  const environment_name = env ? artifact(env, "environment_name") : null;
  const listed = invoker ? await invoker(envelope("railway.list_project_services", { project_id })) : null;
  const found = listed ? artifactsNamed(listed, "service:") : [];
  const services = [];
  for (const name of ALLOWED_SERVICES) {
    const match = found.find((row) => row.name === name || row.name.includes(name));
    let runtime_domain: string | null = name === "dna-os-circuit" ? "dna-os-circuit-production.up.railway.app"
      : name === "joint-monitor" ? "joint-monitor-production.up.railway.app" : null;
    let latest_deployment_id: string | null = null;
    let can_redeploy = false;
    if (invoker && match?.id) {
      const instance = await invoker(envelope("railway.get_service_instance", { service_id: match.id, environment_id: ENVIRONMENT_ID }));
      runtime_domain = artifact(instance, "runtime_domain") ?? runtime_domain;
      latest_deployment_id = artifact(instance, "latest_deployment_id");
      can_redeploy = artifact(instance, "can_redeploy") === "true";
    }
    services.push({
      name,
      service_id: match?.id ?? null,
      target_id: `deploy://railway/${name}`,
      runtime_domain,
      latest_deployment_id,
      can_redeploy,
    });
  }
  return {
    project_id,
    environment_id: ENVIRONMENT_ID,
    environment_name,
    services,
    NEW_RAILWAY_PROJECT_CREATED: false,
    NEW_RAILWAY_SERVICE_CREATED: false,
  };
}

export async function verifyRailwayDeployAdapter(): Promise<{
  readonly RAILWAY_DEPLOY_ADAPTER_PRESENT: true;
  readonly RAILWAY_DEPLOY_AUTH_READY: boolean;
  readonly RAILWAY_DEPLOY_MUTATION_RUNTIME_VERIFIED: boolean;
  readonly GENERIC_GRAPHQL_EXPOSED: false;
  readonly constructed_operation: "DEPLOY_EXISTING_SERVICE_REVISION";
}> {
  const constructed = constructRailwayDeployMutation({
    service_id: "service-fixture-not-sent",
    environment_id: ENVIRONMENT_ID,
    commit_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });
  const invoker = getConnectorInvoker("railway");
  const status = invoker ? await invoker(envelope("railway.environment_status")) : { ok: false, auth_required: true, artifacts: [] as const };
  const introspect = invoker ? await invoker(envelope("railway.introspect_deploy_mutation")) : { ok: false, artifacts: [] as const };
  const mutationVerified = introspect.ok === true && artifact(introspect, "deploy_mutation_field") === "serviceInstanceDeployV2";
  persistRailwayDeployCapability({ mutation_runtime_verified: mutationVerified });
  void constructed;
  return {
    RAILWAY_DEPLOY_ADAPTER_PRESENT: true,
    RAILWAY_DEPLOY_AUTH_READY: status.ok === true && status.auth_required !== true,
    RAILWAY_DEPLOY_MUTATION_RUNTIME_VERIFIED: mutationVerified,
    GENERIC_GRAPHQL_EXPOSED: false,
    constructed_operation: "DEPLOY_EXISTING_SERVICE_REVISION",
  };
}

export function previewEnableRemoteProductionTarget(): {
  readonly action: "ENABLE_REMOTE_PRODUCTION_TARGET";
  readonly requested: false;
  readonly target_id: typeof CIRCUIT_TARGET_ID;
  readonly provider: "railway";
  readonly service: "dna-os-circuit";
  readonly environment: string;
  readonly allowed_mutation: "DEPLOY_EXISTING_SERVICE_REVISION";
  readonly network_effect: "Railway GraphQL serviceInstanceDeployV2 against existing service only";
  readonly production_impact: "Deploys an admitted GitHub commit to dna-os-circuit; does not create services";
  readonly rollback_capability: "deploymentRedeploy if provider canRedeploy";
  readonly evidence_requirements: readonly string[];
  readonly OWNER_APPROVAL_REQUIRED: true;
  readonly review_id: string;
} {
  const review = openOwnerReviewView({
    work_id: "work-enable-remote-production-target",
    ai_client_id: "dna-os",
    session_id: "owner-enable-preview",
    view_type: "SAFE_GENERIC_VIEW",
    fields: {
      action: "ENABLE_REMOTE_PRODUCTION_TARGET",
      target: CIRCUIT_TARGET_ID,
      provider: "railway",
      service: "dna-os-circuit",
      environment: ENVIRONMENT_ID,
      allowed_mutation: "DEPLOY_EXISTING_SERVICE_REVISION",
    },
    source_resource_ids: [CIRCUIT_TARGET_ID],
  });
  notify("TARGET_READY_TO_ENABLE", { target: CIRCUIT_TARGET_ID });
  return {
    action: "ENABLE_REMOTE_PRODUCTION_TARGET",
    requested: false,
    target_id: CIRCUIT_TARGET_ID,
    provider: "railway",
    service: "dna-os-circuit",
    environment: ENVIRONMENT_ID,
    allowed_mutation: "DEPLOY_EXISTING_SERVICE_REVISION",
    network_effect: "Railway GraphQL serviceInstanceDeployV2 against existing service only",
    production_impact: "Deploys an admitted GitHub commit to dna-os-circuit; does not create services",
    rollback_capability: "deploymentRedeploy if provider canRedeploy",
    evidence_requirements: ["github commit exists", "lineage admitted", "owner approve"],
    OWNER_APPROVAL_REQUIRED: true,
    review_id: review.review_id,
  };
}

export function applyEnableRemoteProductionTarget(input: { readonly review_id: string; readonly decision: "APPROVE" | "REJECT" }): {
  readonly owner_enabled: boolean;
  readonly AUTO_ENABLED: false;
} {
  if (input.decision !== "APPROVE") {
    persistRemoteTargetEnablement({ target_id: CIRCUIT_TARGET_ID, owner_enabled: false });
    return { owner_enabled: false, AUTO_ENABLED: false };
  }
  persistRemoteTargetEnablement({ target_id: CIRCUIT_TARGET_ID, owner_enabled: true });
  notify("OWNER_ENABLED_TARGET", { target: CIRCUIT_TARGET_ID });
  return { owner_enabled: true, AUTO_ENABLED: false };
}

export function describeOwnerEnablementState(): {
  readonly REMOTE_REAL_TARGET_ID: string;
  readonly REMOTE_REAL_TARGET_OWNER_ENABLED: boolean;
  readonly action: "ENABLE_REMOTE_PRODUCTION_TARGET";
  readonly OWNER_ACTION_REQUIRED: boolean;
} {
  const enabled = isRemoteTargetOwnerEnabled(CIRCUIT_TARGET_ID);
  return {
    REMOTE_REAL_TARGET_ID: CIRCUIT_TARGET_ID,
    REMOTE_REAL_TARGET_OWNER_ENABLED: enabled,
    action: "ENABLE_REMOTE_PRODUCTION_TARGET",
    OWNER_ACTION_REQUIRED: !enabled,
  };
}

async function githubHasRevision(sha: string): Promise<boolean> {
  const connection = [...listConnections()].reverse().find((row) => row.adapter === "github" && row.status === "connected");
  if (!connection) return false;
  const resolved = await resolveGithubCredential(connection);
  if (!resolved.ok) return false;
  const lookup = await getCommit(resolved.token, { owner: REPO_OWNER, repo: REPO_NAME, sha });
  return lookup.kind === "found" && !isFixtureRevision(lookup.sha);
}

export async function admitRailwayDeploy(input: {
  readonly work_id: string;
  readonly target_id: string;
  readonly requested_revision: string;
  readonly canonical_revision: string;
  readonly remote_revision: string;
  readonly authority_ref: string | null;
}): Promise<{ ok: true } | { ok: false; reason_code: string }> {
  if (input.target_id !== CIRCUIT_TARGET_ID) return { ok: false, reason_code: "UNREGISTERED_TARGET" };
  if (!getDeploymentTarget(input.target_id) && !inspectDeploymentTargets().some((row) => row.target_id === input.target_id)) {
    return { ok: false, reason_code: "UNREGISTERED_TARGET" };
  }
  if (isFixtureRevision(input.requested_revision)) return { ok: false, reason_code: "UNREGISTERED_REVISION" };
  if (isFixtureRevision(input.canonical_revision) || isFixtureRevision(input.remote_revision)) {
    return { ok: false, reason_code: "LINEAGE_INCOMPLETE" };
  }
  if (!(await githubHasRevision(input.requested_revision))) return { ok: false, reason_code: "DEPLOYMENT_REVISION_NOT_FOUND" };
  if (input.requested_revision !== input.canonical_revision && input.requested_revision !== input.remote_revision) {
    return { ok: false, reason_code: "UNREGISTERED_REVISION" };
  }
  const cap = await verifyRailwayDeployAdapter();
  if (!cap.RAILWAY_DEPLOY_AUTH_READY) return { ok: false, reason_code: "AUTH_NOT_READY" };
  if (!cap.RAILWAY_DEPLOY_MUTATION_RUNTIME_VERIFIED) return { ok: false, reason_code: "MUTATION_NOT_RUNTIME_VERIFIED" };
  if (!isRemoteTargetOwnerEnabled(input.target_id)) return { ok: false, reason_code: "OWNER_ENABLE_REQUIRED" };
  if (!input.authority_ref) return { ok: false, reason_code: "DEPLOY_WITHOUT_AUTHORITY" };
  return { ok: true };
}

function normalizeDeployState(status: string | null): string {
  const value = (status ?? "").toUpperCase();
  if (value.includes("QUEU") || value === "INITIALIZING") return "QUEUED";
  if (value.includes("BUILD")) return "BUILDING";
  if (value.includes("DEPLOY") && value !== "DEPLOYMENT_SUCCESS") return "DEPLOYING";
  if (value === "SUCCESS" || value === "SUCCESSFUL") return "SUCCESS";
  if (value.includes("FAIL") || value.includes("CRASH")) return "FAILED";
  if (value.includes("REMOV")) return "REMOVED";
  return value || "UNKNOWN";
}

export async function executeRailwayDeployRevision(input: {
  readonly work_id: string;
  readonly target_id: string;
  readonly repository_id: string;
  readonly canonical_revision: string;
  readonly remote_revision: string;
  readonly requested_revision: string;
  readonly environment_id: string;
  readonly service_id: string;
  readonly authority_ref: string | null;
  readonly expected_current_deployment_revision: string | null;
  readonly evidence_requirements: readonly string[];
}): Promise<{
  readonly LIVE_REAL_DEPLOY: string;
  readonly deployment_id: string | null;
  readonly provider_acceptance: boolean;
  readonly DEPLOY_WITHOUT_AUTHORITY: false;
  readonly DEPLOY_UNKNOWN_REVISION: false;
}> {
  const admission = await admitRailwayDeploy({
    work_id: input.work_id,
    target_id: input.target_id,
    requested_revision: input.requested_revision,
    canonical_revision: input.canonical_revision,
    remote_revision: input.remote_revision,
    authority_ref: input.authority_ref,
  });
  if (!admission.ok) {
    notify(admission.reason_code === "OWNER_ENABLE_REQUIRED" ? "OWNER_ENABLE_REQUIRED" : "DEPLOY_BLOCKED", { reason: admission.reason_code });
    return {
      LIVE_REAL_DEPLOY: admission.reason_code,
      deployment_id: null,
      provider_acceptance: false,
      DEPLOY_WITHOUT_AUTHORITY: false,
      DEPLOY_UNKNOWN_REVISION: false,
    };
  }
  notify("DEPLOY_STARTED", { revision: input.requested_revision });
  const invoker = getConnectorInvoker("railway");
  if (!invoker) {
    return { LIVE_REAL_DEPLOY: "ADAPTER_MISSING", deployment_id: null, provider_acceptance: false, DEPLOY_WITHOUT_AUTHORITY: false, DEPLOY_UNKNOWN_REVISION: false };
  }
  const sent = await invoker(envelope("railway.deploy_revision", {
    service_id: input.service_id,
    environment_id: input.environment_id,
    commit_sha: input.requested_revision,
  }));
  if (sent.summary === "DEPLOYMENT_REVISION_NOT_FOUND") {
    return { LIVE_REAL_DEPLOY: "DEPLOYMENT_REVISION_NOT_FOUND", deployment_id: null, provider_acceptance: false, DEPLOY_WITHOUT_AUTHORITY: false, DEPLOY_UNKNOWN_REVISION: false };
  }
  const deployment_id = artifact(sent, "deployment_id");
  persistRailwayDeployment({
    schema: "RAILWAY_DEPLOY_REVISION_V1",
    work_id: input.work_id,
    target_id: input.target_id,
    deployment_id,
    requested_revision: input.requested_revision,
    provider_acceptance: sent.ok,
    created_at: new Date().toISOString(),
    service_id: input.service_id,
    environment_id: input.environment_id,
    evidence_refs: [...input.evidence_requirements, "connections/railway/router-invoker.ts"],
    expected_current_deployment_revision: input.expected_current_deployment_revision,
    request_is_not_runtime_success: true,
  });
  if (sent.ok) notify("DEPLOY_ACCEPTED", { deployment_id });
  return {
    LIVE_REAL_DEPLOY: sent.ok ? "REQUEST_ACCEPTED" : sent.summary,
    deployment_id,
    provider_acceptance: sent.ok,
    DEPLOY_WITHOUT_AUTHORITY: false,
    DEPLOY_UNKNOWN_REVISION: false,
  };
}

export async function resolveRailwayDeploymentRevision(deployment_id: string): Promise<{
  readonly schema: "RAILWAY_DEPLOYMENT_REVISION_RESOLUTION_V1";
  readonly deployment_id: string;
  readonly provider_state: string;
  readonly REAL_DEPLOYMENT_REVISION: string;
  readonly request_acceptance_is_not_success: true;
  readonly can_redeploy: boolean;
}> {
  const invoker = getConnectorInvoker("railway");
  const read = invoker ? await invoker(envelope("railway.get_deployment", { deployment_id })) : null;
  const status = read ? artifact(read, "deployment_status") : null;
  const revision = read ? artifact(read, "provider_revision") : null;
  return {
    schema: "RAILWAY_DEPLOYMENT_REVISION_RESOLUTION_V1",
    deployment_id,
    provider_state: normalizeDeployState(status),
    REAL_DEPLOYMENT_REVISION: revision && !isFixtureRevision(revision) ? revision : "NOT_AVAILABLE",
    request_acceptance_is_not_success: true,
    can_redeploy: read ? artifact(read, "can_redeploy") === "true" : false,
  };
}

export async function verifyCircuitRuntimeRevision(expected: string | null): Promise<{
  readonly reachable: boolean;
  readonly health_http: number | null;
  readonly RUNTIME_REVISION_PROOF: string;
  readonly REAL_RUNTIME_REVISION: string;
  readonly http_200_is_not_revision_proof: true;
}> {
  const url = "https://dna-os-circuit-production.up.railway.app/circuit.json";
  try {
    const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "DNA-OS-INFRASTRUCTURE" } });
    const reachable = response.ok;
    let bodyRevision: string | null = null;
    try {
      const json = await response.json() as Record<string, unknown>;
      const candidate = json.revision ?? json.runtime_revision ?? json.commit ?? json.build_id;
      bodyRevision = typeof candidate === "string" ? candidate : null;
    } catch {
      bodyRevision = null;
    }
    const proof = bodyRevision && !isFixtureRevision(bodyRevision)
      ? (expected && bodyRevision === expected ? "MATCHED" : "PRESENT")
      : "NOT_AVAILABLE";
    return {
      reachable,
      health_http: response.status,
      RUNTIME_REVISION_PROOF: proof,
      REAL_RUNTIME_REVISION: proof === "NOT_AVAILABLE" ? "NOT_AVAILABLE" : bodyRevision!,
      http_200_is_not_revision_proof: true,
    };
  } catch {
    return {
      reachable: false,
      health_http: null,
      RUNTIME_REVISION_PROOF: "NOT_AVAILABLE",
      REAL_RUNTIME_REVISION: "NOT_AVAILABLE",
      http_200_is_not_revision_proof: true,
    };
  }
}

export function closeRemoteProductionExecution(input: {
  readonly canonical: string;
  readonly remote: string;
  readonly deployment: string;
  readonly runtime: string;
  readonly provider_state: string;
}): {
  readonly schema: "REMOTE_PRODUCTION_EXECUTION_CLOSURE_V1";
  readonly REAL_CANONICAL_REVISION: string;
  readonly REAL_REMOTE_REVISION: string;
  readonly REAL_DEPLOYMENT_REVISION: string;
  readonly REAL_RUNTIME_REVISION: string;
  readonly REAL_LINEAGE_STATUS: string;
  readonly REMOTE_PRODUCTION_READY: boolean;
} {
  const values = [input.canonical, input.remote, input.deployment, input.runtime];
  const missing = values.some((row) => !row || row === "NOT_AVAILABLE" || isFixtureRevision(row));
  let status = "INCOMPLETE";
  if (!missing && values.every((row) => row === values[0])) status = "ALIGNED";
  else if (input.canonical !== input.remote) status = "DIVERGED_AT_REMOTE";
  else if (input.remote !== input.deployment) status = "DIVERGED_AT_DEPLOYMENT";
  else if (input.deployment !== input.runtime) status = "DIVERGED_AT_RUNTIME";
  const ready = status === "ALIGNED" && input.provider_state === "SUCCESS" && isRemoteTargetOwnerEnabled(CIRCUIT_TARGET_ID);
  if (ready) notify("LINEAGE_ALIGNED", { revision: input.runtime });
  return {
    schema: "REMOTE_PRODUCTION_EXECUTION_CLOSURE_V1",
    REAL_CANONICAL_REVISION: input.canonical,
    REAL_REMOTE_REVISION: input.remote,
    REAL_DEPLOYMENT_REVISION: input.deployment,
    REAL_RUNTIME_REVISION: input.runtime,
    REAL_LINEAGE_STATUS: status,
    REMOTE_PRODUCTION_READY: ready,
  };
}

export async function runRemoteProductionClosure(options: { readonly attempt_deploy: boolean } = { attempt_deploy: false }): Promise<Record<string, unknown>> {
  const lineage = classifyCurrentRemoteLineage();
  const adapter = await verifyRailwayDeployAdapter();
  const services = await resolveExistingRailwayServices();
  const circuit = services.services.find((row) => row.name === "dna-os-circuit")!;
  const enablement = describeOwnerEnablementState();
  if (adapter.RAILWAY_DEPLOY_MUTATION_RUNTIME_VERIFIED && !enablement.REMOTE_REAL_TARGET_OWNER_ENABLED) {
    previewEnableRemoteProductionTarget();
  }
  let liveDeploy = "OWNER_ENABLE_REQUIRED";
  let deployment_id: string | null = null;
  let providerDeployment: Record<string, unknown> | null = null;
  let runtime = await verifyCircuitRuntimeRevision(null);
  if (options.attempt_deploy) {
    const result = await executeRailwayDeployRevision({
      work_id: "work-railway-deploy-mutation",
      target_id: CIRCUIT_TARGET_ID,
      repository_id: `repository://${REPO_OWNER}/${REPO_NAME}`,
      canonical_revision: lineage.REAL_CANONICAL_REVISION,
      remote_revision: lineage.REAL_REMOTE_REVISION,
      requested_revision: lineage.REAL_REMOTE_REVISION,
      environment_id: ENVIRONMENT_ID,
      service_id: circuit.service_id ?? "",
      authority_ref: enablement.REMOTE_REAL_TARGET_OWNER_ENABLED ? "owner-enablement:ENABLE_REMOTE_PRODUCTION_TARGET" : null,
      expected_current_deployment_revision: null,
      evidence_requirements: ["github-commit", "owner-enablement"],
    });
    liveDeploy = result.LIVE_REAL_DEPLOY;
    deployment_id = result.deployment_id;
    if (deployment_id) {
      notify("DEPLOY_RUNTIME_CHECK", { deployment_id });
      providerDeployment = await resolveRailwayDeploymentRevision(deployment_id);
      runtime = await verifyCircuitRuntimeRevision(String(providerDeployment.REAL_DEPLOYMENT_REVISION));
    }
  }
  const closure = closeRemoteProductionExecution({
    canonical: lineage.REAL_CANONICAL_REVISION,
    remote: lineage.REAL_REMOTE_REVISION,
    deployment: providerDeployment ? String(providerDeployment.REAL_DEPLOYMENT_REVISION) : "NOT_AVAILABLE",
    runtime: runtime.REAL_RUNTIME_REVISION,
    provider_state: providerDeployment ? String(providerDeployment.provider_state) : "NOT_AVAILABLE",
  });
  const gate = remoteProductionGate();
  void gate;
  return {
    schema: "REMOTE_PRODUCTION_EXECUTION_CLOSURE_V1",
    services,
    adapter,
    enablement,
    lineage,
    liveDeploy,
    deployment_id,
    providerDeployment,
    runtime,
    closure,
    rollback_bound: circuit.can_redeploy,
    DEPLOY_WITHOUT_AUTHORITY: false,
    DEPLOY_UNKNOWN_REVISION: false,
    NEW_RAILWAY_PROJECT_CREATED: false,
    NEW_RAILWAY_SERVICE_CREATED: false,
    NEW_DATABASE_CREATED: false,
    deployments: listRailwayDeployments(),
  };
}

export function getRailwayDeployCapabilityStatus(): Record<string, unknown> {
  return {
    schema: "RAILWAY_REGISTERED_DEPLOY_MUTATION_V1",
    adapter_present: true,
    constructed_operation: "DEPLOY_EXISTING_SERVICE_REVISION",
    GENERIC_GRAPHQL_EXPOSED: false,
    owner_enabled: isRemoteTargetOwnerEnabled(CIRCUIT_TARGET_ID),
    target_id: CIRCUIT_TARGET_ID,
  };
}

export function getRemoteDeployment(): Record<string, unknown> | { status: "NOT_AVAILABLE" } {
  const rows = listRailwayDeployments();
  return rows[rows.length - 1] ?? { status: "NOT_AVAILABLE" };
}

export function getRemoteDeploymentRevision(): Record<string, unknown> | { REAL_DEPLOYMENT_REVISION: "NOT_AVAILABLE" } {
  const rows = listRailwayDeployments();
  const last = rows[rows.length - 1];
  if (!last) return { REAL_DEPLOYMENT_REVISION: "NOT_AVAILABLE" };
  return { requested_revision: last.requested_revision, deployment_id: last.deployment_id, request_is_not_runtime_success: true };
}

export function getRuntimeRevisionAlignment(): Record<string, unknown> {
  const discovery = lastRemoteProductionDiscovery();
  return {
    REAL_CANONICAL_REVISION: discovery?.lineage.REAL_CANONICAL_REVISION ?? "NOT_AVAILABLE",
    REAL_REMOTE_REVISION: discovery?.lineage.REAL_REMOTE_REVISION ?? "NOT_AVAILABLE",
    REAL_DEPLOYMENT_REVISION: "NOT_AVAILABLE",
    REAL_RUNTIME_REVISION: "NOT_AVAILABLE",
    http_200_is_not_revision_proof: true,
  };
}
