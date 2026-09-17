/**
 * Railway ConnectorInvoker — existing read intent plus a NARROW deploy
 * mutation constructed inside this folder. Clients cannot supply GraphQL.
 */

import type { CommandEnvelope } from "../../contracts/command/command-envelope";
import type { ConnectorBoundaryOutcome, ConnectorInvoker } from "../../control/connector-execution-boundary/types";
import { validateOwnerSession } from "../../control/owner-authentication/contract";
import { MacOsKeychainProvider } from "../../credentials/macos-keychain/provider";
import {
  DEPLOY_EXISTING_SERVICE_REVISION_MUTATION,
  RAILWAY_ENVIRONMENT_ID,
  REDEPLOY_DEPLOYMENT_MUTATION,
  isRecord,
  railwayGraphql,
  stringField,
} from "./graphql";

const productionKeychainProvider = new MacOsKeychainProvider();

const READ_INTENTS = new Set([
  "railway.project_status",
  "railway.environment_status",
  "railway.list_project_services",
  "railway.get_service_instance",
  "railway.get_source_status",
  "railway.list_variable_names",
  "railway.get_deployment",
  "railway.get_deployment_logs",
  "railway.get_domain",
  "railway.introspect_deploy_mutation",
]);

const MUTATION_INTENTS = new Set([
  "railway.create_service",
  "railway.connect_source",
  "railway.create_deployment_trigger",
  "railway.deploy_revision",
  "railway.redeploy_deployment",
  "railway.create_domain",
]);

function forbiddenGenericGraphql(payload: Record<string, unknown>): boolean {
  return "query" in payload || "graphql" in payload || "mutation" in payload || "raw_graphql" in payload;
}

type ValidateOwnerSessionFn = typeof validateOwnerSession;
type RailwayGraphqlFn = typeof railwayGraphql;

let validateOwnerSessionImpl: ValidateOwnerSessionFn = validateOwnerSession;
let railwayGraphqlImpl: RailwayGraphqlFn = railwayGraphql;

export function __setRailwayInvokerTestHooks(hooks?: {
  readonly validateOwnerSession?: ValidateOwnerSessionFn;
  readonly railwayGraphql?: RailwayGraphqlFn;
}): void {
  validateOwnerSessionImpl = hooks?.validateOwnerSession ?? validateOwnerSession;
  railwayGraphqlImpl = hooks?.railwayGraphql ?? railwayGraphql;
}

function ensureOwnerAuthorization(payload: Record<string, unknown>): { ok: true } | { ok: false; outcome: ConnectorBoundaryOutcome } {
  const ownerSessionId = typeof payload.owner_session_id === "string" ? payload.owner_session_id.trim() : "";
  if (!ownerSessionId) {
    return {
      ok: false,
      outcome: { ok: false, auth_required: true, summary: "OWNER_AUTHORIZATION_REQUIRED", evidence: [], artifacts: [] },
    };
  }
  const verified = validateOwnerSessionImpl(ownerSessionId) as { ok: boolean };
  if (!verified.ok) {
    return {
      ok: false,
      outcome: { ok: false, auth_required: true, summary: "OWNER_AUTHORIZATION_DENIED", evidence: [], artifacts: [] },
    };
  }
  return { ok: true };
}

function outcomeFromGraphql(
  result: Awaited<ReturnType<typeof railwayGraphql>>,
  artifacts: ConnectorBoundaryOutcome["artifacts"],
  summaryOk: string,
): ConnectorBoundaryOutcome {
  if (result.auth_required) {
    return { ok: false, auth_required: true, summary: result.summary, evidence: [], artifacts: [] };
  }
  if (result.errors.length > 0 || !result.data) {
    const note = JSON.stringify(result.errors).slice(0, 400);
    return {
      ok: false,
      auth_required: false,
      summary: result.summary,
      evidence: [{ source: "connections/railway/router-invoker.ts", note }],
      artifacts,
    };
  }
  return {
    ok: true,
    auth_required: false,
    summary: summaryOk,
    evidence: [{ source: "connections/railway/router-invoker.ts", note: "typed intent; no client GraphQL" }],
    artifacts,
  };
}

async function environmentStatus(): Promise<ConnectorBoundaryOutcome> {
  const result = await railwayGraphqlImpl(
    `query EnvironmentStatus($id: String!) { environment(id: $id) { id name projectId } }`,
    { id: RAILWAY_ENVIRONMENT_ID },
    productionKeychainProvider,
  );
  const env = result.data && isRecord(result.data["environment"]) ? result.data["environment"] : null;
  const artifacts = env ? [{ kind: "environment_id", ref: stringField(env, "id") ?? "" }] : [];
  const name = env ? stringField(env, "name") ?? "" : "";
  const projectId = env ? stringField(env, "projectId") ?? "" : "";
  const base = outcomeFromGraphql(result, artifacts, `railway environment "${name}" reachable, project ${projectId}`);
  if (!base.ok || !env) return base;
  return {
    ...base,
    artifacts: [
      { kind: "environment_id", ref: stringField(env, "id") ?? "" },
      { kind: "project_id", ref: projectId },
      { kind: "environment_name", ref: name },
    ],
  };
}

async function projectStatus(projectId: string): Promise<ConnectorBoundaryOutcome> {
  const result = await railwayGraphqlImpl(
    `query ProjectStatus($id: String!) { project(id: $id) { id name description } }`,
    { id: projectId },
    productionKeychainProvider,
  );
  const project = result.data && isRecord(result.data["project"]) ? result.data["project"] : null;
  const artifacts: Array<{ kind: string; ref: string }> = [];
  if (project) {
    artifacts.push({ kind: "project_id", ref: stringField(project, "id") ?? projectId });
    artifacts.push({ kind: "project_name", ref: stringField(project, "name") ?? "" });
    artifacts.push({ kind: "project_description", ref: stringField(project, "description") ?? "" });
  }
  return outcomeFromGraphql(result, artifacts, "project status read");
}

async function listProjectServices(projectId: string | undefined): Promise<ConnectorBoundaryOutcome> {
  let id = projectId ?? "";
  if (!id) {
    const env = await environmentStatus();
    const found = env.artifacts.find((row) => row.kind === "project_id");
    id = found?.ref ?? "";
  }
  if (!id) return { ok: false, auth_required: false, summary: "project_id unavailable", evidence: [], artifacts: [] };
  const result = await railwayGraphqlImpl(
    `query ProjectServices($id: String!) { project(id: $id) { id name services { edges { node { id name } } } } }`,
    { id },
    productionKeychainProvider,
  );
  const project = result.data && isRecord(result.data["project"]) ? result.data["project"] : null;
  const artifacts: Array<{ kind: string; ref: string }> = [{ kind: "project_id", ref: id }];
  if (project && isRecord(project["services"]) && Array.isArray((project["services"] as { edges?: unknown }).edges)) {
    const edges = (project["services"] as { edges: unknown[] }).edges;
    for (const edge of edges) {
      if (!isRecord(edge) || !isRecord(edge["node"])) continue;
      const node = edge["node"];
      const name = stringField(node, "name") ?? "";
      const serviceId = stringField(node, "id") ?? "";
      if (serviceId) artifacts.push({ kind: `service:${name || "unnamed"}`, ref: serviceId });
    }
  }
  return outcomeFromGraphql(result, artifacts, `listed railway services for project ${id}`);
}

async function getServiceInstance(serviceId: string, environmentId: string): Promise<ConnectorBoundaryOutcome> {
  const result = await railwayGraphqlImpl(
    `query ServiceInstance($serviceId: String!, $environmentId: String!) {
      serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
        domains { serviceDomains { domain } }
        latestDeployment { id status meta canRedeploy }
      }
      service(id: $serviceId) { id name }
    }`,
    { serviceId, environmentId },
    productionKeychainProvider,
  );
  const artifacts: Array<{ kind: string; ref: string }> = [
    { kind: "service_id", ref: serviceId },
    { kind: "environment_id", ref: environmentId },
  ];
  const instance = result.data && isRecord(result.data["serviceInstance"]) ? result.data["serviceInstance"] : null;
  const service = result.data && isRecord(result.data["service"]) ? result.data["service"] : null;
  if (service) artifacts.push({ kind: "service_name", ref: stringField(service, "name") ?? "" });
  if (instance && isRecord(instance["domains"]) && isRecord((instance["domains"] as Record<string, unknown>)["serviceDomains"])) {
    /* ignore */
  }
  if (instance && Array.isArray((instance["domains"] as { serviceDomains?: unknown } | undefined)?.serviceDomains)) {
    for (const domain of ((instance["domains"] as { serviceDomains: unknown[] }).serviceDomains)) {
      if (isRecord(domain) && stringField(domain, "domain")) artifacts.push({ kind: "runtime_domain", ref: stringField(domain, "domain") ?? "" });
    }
  }
  if (instance && isRecord(instance["latestDeployment"])) {
    const dep = instance["latestDeployment"];
    artifacts.push({ kind: "latest_deployment_id", ref: stringField(dep, "id") ?? "" });
    artifacts.push({ kind: "latest_deployment_status", ref: stringField(dep, "status") ?? "" });
    artifacts.push({ kind: "can_redeploy", ref: dep["canRedeploy"] === true ? "true" : "false" });
  }
  return outcomeFromGraphql(result, artifacts, "service instance read");
}

async function getSourceStatus(serviceId: string): Promise<ConnectorBoundaryOutcome> {
  const result = await railwayGraphqlImpl(
    `query SourceStatus($serviceId: String!) {
      service(id: $serviceId) {
        id
        name
        source { repo owner branch provider }
      }
    }`,
    { serviceId },
    productionKeychainProvider,
  );
  const service = result.data && isRecord(result.data["service"]) ? result.data["service"] : null;
  const source = service && isRecord(service["source"]) ? service["source"] : null;
  const artifacts: Array<{ kind: string; ref: string }> = [{ kind: "service_id", ref: serviceId }];
  if (source) {
    artifacts.push({ kind: "source_provider", ref: stringField(source, "provider") ?? "" });
    artifacts.push({ kind: "source_owner", ref: stringField(source, "owner") ?? "" });
    artifacts.push({ kind: "source_repo", ref: stringField(source, "repo") ?? "" });
    artifacts.push({ kind: "source_branch", ref: stringField(source, "branch") ?? "" });
  }
  return outcomeFromGraphql(result, artifacts, "source status read");
}

async function listVariableNames(environmentId: string): Promise<ConnectorBoundaryOutcome> {
  const result = await railwayGraphqlImpl(
    `query VariableNames($environmentId: String!) {
      environment(id: $environmentId) { id variables { edges { node { name } } } }
    }`,
    { environmentId },
    productionKeychainProvider,
  );
  const env = result.data && isRecord(result.data["environment"]) ? result.data["environment"] : null;
  const variables = env && isRecord(env["variables"]) && Array.isArray((env["variables"] as { edges?: unknown }).edges)
    ? (env["variables"] as { edges: unknown[] }).edges
    : [];
  const artifacts: Array<{ kind: string; ref: string }> = [{ kind: "environment_id", ref: environmentId }];
  for (const edge of variables) {
    if (!isRecord(edge) || !isRecord(edge["node"])) continue;
    const name = stringField(edge["node"], "name");
    if (name) artifacts.push({ kind: `variable_name:${name}`, ref: name });
  }
  return outcomeFromGraphql(result, artifacts, "variable names read");
}

async function getDeployment(deploymentId: string): Promise<ConnectorBoundaryOutcome> {
  const result = await railwayGraphqlImpl(
    `query Deployment($id: String!) {
      deployment(id: $id) { id status staticUrl meta createdAt canRedeploy serviceId environmentId }
    }`,
    { id: deploymentId },
    productionKeychainProvider,
  );
  const dep = result.data && isRecord(result.data["deployment"]) ? result.data["deployment"] : null;
  const artifacts: Array<{ kind: string; ref: string }> = [{ kind: "deployment_id", ref: deploymentId }];
  if (dep) {
    artifacts.push({ kind: "deployment_status", ref: stringField(dep, "status") ?? "" });
    artifacts.push({ kind: "static_url", ref: stringField(dep, "staticUrl") ?? "" });
    artifacts.push({ kind: "can_redeploy", ref: dep["canRedeploy"] === true ? "true" : "false" });
    const meta = dep["meta"];
    if (isRecord(meta)) {
      const sha = stringField(meta, "commitHash") ?? stringField(meta, "commitSha") ?? stringField(meta, "imageDigest");
      if (sha) artifacts.push({ kind: "provider_revision", ref: sha });
    }
  }
  return outcomeFromGraphql(result, artifacts, dep ? `deployment ${stringField(dep, "status")}` : "deployment read");
}

async function getDeploymentLogs(deploymentId: string): Promise<ConnectorBoundaryOutcome> {
  const result = await railwayGraphqlImpl(
    `query DeploymentLogs($id: String!) {
      deployment(id: $id) { id logs }
    }`,
    { id: deploymentId },
    productionKeychainProvider,
  );
  const dep = result.data && isRecord(result.data["deployment"]) ? result.data["deployment"] : null;
  const logs = dep ? stringField(dep, "logs") ?? "" : "";
  const artifacts = [
    { kind: "deployment_id", ref: deploymentId },
    { kind: "logs", ref: logs.slice(0, 4000) },
  ];
  return outcomeFromGraphql(result, artifacts, "deployment logs read");
}

async function getDomain(serviceId: string, environmentId: string): Promise<ConnectorBoundaryOutcome> {
  const result = await railwayGraphqlImpl(
    `query CurrentDomain($serviceId: String!, $environmentId: String!) {
      serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
        domains { serviceDomains { domain } }
      }
    }`,
    { serviceId, environmentId },
    productionKeychainProvider,
  );
  const instance = result.data && isRecord(result.data["serviceInstance"]) ? result.data["serviceInstance"] : null;
  const domains = Array.isArray((instance?.domains as { serviceDomains?: unknown } | undefined)?.serviceDomains)
    ? (instance?.domains as { serviceDomains: unknown[] }).serviceDomains
    : [];
  const artifacts: Array<{ kind: string; ref: string }> = [{ kind: "service_id", ref: serviceId }, { kind: "environment_id", ref: environmentId }];
  for (const domain of domains) {
    if (!isRecord(domain)) continue;
    const value = stringField(domain, "domain");
    if (value) artifacts.push({ kind: "runtime_domain", ref: value });
  }
  return outcomeFromGraphql(result, artifacts, "domain status read");
}

async function introspectDeploy(): Promise<ConnectorBoundaryOutcome> {
  const result = await railwayGraphqlImpl(
    `query IntrospectDeployMutation { __type(name: "Mutation") { fields { name } } }`,
    undefined,
    productionKeychainProvider,
  );
  const type = result.data && isRecord(result.data["__type"]) ? result.data["__type"] : null;
  const fields = type && Array.isArray(type["fields"]) ? type["fields"] : [];
  const names: string[] = [];
  for (const field of fields) {
    if (isRecord(field)) {
      const name = stringField(field, "name");
      if (name) names.push(name);
    }
  }
  const present = names.includes("serviceInstanceDeployV2");
  return outcomeFromGraphql(
    result,
    [{ kind: "deploy_mutation_field", ref: present ? "serviceInstanceDeployV2" : "ABSENT" }],
    present ? "serviceInstanceDeployV2 present on Mutation" : "serviceInstanceDeployV2 not visible",
  );
}

async function deployRevision(serviceId: string, environmentId: string, commitSha: string): Promise<ConnectorBoundaryOutcome> {
  if (!/^[0-9a-f]{7,40}$/i.test(commitSha)) {
    return { ok: false, auth_required: false, summary: "DEPLOYMENT_REVISION_NOT_FOUND", evidence: [], artifacts: [] };
  }
  const result = await railwayGraphqlImpl(
    DEPLOY_EXISTING_SERVICE_REVISION_MUTATION,
    { serviceId, environmentId, commitSha },
    productionKeychainProvider,
  );
  const errorText = JSON.stringify(result.errors).toLowerCase();
  if (/commit not found|unknown commit|revision not found/.test(errorText)) {
    return {
      ok: false,
      auth_required: false,
      summary: "DEPLOYMENT_REVISION_NOT_FOUND",
      evidence: [{ source: "connections/railway/router-invoker.ts", note: "provider rejected commit" }],
      artifacts: [],
    };
  }
  const id = result.data ? result.data["serviceInstanceDeployV2"] : null;
  const deploymentId = typeof id === "string" ? id : null;
  if (!deploymentId) return outcomeFromGraphql(result, [], "deploy did not return deployment id");
  return {
    ok: true,
    auth_required: false,
    summary: "railway accepted deploy request",
    evidence: [{ source: "connections/railway/router-invoker.ts", note: "serviceInstanceDeployV2" }],
    artifacts: [{ kind: "deployment_id", ref: deploymentId }],
  };
}

async function redeploy(deploymentId: string): Promise<ConnectorBoundaryOutcome> {
  const result = await railwayGraphqlImpl(REDEPLOY_DEPLOYMENT_MUTATION, { id: deploymentId }, productionKeychainProvider);
  const node = result.data && isRecord(result.data["deploymentRedeploy"]) ? result.data["deploymentRedeploy"] : null;
  const artifacts = node ? [{ kind: "deployment_id", ref: stringField(node, "id") ?? deploymentId }] : [];
  return outcomeFromGraphql(result, artifacts, "redeploy requested");
}

async function createService(projectId: string, name: string): Promise<ConnectorBoundaryOutcome> {
  const result = await railwayGraphqlImpl(
    `mutation CreateService($projectId: String!, $name: String!) {
      serviceCreate(input: { projectId: $projectId, name: $name }) { id name }
    }`,
    { projectId, name },
    productionKeychainProvider,
  );
  const node = result.data && isRecord(result.data["serviceCreate"]) ? result.data["serviceCreate"] : null;
  const artifacts = node
    ? [{ kind: "project_id", ref: projectId }, { kind: "service_id", ref: stringField(node, "id") ?? "" }, { kind: "service_name", ref: stringField(node, "name") ?? name }]
    : [];
  return outcomeFromGraphql(result, artifacts, "service created");
}

async function connectSource(serviceId: string, owner: string, repo: string): Promise<ConnectorBoundaryOutcome> {
  const result = await railwayGraphqlImpl(
    `mutation ConnectSource($serviceId: String!, $owner: String!, $repo: String!) {
      serviceConnectRepo(serviceId: $serviceId, owner: $owner, repo: $repo)
    }`,
    { serviceId, owner, repo },
    productionKeychainProvider,
  );
  const accepted = result.data ? result.data["serviceConnectRepo"] === true : false;
  const artifacts = accepted
    ? [{ kind: "service_id", ref: serviceId }, { kind: "source_owner", ref: owner }, { kind: "source_repo", ref: repo }]
    : [];
  return outcomeFromGraphql(result, artifacts, accepted ? "source connected" : "source connect requested");
}

async function createDeploymentTrigger(serviceId: string, environmentId: string, commitSha: string): Promise<ConnectorBoundaryOutcome> {
  return deployRevision(serviceId, environmentId, commitSha);
}

async function createDomain(serviceId: string, environmentId: string, domain: string): Promise<ConnectorBoundaryOutcome> {
  const result = await railwayGraphqlImpl(
    `mutation CreateDomain($serviceId: String!, $environmentId: String!, $domain: String!) {
      serviceDomainCreate(serviceId: $serviceId, environmentId: $environmentId, domain: $domain) { domain }
    }`,
    { serviceId, environmentId, domain },
    productionKeychainProvider,
  );
  const created = result.data && isRecord(result.data["serviceDomainCreate"]) ? result.data["serviceDomainCreate"] : null;
  const artifacts = created ? [{ kind: "service_id", ref: serviceId }, { kind: "runtime_domain", ref: stringField(created, "domain") ?? domain }] : [];
  return outcomeFromGraphql(result, artifacts, "domain created");
}

export const invokeRailwayConnector: ConnectorInvoker = async (command: CommandEnvelope): Promise<ConnectorBoundaryOutcome> => {
  const payload = (command.payload && typeof command.payload === "object") ? command.payload as Record<string, unknown> : {};
  if (forbiddenGenericGraphql(payload)) {
    return { ok: false, auth_required: false, summary: "GENERIC_GRAPHQL_FORBIDDEN", evidence: [], artifacts: [] };
  }
  const intent = typeof payload.intent === "string" ? payload.intent : "";
  if (!READ_INTENTS.has(intent) && !MUTATION_INTENTS.has(intent)) {
    return { ok: false, auth_required: false, summary: `unsupported railway intent: ${intent || "none"}`, evidence: [], artifacts: [] };
  }
  if (MUTATION_INTENTS.has(intent)) {
    const authorization = ensureOwnerAuthorization(payload);
    if (!authorization.ok) return authorization.outcome;
  }
  if (intent === "railway.project_status") {
    if (typeof payload.project_id !== "string") {
      return { ok: false, auth_required: false, summary: "project_id required", evidence: [], artifacts: [] };
    }
    return projectStatus(payload.project_id);
  }
  if (intent === "railway.environment_status") return environmentStatus();
  if (intent === "railway.list_project_services") {
    return listProjectServices(typeof payload.project_id === "string" ? payload.project_id : undefined);
  }
  if (intent === "railway.get_service_instance") {
    if (typeof payload.service_id !== "string" || typeof payload.environment_id !== "string") {
      return { ok: false, auth_required: false, summary: "service_id and environment_id required", evidence: [], artifacts: [] };
    }
    return getServiceInstance(payload.service_id, payload.environment_id);
  }
  if (intent === "railway.get_source_status") {
    if (typeof payload.service_id !== "string") {
      return { ok: false, auth_required: false, summary: "service_id required", evidence: [], artifacts: [] };
    }
    return getSourceStatus(payload.service_id);
  }
  if (intent === "railway.list_variable_names") {
    if (typeof payload.environment_id !== "string") {
      return { ok: false, auth_required: false, summary: "environment_id required", evidence: [], artifacts: [] };
    }
    return listVariableNames(payload.environment_id);
  }
  if (intent === "railway.get_deployment") {
    if (typeof payload.deployment_id !== "string") {
      return { ok: false, auth_required: false, summary: "deployment_id required", evidence: [], artifacts: [] };
    }
    return getDeployment(payload.deployment_id);
  }
  if (intent === "railway.get_deployment_logs") {
    if (typeof payload.deployment_id !== "string") {
      return { ok: false, auth_required: false, summary: "deployment_id required", evidence: [], artifacts: [] };
    }
    return getDeploymentLogs(payload.deployment_id);
  }
  if (intent === "railway.get_domain") {
    if (typeof payload.service_id !== "string" || typeof payload.environment_id !== "string") {
      return { ok: false, auth_required: false, summary: "service_id and environment_id required", evidence: [], artifacts: [] };
    }
    return getDomain(payload.service_id, payload.environment_id);
  }
  if (intent === "railway.introspect_deploy_mutation") return introspectDeploy();
  if (intent === "railway.create_service") {
    if (typeof payload.project_id !== "string" || typeof payload.service_name !== "string") {
      return { ok: false, auth_required: false, summary: "project_id and service_name required", evidence: [], artifacts: [] };
    }
    return createService(payload.project_id, payload.service_name);
  }
  if (intent === "railway.connect_source") {
    if (typeof payload.service_id !== "string" || typeof payload.source_owner !== "string" || typeof payload.source_repo !== "string") {
      return { ok: false, auth_required: false, summary: "service_id, source_owner, source_repo required", evidence: [], artifacts: [] };
    }
    return connectSource(payload.service_id, payload.source_owner, payload.source_repo);
  }
  if (intent === "railway.create_deployment_trigger") {
    if (typeof payload.service_id !== "string" || typeof payload.environment_id !== "string" || typeof payload.commit_sha !== "string") {
      return { ok: false, auth_required: false, summary: "service_id, environment_id, commit_sha required", evidence: [], artifacts: [] };
    }
    return createDeploymentTrigger(payload.service_id, payload.environment_id, payload.commit_sha);
  }
  if (intent === "railway.deploy_revision") {
    if (typeof payload.service_id !== "string" || typeof payload.environment_id !== "string" || typeof payload.commit_sha !== "string") {
      return { ok: false, auth_required: false, summary: "typed deploy fields required", evidence: [], artifacts: [] };
    }
    return deployRevision(payload.service_id, payload.environment_id, payload.commit_sha);
  }
  if (intent === "railway.redeploy_deployment") {
    if (typeof payload.deployment_id !== "string") {
      return { ok: false, auth_required: false, summary: "deployment_id required", evidence: [], artifacts: [] };
    }
    return redeploy(payload.deployment_id);
  }
  if (intent === "railway.create_domain") {
    if (typeof payload.service_id !== "string" || typeof payload.environment_id !== "string" || typeof payload.domain !== "string") {
      return { ok: false, auth_required: false, summary: "service_id, environment_id, domain required", evidence: [], artifacts: [] };
    }
    return createDomain(payload.service_id, payload.environment_id, payload.domain);
  }
  return { ok: false, auth_required: false, summary: `unsupported railway intent: ${intent}`, evidence: [], artifacts: [] };
};

export { DEPLOY_EXISTING_SERVICE_REVISION_MUTATION } from "./graphql";
