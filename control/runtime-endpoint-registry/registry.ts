/**
 * หน้าที่: in-memory store for RuntimeEndpointRegistration.
 * Latest row per endpoint_id wins. Resolve never writes here.
 *
 * Input: validated registrations.
 * Output: registerRuntimeEndpoint, listRuntimeEndpoints, replace store for tests.
 * Dependency ที่อนุญาต: ./types.ts
 * สิ่งที่ห้ามแตะ: ห้ามเก็บ secret; ห้ามใส่ provider identity fields.
 */

import type { RuntimeEndpointRegistration, RuntimeEndpointTransport } from "./types";

const SCOPES = new Set(["CORE_LOCAL", "MAC_LOCAL", "PUBLIC"]);
const TRANSPORTS = new Set(["HTTP", "HTTPS", "STDIO"]);
const SOURCES = new Set(["NODE_LOCAL", "REGISTERED_REMOTE"]);
const STATUSES = new Set(["ACTIVE", "DRAINING", "DISABLED"]);

export type RegistrationRejection =
  | "EMPTY_ENDPOINT_ID"
  | "EMPTY_SERVICE_ID"
  | "INVALID_SCOPE"
  | "INVALID_TRANSPORT"
  | "INVALID_SOURCE"
  | "INVALID_STATUS"
  | "MALFORMED_ADDRESS"
  | "TRANSPORT_ADDRESS_MISMATCH"
  | "FORBIDDEN_FIELD"
  | "SECRET_MATERIAL";

const FORBIDDEN_KEYS = new Set([
  "railway_service_id",
  "railway_environment_id",
  "railway_deployment_id",
  "vercel_deployment_id",
  "provider_name",
  "secret",
  "token",
  "password",
  "shared_secret",
]);

let rows: RuntimeEndpointRegistration[] = [];

export function listRuntimeEndpoints(): readonly RuntimeEndpointRegistration[] {
  return rows.slice();
}

export function replaceRuntimeEndpointsForTests(next: readonly RuntimeEndpointRegistration[]): void {
  rows = next.map((r) => ({ ...r }));
}

export function resetRuntimeEndpointStore(): void {
  rows = [];
}

export function validateRuntimeEndpoint(
  input: RuntimeEndpointRegistration,
): RegistrationRejection | null {
  if (typeof input.endpoint_id !== "string" || input.endpoint_id.trim() === "") return "EMPTY_ENDPOINT_ID";
  if (typeof input.service_id !== "string" || input.service_id.trim() === "") return "EMPTY_SERVICE_ID";
  if (!SCOPES.has(input.scope)) return "INVALID_SCOPE";
  if (!TRANSPORTS.has(input.transport)) return "INVALID_TRANSPORT";
  if (!SOURCES.has(input.source)) return "INVALID_SOURCE";
  if (!STATUSES.has(input.status)) return "INVALID_STATUS";
  for (const key of Object.keys(input as object)) {
    if (FORBIDDEN_KEYS.has(key)) return "FORBIDDEN_FIELD";
  }
  const address = input.address;
  if (typeof address !== "string" || address.trim() === "") return "MALFORMED_ADDRESS";
  if (/secret=|token=|password=/i.test(address)) return "SECRET_MATERIAL";
  if (input.health_path !== null && typeof input.health_path !== "string") return "MALFORMED_ADDRESS";
  return transportMatchesAddress(input.transport, address);
}

function transportMatchesAddress(transport: RuntimeEndpointTransport, address: string): RegistrationRejection | null {
  if (transport === "HTTP") {
    if (!address.startsWith("http://")) return "TRANSPORT_ADDRESS_MISMATCH";
    try { new URL(address); } catch { return "MALFORMED_ADDRESS"; }
    return null;
  }
  if (transport === "HTTPS") {
    if (!address.startsWith("https://")) return "TRANSPORT_ADDRESS_MISMATCH";
    try { new URL(address); } catch { return "MALFORMED_ADDRESS"; }
    return null;
  }
  if (!address.startsWith("stdio:")) return "TRANSPORT_ADDRESS_MISMATCH";
  return null;
}

export function registerRuntimeEndpoint(
  input: RuntimeEndpointRegistration,
): { readonly ok: true; readonly endpoint: RuntimeEndpointRegistration } | { readonly ok: false; readonly rejection: RegistrationRejection } {
  const rejection = validateRuntimeEndpoint(input);
  if (rejection) return { ok: false, rejection };
  const endpoint: RuntimeEndpointRegistration = {
    endpoint_id: input.endpoint_id.trim(),
    service_id: input.service_id.trim(),
    scope: input.scope,
    transport: input.transport,
    address: input.address.trim().replace(/\/+$/, ""),
    health_path: input.health_path === null || input.health_path === "" ? null : input.health_path,
    source: input.source,
    status: input.status,
  };
  const idx = rows.findIndex((r) => r.endpoint_id === endpoint.endpoint_id);
  if (idx >= 0) rows[idx] = endpoint;
  else rows.push(endpoint);
  return { ok: true, endpoint };
}
