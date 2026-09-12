/**
 * หน้าที่: the only canonical listen-URL resolution path.
 * Read-only. No network. No provider discovery. No hostname inference.
 *
 * Input: endpoint_id or existing service_id; purpose execute|observe.
 * Output: RuntimeEndpointResolution.
 * Dependency ที่อนุญาต: ./types.ts, ./registry.ts (list only).
 * สิ่งที่ห้ามแตะ: ห้าม mutate ทะเบียน; ห้าม import optional-provider adapter modules.
 */

import { listRuntimeEndpoints } from "./registry";
import type {
  RuntimeEndpointPurpose,
  RuntimeEndpointRegistration,
  RuntimeEndpointResolution,
} from "./types";

export interface ResolveRuntimeEndpointInput {
  readonly query: string;
  readonly purpose?: RuntimeEndpointPurpose;
}

function eligible(row: RuntimeEndpointRegistration, purpose: RuntimeEndpointPurpose): boolean {
  if (row.status === "DISABLED") return false;
  if (row.status === "DRAINING") return purpose === "observe";
  return row.status === "ACTIVE";
}

export function resolveRuntimeEndpoint(
  queryOrInput: string | ResolveRuntimeEndpointInput,
): RuntimeEndpointResolution {
  const query = typeof queryOrInput === "string" ? queryOrInput : queryOrInput.query;
  const purpose: RuntimeEndpointPurpose = typeof queryOrInput === "string"
    ? "execute"
    : (queryOrInput.purpose ?? "execute");
  const q = typeof query === "string" ? query.trim() : "";
  if (q === "") return { ok: false, endpoint: null, reason: "INVALID_QUERY" };

  const all = listRuntimeEndpoints();
  const exact = all.filter((r) => r.endpoint_id === q);
  if (exact.length > 1) return { ok: false, endpoint: null, reason: "AMBIGUOUS_ENDPOINT" };
  if (exact.length === 1) {
    const row = exact[0]!;
    if (row.status === "DISABLED") return { ok: false, endpoint: null, reason: "ENDPOINT_DISABLED" };
    if (row.status === "DRAINING" && purpose === "execute") {
      return { ok: false, endpoint: null, reason: "ENDPOINT_DRAINING" };
    }
    if (!eligible(row, purpose)) return { ok: false, endpoint: null, reason: "ENDPOINT_DISABLED" };
    return { ok: true, endpoint: row, reason: null };
  }

  const byService = all.filter((r) => r.service_id === q);
  if (byService.length === 0) return { ok: false, endpoint: null, reason: "UNKNOWN_ENDPOINT" };
  const matches = byService.filter((r) => eligible(r, purpose));
  if (matches.length === 0) {
    if (byService.every((r) => r.status === "DISABLED")) {
      return { ok: false, endpoint: null, reason: "ENDPOINT_DISABLED" };
    }
    if (byService.some((r) => r.status === "DRAINING")) {
      return { ok: false, endpoint: null, reason: "ENDPOINT_DRAINING" };
    }
    return { ok: false, endpoint: null, reason: "UNKNOWN_ENDPOINT" };
  }
  if (matches.length > 1) return { ok: false, endpoint: null, reason: "AMBIGUOUS_ENDPOINT" };
  return { ok: true, endpoint: matches[0]!, reason: null };
}

export function joinEndpointAddress(endpoint: RuntimeEndpointRegistration, extraPath?: string): string {
  const path = extraPath ?? endpoint.health_path;
  if (!path || path === "") return endpoint.address;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const p = path.startsWith("/") ? path : `/${path}`;
  if (endpoint.address.endsWith(p)) return endpoint.address;
  return `${endpoint.address}${p}`;
}
