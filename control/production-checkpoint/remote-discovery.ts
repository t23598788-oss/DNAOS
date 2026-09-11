/**
 * EXISTING_REMOTE_PRODUCTION_DISCOVERY_AND_BINDING_V1
 * Discover already-existing remote resources first. Normalize into DNA OS
 * registries. Discovery does not grant deploy authority and does not create
 * provider projects.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { listConnections, discoverGitRemote } from "../../connections/connection-registry/contract";
import { resolveGithubCredential } from "../../connections/github/credential-resolution";
import { getBranch, getRepository, getRepositoryEnvironments } from "../../connections/github/github-read-api";
import { ingestExistingRemoteProduction } from "../canonical-information/ingest-production";
import { getConnectorInvoker } from "../connector-execution-boundary/registry";
import { listGithubPublicationProofs } from "../engineering-runtime/persist";
import { evaluateCanonicalEvent, makeCanonicalEvent } from "../owner-notification/contract";
import { CREDENTIAL_REF as DATABASE_SCHEMA_CREDENTIAL_REF } from "../../connections/supabase-schema-read/contract";
import { findApiCredential } from "../../credentials/registry/api-credential-registry";
import { listProviderProjects } from "../../software/provider-project-registry/contract";
import { getDeploymentTarget, registerDeploymentTarget } from "../work-production-pipeline/contract";
import { closeRegisteredWork, inspectDeploymentTargets, probeGithubEnvironments, remoteProductionGate } from "./closure";
import { collectRegisteredWork } from "./reconcile";
import { repoRoot } from "./host-runtime";
import {
  ensureRuntimeEndpointsLoaded,
  joinEndpointAddress,
  resolveRuntimeEndpoint,
} from "../runtime-endpoint-registry/contract";
import {
  lastRemoteProductionDiscovery,
  persistRemoteProductionDiscovery,
  rememberCatchup,
  rememberGithubEnvironmentProbe,
} from "./persist";
import {
  EXISTING_REMOTE_PRODUCTION_DISCOVERY,
  EXISTING_DEPLOYMENT_TARGET_NORMALIZATION,
  REAL_PRODUCTION_LINEAGE,
  REMOTE_RESOURCE_IDENTITY,
  type CapabilityAtomStateV1,
  type ExistingDeploymentTargetNormalizationV1,
  type RealProductionLineageV1,
  type RemoteProductionDiscoveryV1,
  type RemoteResourceIdentityV1,
  type WaitingDeploymentMappingV1,
} from "./types";

const RAILWAY_CREDENTIAL_REF = "credential://railway/dna-os-infrastructure/production/project-token";
const GH_CREDENTIAL_REF = "credential://github/t23598788-oss/-DNA-OS-INFRASTRUCTURE-/source-authority";
const REPO_OWNER = "t23598788-oss";
const REPO_NAME = "-DNA-OS-INFRASTRUCTURE-";
const REPO_BINDING = `github://${REPO_OWNER}/${REPO_NAME}`;
const DEPLOYMENT_METHOD = "railway_hosted_github_integration";

function observedPublicUrl(endpointId: string): string | null {
  ensureRuntimeEndpointsLoaded();
  const resolved = resolveRuntimeEndpoint({ query: endpointId, purpose: "observe" });
  return resolved.ok ? joinEndpointAddress(resolved.endpoint) : null;
}

function historicalServices(): readonly {
  readonly name: string;
  readonly target_id: string;
  readonly runtime_url_ref: string | null;
  readonly health_probe: string;
  readonly evidence: string;
}[] {
  const circuit = observedPublicUrl("endpoint://dna-os-circuit/public");
  const joint = observedPublicUrl("endpoint://joint-monitor/public");
  return [
    {
      name: "dna-os-circuit",
      target_id: "deploy://railway/dna-os-circuit",
      runtime_url_ref: circuit,
      health_probe: circuit ?? "",
      evidence: "reports/RECOVERY_INDEX_2026-08-24.md#40ffd5ab-3033-4c14-9fd6-23b153cb9fd5",
    },
    {
      name: "joint-monitor",
      target_id: "deploy://railway/joint-monitor",
      runtime_url_ref: joint,
      health_probe: joint ?? "",
      evidence: "reports/RECOVERY_INDEX_2026-08-24.md#0a0ecaca-e4fe-4b90-976b-d6822a567763",
    },
    {
      name: "owner-command-http",
      target_id: "deploy://railway/owner-command-http",
      runtime_url_ref: null,
      health_probe: "",
      evidence: "reports/RECOVERY_INDEX_2026-08-24.md#3247c5ac-cf51-424c-9131-4e5f834c8ddd",
    },
  ];
}

export function isFixtureRevision(value: string | null | undefined): boolean {
  if (!value || value === "UNCOMMITTED" || value === "NOT_AVAILABLE") return true;
  const lower = value.toLowerCase();
  if (lower === "deadbeef" || lower.startsWith("deadbeef")) return true;
  if (/^([0-9a-f])\1{6,}$/i.test(value)) return true;
  return false;
}

function realSha(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (isFixtureRevision(value)) return null;
  if (!/^[0-9a-f]{7,40}$/i.test(value)) return null;
  return value;
}

function capabilityState(input: {
  declared: boolean;
  adapter: boolean;
  auth: boolean;
  runtime: boolean;
  owner: boolean;
}): CapabilityAtomStateV1 {
  if (!input.declared && !input.adapter) return "NOT_AVAILABLE";
  if (input.owner) return "OWNER_ENABLED";
  if (input.runtime) return "RUNTIME_VERIFIED";
  if (input.auth) return "AUTHENTICATION_READY";
  if (input.adapter) return "ADAPTER_PRESENT";
  return "DECLARED";
}

function githubConnection() {
  const rows = listConnections().filter((row) => row.adapter === "github" && row.status === "connected");
  return rows[rows.length - 1] ?? listConnections().filter((row) => row.adapter === "github").at(-1) ?? null;
}

function notifyTransition(kind: string, messageKey: string, extra: Record<string, string | number | boolean | null>): void {
  const key = `remote-bind-v1|${kind}`;
  if (rememberCatchup(key)) return;
  evaluateCanonicalEvent(makeCanonicalEvent({
    event_id: `evt:remote-bind:${kind}`,
    event_type: "WORK_CHECKPOINT_COMPLETED",
    entity_id: "entity:deployment-target:remote-production",
    work_id: "work-remote-production-discovery",
    command_id: null,
    source_system: "dna-os-remote-production-discovery",
    previous_state: null,
    current_state: kind,
    severity: kind === "PRODUCTION_NOT_CLOSED" ? "WARN" : "INFO",
    owner_attention: kind === "REMOTE_DEPLOY_AUTH_MISSING" || kind === "PRODUCTION_NOT_CLOSED",
    action_required: kind === "REMOTE_DEPLOY_AUTH_MISSING",
    evidence_refs: ["EXISTING_REMOTE_PRODUCTION_DISCOVERY_AND_BINDING_V1"],
  }), { subject: messageKey, catchup: true, catchup_kind: kind, checkpoint: kind, ...extra });
}

async function readGithub(): Promise<{
  authentication_ready: boolean;
  repository_reachable: boolean;
  repository_id: string | null;
  default_branch: string | null;
  visibility: string | null;
  remote_sha: string | null;
  environments_api: string;
  environment_permission: string;
  environment_names: readonly string[];
  protection_rules_visible: boolean;
  required_reviewers_visible: boolean;
  prevent_self_review_visible: boolean;
  credential_ref: string | null;
}> {
  const connection = githubConnection();
  const credRef = connection?.credential_ref.kind === "keychain_ref" ? connection.credential_ref.ref : GH_CREDENTIAL_REF;
  const empty = {
    authentication_ready: false,
    repository_reachable: false,
    repository_id: null,
    default_branch: null,
    visibility: null,
    remote_sha: null,
    environments_api: "NOT_ATTEMPTED",
    environment_permission: "AUTHENTICATION_NOT_READY",
    environment_names: [] as readonly string[],
    protection_rules_visible: false,
    required_reviewers_visible: false,
    prevent_self_review_visible: false,
    credential_ref: credRef,
  };
  if (!connection) return { ...empty, credential_ref: credRef };
  const resolved = await resolveGithubCredential(connection);
  if (!resolved.ok) {
    return { ...empty, environment_permission: "AUTHENTICATION_NOT_READY" };
  }
  const owner = connection.target?.owner ?? REPO_OWNER;
  const repo = connection.target?.repository ?? REPO_NAME;
  const branch = connection.target?.branch ?? "main";
  const repoLookup = await getRepository(resolved.token, { owner, repo });
  if (repoLookup.kind !== "found") {
    return {
      ...empty,
      authentication_ready: true,
      repository_reachable: false,
      environments_api: "NOT_REACHED",
      environment_permission: repoLookup.kind === "not_found_or_no_access" ? "AUTHORIZATION_INSUFFICIENT" : "AUTHENTICATION_READY",
    };
  }
  const branchLookup = await getBranch(resolved.token, { owner, repo, branch: repoLookup.default_branch ?? branch });
  const remote_sha = branchLookup.kind === "found" ? realSha(branchLookup.head_commit_sha) : null;
  const envs = await getRepositoryEnvironments(resolved.token, { owner, repo });
  let environments_api = "REACHABLE";
  let environment_permission = "VISIBLE";
  let environment_names: readonly string[] = [];
  let protection_rules_visible = false;
  let required_reviewers_visible = false;
  let prevent_self_review_visible = false;
  if (envs.kind === "found") {
    environments_api = "REACHABLE";
    environment_permission = "VISIBLE";
    environment_names = envs.names;
    protection_rules_visible = envs.protection_rules_visible;
    required_reviewers_visible = envs.required_reviewers_visible;
    prevent_self_review_visible = envs.prevent_self_review_visible;
  } else if (envs.kind === "authorization_insufficient") {
    environments_api = "REACHABLE";
    environment_permission = "AUTHORIZATION_INSUFFICIENT";
  } else if (envs.kind === "authentication_failed") {
    environments_api = "NOT_AUTHENTICATED";
    environment_permission = "AUTHENTICATION_NOT_READY";
  } else if (envs.kind === "not_found_or_no_access") {
    environments_api = "REACHABLE";
    environment_permission = "AUTHORIZATION_INSUFFICIENT";
  } else {
    environments_api = "FAILED";
    environment_permission = "AUTHORIZATION_INSUFFICIENT";
  }
  return {
    authentication_ready: true,
    repository_reachable: true,
    repository_id: repoLookup.repository_id,
    default_branch: repoLookup.default_branch,
    visibility: repoLookup.visibility,
    remote_sha,
    environments_api,
    environment_permission,
    environment_names,
    protection_rules_visible,
    required_reviewers_visible,
    prevent_self_review_visible,
    credential_ref: credRef,
  };
}

async function readRailway(): Promise<{
  exists: boolean;
  auth_ready: boolean;
  read_verified: boolean;
  project_id: string | null;
  environment_id: string;
  summary: string;
}> {
  const environment_id = "4d28eafa-9735-4405-a585-55ea354bafab";
  const entry = findApiCredential(RAILWAY_CREDENTIAL_REF);
  const auth_ready = entry?.status === "ACTIVE";
  const invoker = getConnectorInvoker("railway");
  if (!invoker) {
    return { exists: true, auth_ready: Boolean(auth_ready), read_verified: false, project_id: null, environment_id, summary: "adapter missing" };
  }
  const outcome = await invoker({
    command_id: "cmd-remote-discovery-railway-read",
    issued_by: {
      identity_id: "dna-os-remote-discovery",
      acting_as_account_id: "t23598788-oss",
      acting_as_tenant_id: "dna-os",
      software_id: "dna-os-infrastructure",
      kind: "service",
    },
    intent: "connector.invoke",
    payload: { intent: "railway.environment_status" },
    issued_at: new Date().toISOString(),
  });
  const projectMatch = outcome.summary.match(/project\s+(\S+)/);
  return {
    exists: true,
    auth_ready: auth_ready && !outcome.auth_required,
    read_verified: outcome.ok === true,
    project_id: projectMatch?.[1] ?? null,
    environment_id,
    summary: outcome.summary,
  };
}

function latestRealPublicationSha(): string | null {
  const rows = [...listGithubPublicationProofs()].reverse();
  for (const row of rows) {
    const sha = realSha(row.remote_sha) ?? realSha(row.expected_sha);
    if (sha) return sha;
  }
  return null;
}

function realLineage(remoteSha: string | null): RealProductionLineageV1 {
  const canonical = latestRealPublicationSha();
  const remote = remoteSha ?? canonical;
  const deployment = "NOT_AVAILABLE";
  const runtime = "NOT_AVAILABLE";
  let status: RealProductionLineageV1["REAL_LINEAGE_STATUS"] = "NOT_AVAILABLE";
  if (!canonical && !remote) status = "NOT_AVAILABLE";
  else if (canonical && remote && canonical !== remote) status = "DIVERGED_AT_REMOTE";
  else if (canonical || remote) status = "INCOMPLETE";
  return {
    schema: REAL_PRODUCTION_LINEAGE,
    REAL_CANONICAL_REVISION: canonical ?? "NOT_AVAILABLE",
    REAL_REMOTE_REVISION: remote ?? "NOT_AVAILABLE",
    REAL_DEPLOYMENT_REVISION: deployment,
    REAL_RUNTIME_REVISION: runtime,
    REAL_LINEAGE_STATUS: status,
    FIXTURE_REVISIONS_EXCLUDED_FROM_REAL_LINEAGE: true,
  };
}

function normalizeRailwayTargets(railway: { exists: boolean; auth_ready: boolean; environment_id: string; project_id: string | null }): ExistingDeploymentTargetNormalizationV1[] {
  const targets: ExistingDeploymentTargetNormalizationV1[] = [];
  const provider_resource_id = railway.project_id ?? "resource-7691c9a8-4bed-4c12-adb7-c66b93f86f16";
  for (const service of historicalServices()) {
    const existing = getDeploymentTarget(service.target_id);
    if (!existing) {
      registerDeploymentTarget({
        target_id: service.target_id,
        environment: railway.environment_id,
        provider: "railway",
        application: service.name,
        deployment_method: DEPLOYMENT_METHOD,
        source_repository: REPO_BINDING,
        required_artifact: "NOT_AVAILABLE",
        health_probe: service.health_probe,
        rollback_method: "NOT_WIRED",
        authority_policy: "OWNER_DISABLED",
        secret_reference_policy: "KEYCHAIN_REF_ONLY",
        runtime_identity: service.runtime_url_ref ?? "no_public_domain",
        status: "REGISTERED_EXISTING",
        runtime_dir: "NOT_APPLICABLE",
        provider_resource_id,
        target_type: "REMOTE_REAL",
        repository_binding: REPO_BINDING,
        owner_enabled: false,
        mutation_capability: "NOT_WIRED",
        evidence_refs: [service.evidence, "connections/railway/connection-document.json"],
        authentication_ready: railway.auth_ready && railway.exists,
      });
    }
    targets.push({
      schema: EXISTING_DEPLOYMENT_TARGET_NORMALIZATION,
      target_id: service.target_id,
      provider: "railway",
      provider_resource_id,
      target_type: "REMOTE_REAL",
      environment: railway.environment_id,
      deployment_method: DEPLOYMENT_METHOD,
      runtime_probe: service.runtime_url_ref,
      repository_binding: REPO_BINDING,
      owner_enabled: false,
      mutation_capability: "NOT_WIRED",
      evidence_refs: [service.evidence],
      duplicate_created: false,
    });
  }
  return targets;
}

function mapWaiting(targetId: string): WaitingDeploymentMappingV1 {
  const closed = closeRegisteredWork({ includeDiskCatalog: true, catchup: false });
  const waiting = closed.items.find((row) => row.STATE_CLASSIFICATION === "WAITING_FOR_DEPLOYMENT");
  const workId = waiting?.work_id ?? "NOT_AVAILABLE";
  const bundle = collectRegisteredWork(true).find((row) => row.work_id === workId);
  const candidate = realSha(bundle?.pipe?.source_revision) ?? realSha(bundle?.pipe?.lineage.commit) ?? "NOT_AVAILABLE";
  return {
    WORK_ID: workId,
    CANDIDATE_REVISION: candidate,
    TARGET_ID: targetId,
    TARGET_BINDING_STATUS: getDeploymentTarget(targetId) ? "BOUND_EXISTING" : "MISSING_BINDING",
    DEPLOYMENT_CAPABILITY_STATUS: "NOT_WIRED",
    NEXT_REQUIRED_ACTION: "WIRE_RAILWAY_DEPLOY_MUTATION_AND_OWNER_ENABLE",
    DEPLOY_EXECUTED: false,
    blocking_condition: "DEPLOY_MUTATION_NOT_WIRED",
  };
}

export async function discoverExistingRemoteProduction(): Promise<RemoteProductionDiscoveryV1> {
  const git = await discoverGitRemote();
  const unauth = await probeGithubEnvironments();
  const github = await readGithub();
  const railway = await readRailway();
  const railwayProjects = listProviderProjects().filter((row) => row.provider_id === "railway");
  const dbProjects = listProviderProjects().filter((row) => row.provider_id !== "railway" && row.provider_id !== "github");
  rememberGithubEnvironmentProbe({ permission: github.environment_permission, names: github.environment_names });

  const railwayRegisteredBefore = inspectDeploymentTargets().some((row) => row.target_id.startsWith("deploy://railway/"));
  const targets = railway.exists ? normalizeRailwayTargets(railway) : [];
  const railwayRegistered = inspectDeploymentTargets().some((row) => row.target_type === "REMOTE_REAL" && row.target_id.startsWith("deploy://railway/"));
  void railwayRegisteredBefore;
  void github.protection_rules_visible;
  void github.required_reviewers_visible;
  void github.prevent_self_review_visible;

  const resources: RemoteResourceIdentityV1[] = [];
  resources.push({
    schema: REMOTE_RESOURCE_IDENTITY,
    provider: "github",
    resource_type: "repository",
    provider_resource_id: github.repository_id ?? `${REPO_OWNER}/${REPO_NAME}`,
    canonical_resource_id: `resource://github/repository/${REPO_OWNER}/${REPO_NAME}`,
    name: REPO_NAME,
    environment: github.default_branch ?? "main",
    repository_binding: REPO_BINDING,
    service_binding: "service://github/source-authority",
    runtime_url_ref: git.ok ? git.value.remote_url : `https://github.com/${REPO_OWNER}/${REPO_NAME}`,
    credential_ref: github.credential_ref,
    discovery_source: "connection-registry+github-read-api",
    evidence_refs: ["connections/github/connection-document.json", "connections/connection-registry/data/connections.jsonl"],
    RESOURCE_EXISTS: github.repository_reachable,
    RESOURCE_REGISTERED: Boolean(githubConnection()),
    AUTHENTICATION_READY: github.authentication_ready,
    RUNTIME_REACHABLE: false,
    MUTATION_WIRED: false,
    OWNER_ENABLED: false,
  });

  const railwayDoc = join(repoRoot(), "connections/railway/connection-document.json");
  resources.push({
    schema: REMOTE_RESOURCE_IDENTITY,
    provider: "railway",
    resource_type: "project",
    provider_resource_id: railway.project_id ?? "resource-7691c9a8-4bed-4c12-adb7-c66b93f86f16",
    canonical_resource_id: "resource://railway/project/dna-os-infrastructure",
    name: "dna-os-infrastructure",
    environment: railway.environment_id,
    repository_binding: REPO_BINDING,
    service_binding: "service://railway/environment-status",
    runtime_url_ref: null,
    credential_ref: RAILWAY_CREDENTIAL_REF,
    discovery_source: railwayProjects.length > 0 ? "provider-project-registry+railway-invoker" : "railway-connection-document",
    evidence_refs: existsSync(railwayDoc) ? ["connections/railway/connection-document.json"] : [],
    RESOURCE_EXISTS: railway.exists,
    RESOURCE_REGISTERED: railwayRegistered,
    AUTHENTICATION_READY: railway.auth_ready,
    RUNTIME_REACHABLE: false,
    MUTATION_WIRED: false,
    OWNER_ENABLED: false,
  });

  for (const service of historicalServices()) {
    resources.push({
      schema: REMOTE_RESOURCE_IDENTITY,
      provider: "railway",
      resource_type: "service",
      provider_resource_id: service.name,
      canonical_resource_id: `resource://railway/service/${service.name}`,
      name: service.name,
      environment: railway.environment_id,
      repository_binding: REPO_BINDING,
      service_binding: service.target_id,
      runtime_url_ref: service.runtime_url_ref,
      credential_ref: RAILWAY_CREDENTIAL_REF,
      discovery_source: "railway-connection-document+historical-deployment-evidence",
      evidence_refs: [service.evidence],
      RESOURCE_EXISTS: true,
      RESOURCE_REGISTERED: Boolean(getDeploymentTarget(service.target_id)),
      AUTHENTICATION_READY: railway.auth_ready,
      RUNTIME_REACHABLE: false,
      MUTATION_WIRED: false,
      OWNER_ENABLED: false,
    });
  }

  const dbDocPath = join(repoRoot(), "connections/supabase/connection-document.json");
  let dbRef = "NOT_AVAILABLE";
  if (existsSync(dbDocPath)) {
    const doc = JSON.parse(readFileSync(dbDocPath, "utf8")) as { project_identity?: { project_ref?: string } };
    dbRef = doc.project_identity?.project_ref ?? (dbProjects[0]?.identifiers.project_ref ?? "NOT_AVAILABLE");
  }
  resources.push({
    schema: REMOTE_RESOURCE_IDENTITY,
    provider: "database-schema",
    resource_type: "project_database",
    provider_resource_id: dbRef,
    canonical_resource_id: `resource://database/project/${dbRef}`,
    name: "dna-os-project-database",
    environment: "production",
    repository_binding: null,
    service_binding: "service://database/schema-read",
    runtime_url_ref: null,
    credential_ref: DATABASE_SCHEMA_CREDENTIAL_REF,
    discovery_source: "provider-project-registry+database-connection-document",
    evidence_refs: ["software/provider-project-registry/data/provider-projects.jsonl"],
    RESOURCE_EXISTS: dbRef !== "NOT_AVAILABLE",
    RESOURCE_REGISTERED: true,
    AUTHENTICATION_READY: Boolean(findApiCredential(DATABASE_SCHEMA_CREDENTIAL_REF)),
    RUNTIME_REACHABLE: false,
    MUTATION_WIRED: false,
    OWNER_ENABLED: false,
  });

  const lineage = realLineage(github.remote_sha);
  const primaryTarget = targets[0]?.target_id ?? "NOT_AVAILABLE";
  const waiting = mapWaiting(primaryTarget);
  const existingReused = railwayRegistered;

  const ghPublish = Boolean(latestRealPublicationSha());
  const capabilities: Record<string, CapabilityAtomStateV1> = {
    READ_STATUS: capabilityState({ declared: true, adapter: true, auth: github.authentication_ready || railway.auth_ready, runtime: github.repository_reachable || railway.read_verified, owner: false }),
    READ_DEPLOYMENTS: capabilityState({ declared: true, adapter: false, auth: railway.auth_ready, runtime: false, owner: false }),
    PUBLISH_SOURCE: capabilityState({ declared: true, adapter: true, auth: github.authentication_ready, runtime: ghPublish, owner: false }),
    DEPLOY_REVISION: "NOT_AVAILABLE",
    ROLLBACK: "NOT_AVAILABLE",
    READ_RUNTIME_HEALTH: capabilityState({ declared: true, adapter: true, auth: railway.auth_ready, runtime: false, owner: false }),
  };

  const report: RemoteProductionDiscoveryV1 = {
    schema: EXISTING_REMOTE_PRODUCTION_DISCOVERY,
    EXISTING_REMOTE_DISCOVERY_FIRST: true,
    NEW_REMOTE_CREATION_DEFAULT: false,
    NEW_REMOTE_PROJECT_CREATED: false,
    REMOTE_RESOURCE_DISCOVERY_GRANTS_AUTHORITY: false,
    EXISTING_RESOURCE_REUSED: Boolean(existingReused || railwayRegistered),
    resources,
    targets,
    lineage,
    HISTORICAL_REMOTE_PRODUCTION: "PARTIAL",
    GITHUB_REPOSITORY_REACHABLE: github.repository_reachable,
    GITHUB_AUTHENTICATION_READY: github.authentication_ready,
    GITHUB_ENVIRONMENTS_API: github.environments_api,
    GITHUB_ENVIRONMENT_PERMISSION: github.environment_permission,
    GITHUB_ENVIRONMENTS: github.environment_names,
    GITHUB_UNAUTHENTICATED_HTTP: unauth.http_status,
    GITHUB_UNAUTHENTICATED_NOT_FINAL: true,
    RAILWAY_RESOURCE_EXISTS: railway.exists,
    RAILWAY_REGISTERED: railwayRegistered,
    RAILWAY_AUTH_READY: railway.auth_ready,
    RAILWAY_READ_VERIFIED: railway.read_verified,
    RAILWAY_DEPLOY_MUTATION_WIRED: false,
    RAILWAY_RUNTIME_PROBE_WIRED: targets.some((row) => Boolean(row.runtime_probe)),
    SUPABASE_RESOURCE_ROLE: "DATABASE_RESOURCE",
    DEPLOYMENT_METHOD,
    REMOTE_REAL_TARGET_ID: primaryTarget,
    REMOTE_REAL_TARGET_REGISTERED: railwayRegistered,
    REMOTE_REAL_TARGET_OWNER_ENABLED: false,
    capabilities,
    waiting,
    REMOTE_PRODUCTION_READY: false,
    RUNTIME_VERIFIED: false,
    observed_at: new Date().toISOString(),
  };

  persistRemoteProductionDiscovery(report);
  ingestExistingRemoteProduction({
    resources: report.resources.map((row) => ({
      canonical_resource_id: row.canonical_resource_id,
      name: row.name,
      provider: row.provider,
      resource_type: row.resource_type,
      evidence_refs: row.evidence_refs,
    })),
    targets: report.targets.map((row) => ({ target_id: row.target_id, provider: row.provider })),
    lineage: {
      REAL_CANONICAL_REVISION: lineage.REAL_CANONICAL_REVISION,
      REAL_REMOTE_REVISION: lineage.REAL_REMOTE_REVISION,
      REAL_LINEAGE_STATUS: lineage.REAL_LINEAGE_STATUS,
    },
  });

  notifyTransition("REMOTE_FOUND_REGISTERED", "พบ production เดิมและลงทะเบียนแล้ว", { PRODUCTION_ENVIRONMENT: remoteProductionGate().PRODUCTION_ENVIRONMENT });
  if (railwayRegistered) {
    notifyTransition("REMOTE_TARGET_BOUND", "เชื่อม deployment target เดิมสำเร็จ", { target: primaryTarget });
  }
  notifyTransition("REMOTE_DEPLOY_AUTH_MISSING", "พบ production เดิม แต่ยังขาดสิทธิ์ deploy", { blocking: waiting.blocking_condition });
  notifyTransition("PRODUCTION_NOT_CLOSED", `ยังไม่สามารถปิด production ได้: ${waiting.blocking_condition}`, { blocking: waiting.blocking_condition });
  return report;
}

export function getRemoteProductionBinding(): RemoteProductionDiscoveryV1 | { schema: typeof EXISTING_REMOTE_PRODUCTION_DISCOVERY; status: "NOT_AVAILABLE" } {
  return lastRemoteProductionDiscovery() ?? { schema: EXISTING_REMOTE_PRODUCTION_DISCOVERY, status: "NOT_AVAILABLE" };
}

export function listRemoteProductionResources(): readonly RemoteResourceIdentityV1[] {
  return lastRemoteProductionDiscovery()?.resources ?? [];
}

export function getRealProductionLineage(): RealProductionLineageV1 | { schema: typeof REAL_PRODUCTION_LINEAGE; REAL_LINEAGE_STATUS: "NOT_AVAILABLE"; FIXTURE_REVISIONS_EXCLUDED_FROM_REAL_LINEAGE: true } {
  return lastRemoteProductionDiscovery()?.lineage ?? {
    schema: REAL_PRODUCTION_LINEAGE,
    REAL_LINEAGE_STATUS: "NOT_AVAILABLE",
    FIXTURE_REVISIONS_EXCLUDED_FROM_REAL_LINEAGE: true,
  };
}

export function getExistingDeploymentMethod(): { DEPLOYMENT_METHOD: string } {
  return { DEPLOYMENT_METHOD: lastRemoteProductionDiscovery()?.DEPLOYMENT_METHOD ?? DEPLOYMENT_METHOD };
}

export function getRemoteAuthenticationStatus(): {
  GITHUB_AUTHENTICATION_READY: boolean;
  RAILWAY_AUTH_READY: boolean;
  GITHUB_ENVIRONMENT_PERMISSION: string;
} {
  const row = lastRemoteProductionDiscovery();
  return {
    GITHUB_AUTHENTICATION_READY: row?.GITHUB_AUTHENTICATION_READY ?? false,
    RAILWAY_AUTH_READY: row?.RAILWAY_AUTH_READY ?? false,
    GITHUB_ENVIRONMENT_PERMISSION: row?.GITHUB_ENVIRONMENT_PERMISSION ?? "NOT_AVAILABLE",
  };
}
