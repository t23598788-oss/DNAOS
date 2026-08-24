/**
 * หน้าที่: Railway's real `ConnectorInvoker` — the one function
 * `../../control/connector-execution-boundary/registry.ts` is allowed to
 * import from this folder (Capability Folder Law ข้อ 9). Closes over the
 * credential resolution at module load time, matching
 * `connections/digitalocean/router-invoker.ts`'s own composition
 * discipline — the boundary and router never construct or see a
 * credential provider directly.
 *
 * SCOPE THIS ROUND: exactly one read-only intent,
 * "railway.environment_status" — resolves the real project/environment
 * status via Railway's GraphQL API using a Keychain-resolved,
 * project-scoped token (credential://railway/dna-os-infrastructure/
 * production/project-token, registered in credentials/registry/). No
 * write/deploy intent is wired here — proven live this session via a
 * real read-only GraphQL call (environment lookup returned real
 * id/name/projectId matching the already-registered resource).
 *
 * Input: a `CommandEnvelope`.
 * Output: `invokeRailwayConnector` -> `ConnectorBoundaryOutcome`.
 * Dependency ที่อนุญาต: node:https, ../../contracts/command/command-envelope.ts,
 * ../../control/connector-execution-boundary/types.ts (type only),
 * ../../credentials/registry/api-credential-registry.ts,
 * ../../credentials/macos-keychain/provider.ts.
 * สิ่งที่ห้ามแตะ: never resolve/log/return the raw token — it must stay
 * local to resolveEnvironmentStatus()'s own scope. Never add a write/
 * deploy/mutation intent here without a separate, explicit Owner
 * authorization round.
 */

import { request } from "node:https";
import type { CommandEnvelope } from "../../contracts/command/command-envelope";
import type { ConnectorBoundaryOutcome, ConnectorInvoker } from "../../control/connector-execution-boundary/types";
import { findApiCredential } from "../../credentials/registry/api-credential-registry";
import { MacOsKeychainProvider } from "../../credentials/macos-keychain/provider";

const CREDENTIAL_REF = "credential://railway/dna-os-infrastructure/production/project-token";
const ENVIRONMENT_ID = "4d28eafa-9735-4405-a585-55ea354bafab";
const GRAPHQL_ENDPOINT = "https://backboard.railway.com/graphql/v2";

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

async function resolveEnvironmentStatus(provider: MacOsKeychainProvider): Promise<ConnectorBoundaryOutcome> {
  const entry = findApiCredential(CREDENTIAL_REF);
  if (!entry || entry.status !== "ACTIVE") {
    return { ok: false, auth_required: true, summary: `credential_ref "${CREDENTIAL_REF}" not registered or inactive`, evidence: [], artifacts: [] };
  }
  const resolution = await provider.resolve({ service: entry.resolver_service, account: entry.resolver_account, kind: "api_key" });
  if (!resolution.ok) {
    return { ok: false, auth_required: true, summary: `Keychain resolution failed (${resolution.code}): ${resolution.reason}`, evidence: [], artifacts: [] };
  }

  const token = resolution.secret; // local to this call only, never logged, never returned
  const res = await postJson(GRAPHQL_ENDPOINT, { "Project-Access-Token": token }, { query: `query { environment(id: "${ENVIRONMENT_ID}") { id name projectId } }` });

  if (res.status < 200 || res.status >= 300) {
    return { ok: false, auth_required: false, summary: `Railway API returned HTTP ${res.status}`, evidence: [{ source: "connections/railway/router-invoker.ts", note: "non-2xx response" }], artifacts: [] };
  }
  const parsed = JSON.parse(res.text) as { data?: { environment?: { id: string; name: string; projectId: string } }; errors?: unknown[] };
  if (!parsed.data?.environment) {
    return { ok: false, auth_required: false, summary: "Railway API returned no environment data", evidence: [{ source: "connections/railway/router-invoker.ts", note: JSON.stringify(parsed.errors ?? []) }], artifacts: [] };
  }
  return {
    ok: true,
    auth_required: false,
    summary: `railway environment "${parsed.data.environment.name}" reachable, project ${parsed.data.environment.projectId}`,
    evidence: [{ source: "connections/railway/router-invoker.ts", note: `credential_source=${resolution.credential_source}` }],
    artifacts: [{ kind: "environment_id", ref: parsed.data.environment.id }],
  };
}

const productionKeychainProvider = new MacOsKeychainProvider();

export const invokeRailwayConnector: ConnectorInvoker = async (command: CommandEnvelope): Promise<ConnectorBoundaryOutcome> => {
  const payload = command.payload as { intent?: string } | undefined;
  if (payload?.intent !== "railway.environment_status") {
    return { ok: false, auth_required: false, summary: `unsupported railway intent: ${payload?.intent ?? "none"}`, evidence: [], artifacts: [] };
  }
  return resolveEnvironmentStatus(productionKeychainProvider);
};
