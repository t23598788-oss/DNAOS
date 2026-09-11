/**
 * Railway GraphQL transport for this capability folder only.
 * Token stays local to each call. Callers never receive the secret.
 */

import { request } from "node:https";
import { findApiCredential } from "../../credentials/registry/api-credential-registry";
import { MacOsKeychainProvider } from "../../credentials/macos-keychain/provider";
import { secretResolutionBackend } from "../../credentials/secret-resolver/node-credential-resolver";
import { resolveProcessEnvironmentSecret } from "../../credentials/process-environment/provider";

export const RAILWAY_CREDENTIAL_REF = "credential://railway/dna-os-infrastructure/production/project-token";
export const RAILWAY_ENVIRONMENT_ID = "4d28eafa-9735-4405-a585-55ea354bafab";
export const GRAPHQL_ENDPOINT = "https://backboard.railway.com/graphql/v2";

export const DEPLOY_EXISTING_SERVICE_REVISION_MUTATION = `mutation DeployExistingServiceRevision($serviceId: String!, $environmentId: String!, $commitSha: String) {
  serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId, commitSha: $commitSha)
}`;

export const REDEPLOY_DEPLOYMENT_MUTATION = `mutation RedeployExistingDeployment($id: String!) {
  deploymentRedeploy(id: $id) { id status }
}`;

export type RailwayGraphqlResult = {
  readonly http_status: number;
  readonly data: Record<string, unknown> | null;
  readonly errors: readonly unknown[];
  readonly auth_required: boolean;
  readonly summary: string;
};

function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<{ status: number; text: string }> {
  return new Promise((resolvePromise, reject) => {
    const payload = JSON.stringify(body);
    const req = request(url, { method: "POST", headers: { ...headers, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolvePromise({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

export async function railwayGraphql(
  document: string,
  variables: Record<string, unknown> | undefined,
  provider: MacOsKeychainProvider,
): Promise<RailwayGraphqlResult> {
  const entry = findApiCredential(RAILWAY_CREDENTIAL_REF);
  if (!entry || entry.status !== "ACTIVE") {
    return { http_status: 0, data: null, errors: [], auth_required: true, summary: `credential_ref "${RAILWAY_CREDENTIAL_REF}" not registered or inactive` };
  }
  let token: string;
  if (secretResolutionBackend("CORE_NODE") === "process_environment") {
    const envResolution = resolveProcessEnvironmentSecret(RAILWAY_CREDENTIAL_REF);
    if (!envResolution.ok) {
      return {
        http_status: 0,
        data: null,
        errors: [],
        auth_required: true,
        summary: `Railway adapter unavailable (${envResolution.code}): ${envResolution.reason}`,
      };
    }
    token = envResolution.secret;
  } else {
    const resolution = await provider.resolve({ service: entry.resolver_service, account: entry.resolver_account, kind: "api_key" });
    if (!resolution.ok) {
      return { http_status: 0, data: null, errors: [], auth_required: true, summary: `Keychain resolution failed (${resolution.code}): ${resolution.reason}` };
    }
    token = resolution.secret;
  }
  const res = await postJson(GRAPHQL_ENDPOINT, { "Project-Access-Token": token }, { query: document, variables: variables ?? {} });
  if (res.status < 200 || res.status >= 300) {
    return { http_status: res.status, data: null, errors: [], auth_required: false, summary: `Railway API returned HTTP ${res.status}` };
  }
  let parsed: { data?: Record<string, unknown> | null; errors?: unknown[] };
  try {
    parsed = JSON.parse(res.text) as { data?: Record<string, unknown> | null; errors?: unknown[] };
  } catch {
    return { http_status: res.status, data: null, errors: [], auth_required: false, summary: "Railway API returned non-JSON" };
  }
  const errors = parsed.errors ?? [];
  return {
    http_status: res.status,
    data: parsed.data ?? null,
    errors,
    auth_required: false,
    summary: errors.length > 0 ? "Railway GraphQL returned errors" : "ok",
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}
