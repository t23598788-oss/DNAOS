/**
 * Railway Domain Binding — attach/verify/remove a custom domain on a Railway
 * service, as the capability-parity counterpart of
 * engines/domains/vercel-binding.ts (same three operations, same { ok }
 * result shapes, same gateway/domains.ts preview→confirm→execute flow).
 *
 * Endpoints verified against the real Railway Public API schema (GraphQL,
 * https://backboard.railway.com/graphql/v2 — introspectable, same API that
 * powers the dashboard):
 *   mutation customDomainCreate(input: CustomDomainCreateInput!): CustomDomain!
 *     CustomDomainCreateInput { serviceId!, environmentId!, domain!, targetPort? }
 *   mutation customDomainDelete(id: String!): Boolean!
 *   query domains(projectId, environmentId, serviceId): JSON   (list)
 *   query service(id): Service { projectId }                    (id resolution)
 * Railway returns HTTP 200 with an errors array on failure — errors are
 * read from the body, not just the status code (per docs.railway.com).
 *
 * Credential/source-of-truth note (differs from vercel-binding.ts on
 * purpose, mirrors engines/domains/cloudflare.ts instead): Railway is NOT
 * this app's own hosting — it is a pluggable deployment target. So it uses
 * the canonical connector lifecycle (Connect→Register→Test→Enable,
 * registry/connector-lifecycle.json) via core/connector-loader.ts, never
 * env vars. Required connector record ("railway"):
 *   secret.api_token       — Railway API token (railway.com/account/tokens)
 *   config.service_id      — target Railway service id
 *   config.environment_id  — target Railway environment id
 *   config.base_url        — optional API override (defaults to the real URL)
 * projectId is NOT configured — it is resolved live from the service
 * (Service.projectId), one less thing to drift. Everything fails closed
 * with connectorNotReady() if the connector isn't ready; nothing is mocked.
 */

import { getConnector, getConnectedConnector } from "@/core/connector-loader";
import { supabaseAdmin } from "@/services/supabase/queries";
import { connectorNotReady, type ConnectorNotReadyError } from "./types";

const SLUG = "railway";
const DEFAULT_API_URL = "https://backboard.railway.com/graphql/v2";

/** Token-only resolution — used by resource discovery, which must work
 * BEFORE config.service_id/environment_id are ever set (that's the whole
 * point: the owner never types those ids, the system discovers them). */
async function requireRailwayToken(): Promise<{ apiUrl: string; token: string } | ConnectorNotReadyError> {
  const db = supabaseAdmin();
  const record = await getConnector(db, SLUG);
  if (!record) return connectorNotReady(SLUG, "not_found");
  const connected = await getConnectedConnector(db, SLUG);
  if (!connected) {
    return connectorNotReady(SLUG, record.status === "connected" ? "not_enabled" : "not_connected");
  }
  const token = (connected.secret?.api_token as string) ?? "";
  if (!token) return connectorNotReady(SLUG, "not_connected");
  return { apiUrl: (connected.config?.base_url as string) || DEFAULT_API_URL, token };
}

async function requireRailway(): Promise<
  { apiUrl: string; token: string; serviceId: string; environmentId: string } | ConnectorNotReadyError
> {
  const db = supabaseAdmin();
  const record = await getConnector(db, SLUG);
  if (!record) return connectorNotReady(SLUG, "not_found");
  const connected = await getConnectedConnector(db, SLUG);
  if (!connected) {
    return connectorNotReady(SLUG, record.status === "connected" ? "not_enabled" : "not_connected");
  }
  const token = (connected.secret?.api_token as string) ?? "";
  if (!token) return connectorNotReady(SLUG, "not_connected");
  const serviceId = (connected.config?.service_id as string) ?? "";
  const environmentId = (connected.config?.environment_id as string) ?? "";
  if (!serviceId || !environmentId) {
    return {
      ok: false,
      error: `Connector "railway" ยังไม่ได้ตั้งค่า config.service_id / config.environment_id — แก้ที่ /admin/connectors`,
      connector_slug: SLUG,
      stage: "not_connected",
    };
  }
  return { apiUrl: (connected.config?.base_url as string) || DEFAULT_API_URL, token, serviceId, environmentId };
}

async function gql<T>(
  token: string,
  apiUrl: string,
  query: string,
  variables: Record<string, unknown>
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json().catch(() => null)) as
    | { data?: T; errors?: { message?: string }[] }
    | null;
  if (!res.ok) {
    return { ok: false, error: json?.errors?.[0]?.message ?? `Railway API HTTP ${res.status}` };
  }
  // Railway's real error convention: HTTP 200 + non-empty errors array.
  if (json?.errors?.length) {
    return { ok: false, error: json.errors.map((e) => e.message ?? "unknown error").join("; ") };
  }
  return { ok: true, data: json?.data as T };
}

export interface RailwayCustomDomain {
  id: string;
  domain: string;
  serviceId?: string;
  environmentId?: string;
  status?: unknown;
}

/** Query.domains returns a free-form JSON payload — collect every object in
 * it that honestly looks like a domain record (has both a string `domain`
 * and an `id`), instead of guessing the exact nesting. */
function collectDomainRecords(value: unknown, out: RailwayCustomDomain[], depth = 0): void {
  if (depth > 8 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectDomainRecords(item, out, depth + 1);
    return;
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.domain === "string" && typeof obj.id === "string") {
    out.push({
      id: obj.id,
      domain: obj.domain,
      serviceId: typeof obj.serviceId === "string" ? obj.serviceId : undefined,
      environmentId: typeof obj.environmentId === "string" ? obj.environmentId : undefined,
      status: obj.status,
    });
  }
  for (const v of Object.values(obj)) collectDomainRecords(v, out, depth + 1);
}

async function listServiceDomains(
  conn: { apiUrl: string; token: string; serviceId: string; environmentId: string }
): Promise<{ ok: true; domains: RailwayCustomDomain[] } | { ok: false; error: string }> {
  const svc = await gql<{ service: { projectId: string } }>(
    conn.token, conn.apiUrl,
    `query service($id: String!) { service(id: $id) { projectId } }`,
    { id: conn.serviceId }
  );
  if (!svc.ok) return svc;
  const list = await gql<{ domains: unknown }>(
    conn.token, conn.apiUrl,
    `query domains($projectId: String!, $environmentId: String!, $serviceId: String!) { domains(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) }`,
    { projectId: svc.data.service.projectId, environmentId: conn.environmentId, serviceId: conn.serviceId }
  );
  if (!list.ok) return list;
  const domains: RailwayCustomDomain[] = [];
  collectDomainRecords(list.data.domains, domains);
  return { ok: true, domains };
}

// ── Resource discovery (owner principle: "Human ไม่ใช่ Integration Layer") ──
// The Railway API can discover every id the owner would otherwise have to
// copy from the Railway dashboard: projects → services → environments. The
// owner's only job is to SELECT from this normalized list — never to type
// technical ids. Manual input stays allowed only because this needs a real
// API token the system cannot mint itself (OWNER_REQUIRED for creation).

export interface RailwayResourceNode {
  kind: "project" | "service" | "environment";
  id: string;
  name: string;
  parent_id: string | null;
  children?: RailwayResourceNode[];
}

export async function discoverResources(): Promise<
  { ok: true; resources: RailwayResourceNode[] } | { ok: false; error: string } | ConnectorNotReadyError
> {
  const conn = await requireRailwayToken();
  if ("error" in conn) return conn;
  const r = await gql<{
    projects: {
      edges: { node: {
        id: string; name: string;
        services: { edges: { node: { id: string; name: string } }[] };
        environments: { edges: { node: { id: string; name: string } }[] };
      } }[];
    };
  }>(
    conn.token, conn.apiUrl,
    `query projects($first: Int) { projects(first: $first) { edges { node {
      id name
      services { edges { node { id name } } }
      environments { edges { node { id name } } }
    } } } }`,
    { first: 50 }
  );
  if (!r.ok) return r;
  const resources: RailwayResourceNode[] = r.data.projects.edges.map(({ node: p }) => ({
    kind: "project",
    id: p.id,
    name: p.name,
    parent_id: null,
    children: [
      ...p.services.edges.map(({ node: s }) => ({ kind: "service" as const, id: s.id, name: s.name, parent_id: p.id })),
      ...p.environments.edges.map(({ node: e }) => ({ kind: "environment" as const, id: e.id, name: e.name, parent_id: p.id })),
    ],
  }));
  return { ok: true, resources };
}

// Irreversible-adjacent (exposes the service on a real public hostname) —
// must go through gateway/domains.ts's confirm flow, never a UI direct call.
export async function addDomainToService(
  domain: string,
  targetPort?: number
): Promise<{ ok: true; result: RailwayCustomDomain } | { ok: false; error: string } | ConnectorNotReadyError> {
  const conn = await requireRailway();
  if ("error" in conn) return conn;
  const input: Record<string, unknown> = {
    serviceId: conn.serviceId,
    environmentId: conn.environmentId,
    domain,
  };
  if (targetPort != null) input.targetPort = targetPort;
  const r = await gql<{ customDomainCreate: RailwayCustomDomain }>(
    conn.token, conn.apiUrl,
    `mutation customDomainCreate($input: CustomDomainCreateInput!) { customDomainCreate(input: $input) { id domain serviceId environmentId } }`,
    { input }
  );
  if (!r.ok) return r;
  return { ok: true, result: r.data.customDomainCreate };
}

// Read-only: returns the platform's live verification/issuance status for
// the domain (null when the domain isn't attached to this service).
export async function verifyDomain(
  domain: string
): Promise<{ ok: true; result: RailwayCustomDomain | null } | { ok: false; error: string } | ConnectorNotReadyError> {
  const conn = await requireRailway();
  if ("error" in conn) return conn;
  const list = await listServiceDomains(conn);
  if (!list.ok) return list;
  const wanted = domain.trim().toLowerCase();
  const found = list.domains.find((d) => d.domain.toLowerCase() === wanted) ?? null;
  return { ok: true, result: found };
}

// Read-only listing of every domain attached to the target service.
export async function listDomains(): Promise<
  { ok: true; domains: RailwayCustomDomain[] } | { ok: false; error: string } | ConnectorNotReadyError
> {
  const conn = await requireRailway();
  if ("error" in conn) return conn;
  const list = await listServiceDomains(conn);
  if (!list.ok) return list;
  return { ok: true, domains: list.domains };
}

// Irreversible — removes the domain from this service (downtime until the
// domain is attached somewhere else).
export async function removeDomainFromService(
  domain: string
): Promise<{ ok: true } | { ok: false; error: string } | ConnectorNotReadyError> {
  const conn = await requireRailway();
  if ("error" in conn) return conn;
  const list = await listServiceDomains(conn);
  if (!list.ok) return list;
  const wanted = domain.trim().toLowerCase();
  const target = list.domains.find((d) => d.domain.toLowerCase() === wanted);
  if (!target) {
    return { ok: false, error: `โดเมน ${domain} ไม่ได้ผูกกับ service นี้อยู่ — ไม่มีอะไรถูกลบ` };
  }
  const r = await gql<{ customDomainDelete: boolean }>(
    conn.token, conn.apiUrl,
    `mutation customDomainDelete($id: String!) { customDomainDelete(id: $id) }`,
    { id: target.id }
  );
  if (!r.ok) return r;
  return { ok: true };
}
