/**
 * Common semantic declaration for a logical software/application boundary.
 *
 * This is a declaration contract only. It does not register an application,
 * resolve route ownership, create a deployment/runtime identity, or mutate a
 * lifecycle record.
 */

import { createHash } from "node:crypto";

export const SOFTWARE_APPLICATION_BOUNDARY_SCHEMA_VERSION = "SOFTWARE_APPLICATION_BOUNDARY_V1" as const;
export const SOFTWARE_APPLICATION_BOUNDARY_CONTRACT_ID = "dna-os/software-application-boundary" as const;
export const SOFTWARE_APPLICATION_BOUNDARY_CONTRACT_VERSION = "1.0.0" as const;

export type SoftwareApplicationBoundaryKind = "LOGICAL_APPLICATION";
export type ApplicationBoundaryResolutionState = "RESOLVED" | "UNRESOLVED" | "AMBIGUOUS" | "INELIGIBLE" | "CORRUPT";

/** A logical route reference; host, port, query, and fragment are excluded. */
export interface LogicalRouteReferenceV1 {
  readonly route: string;
}

export interface SoftwareApplicationBoundaryV1 {
  readonly schema_version: typeof SOFTWARE_APPLICATION_BOUNDARY_SCHEMA_VERSION;
  readonly application_id: string;
  readonly boundary_kind: SoftwareApplicationBoundaryKind;
  readonly logical_name: string;
  readonly runtime_entrypoint: string;
  readonly lifecycle_boundary: string;
  readonly owned_route_refs: readonly LogicalRouteReferenceV1[];
  readonly semantic_digest: string;
}

export interface SoftwareApplicationBoundaryValidationResult {
  readonly valid: boolean;
  readonly reason: string;
}

export interface ApplicationBoundaryResolution {
  readonly status: ApplicationBoundaryResolutionState;
  readonly boundary: SoftwareApplicationBoundaryV1 | null;
  readonly reason: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (!isObject(value)) return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

/**
 * Canonical logical route identity. Server behavior proves that query and
 * fragment variants address the same route; host/port are not accepted here
 * because this input is a path reference, not a runtime URL.
 */
export function normalizeLogicalRoute(route: string): string {
  if (typeof route !== "string" || route.trim().length === 0) throw new Error("route must be a non-empty string");
  const withoutFragment = route.trim().split("#", 1)[0];
  const withoutQuery = withoutFragment.split("?", 1)[0];
  const withLeadingSlash = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  if (withLeadingSlash === "/") return "/";
  return withLeadingSlash.replace(/\/+$/, "");
}

function routeSet(routes: readonly LogicalRouteReferenceV1[]): readonly LogicalRouteReferenceV1[] {
  return [...routes].sort((left, right) => left.route.localeCompare(right.route));
}

/** Semantic declaration material. Route ownership is a set, so input order is discarded. */
export function softwareApplicationBoundarySemanticMaterial(input: Omit<SoftwareApplicationBoundaryV1, "semantic_digest">): unknown {
  return {
    schema_version: input.schema_version,
    application_id: input.application_id,
    boundary_kind: input.boundary_kind,
    logical_name: input.logical_name,
    runtime_entrypoint: input.runtime_entrypoint,
    lifecycle_boundary: input.lifecycle_boundary,
    owned_route_refs: routeSet(input.owned_route_refs),
  };
}

export function canonicalSoftwareApplicationBoundaryBytes(input: Omit<SoftwareApplicationBoundaryV1, "semantic_digest">): string {
  return canonicalize(softwareApplicationBoundarySemanticMaterial(input));
}

export function computeSoftwareApplicationBoundaryDigest(input: Omit<SoftwareApplicationBoundaryV1, "semantic_digest">): string {
  return createHash("sha256").update(canonicalSoftwareApplicationBoundaryBytes(input), "utf8").digest("hex");
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

export function freezeSoftwareApplicationBoundary(boundary: SoftwareApplicationBoundaryV1): Readonly<SoftwareApplicationBoundaryV1> {
  return deepFreeze(boundary);
}

export function createSoftwareApplicationBoundary(input: Omit<SoftwareApplicationBoundaryV1, "schema_version" | "semantic_digest" | "owned_route_refs"> & { readonly owned_route_refs: readonly (LogicalRouteReferenceV1 | string)[] }): Readonly<SoftwareApplicationBoundaryV1> {
  const routes = input.owned_route_refs.map((reference) => ({ route: normalizeLogicalRoute(typeof reference === "string" ? reference : reference.route) }));
  const seen = new Set<string>();
  for (const reference of routes) {
    if (seen.has(reference.route)) throw new Error(`duplicate canonical route: ${reference.route}`);
    seen.add(reference.route);
  }
  const base = { schema_version: SOFTWARE_APPLICATION_BOUNDARY_SCHEMA_VERSION, application_id: input.application_id, boundary_kind: input.boundary_kind, logical_name: input.logical_name, runtime_entrypoint: input.runtime_entrypoint, lifecycle_boundary: input.lifecycle_boundary, owned_route_refs: routes } as const;
  return freezeSoftwareApplicationBoundary({ ...base, semantic_digest: computeSoftwareApplicationBoundaryDigest(base) });
}

export function validateSoftwareApplicationBoundary(boundary: unknown): SoftwareApplicationBoundaryValidationResult {
  if (!isObject(boundary)) return { valid: false, reason: "boundary must be an object" };
  if (boundary.schema_version !== SOFTWARE_APPLICATION_BOUNDARY_SCHEMA_VERSION) return { valid: false, reason: "invalid schema_version" };
  if (typeof boundary.application_id !== "string" || boundary.application_id.trim().length === 0) return { valid: false, reason: "application_id must be non-empty" };
  if (boundary.boundary_kind !== "LOGICAL_APPLICATION") return { valid: false, reason: "invalid boundary_kind" };
  for (const field of ["logical_name", "runtime_entrypoint", "lifecycle_boundary"] as const) {
    if (typeof boundary[field] !== "string" || boundary[field].trim().length === 0) return { valid: false, reason: `${field} must be non-empty` };
  }
  if (!Array.isArray(boundary.owned_route_refs) || boundary.owned_route_refs.length === 0) return { valid: false, reason: "owned_route_refs must be a non-empty array" };
  const routes: LogicalRouteReferenceV1[] = [];
  const seen = new Set<string>();
  for (const reference of boundary.owned_route_refs) {
    if (!isObject(reference) || typeof reference.route !== "string" || reference.route.trim().length === 0) return { valid: false, reason: "invalid typed logical route reference" };
    let canonical: string;
    try { canonical = normalizeLogicalRoute(reference.route); } catch { return { valid: false, reason: "invalid logical route" }; }
    if (canonical !== reference.route) return { valid: false, reason: `route is not canonical: ${reference.route}` };
    if (seen.has(canonical)) return { valid: false, reason: `duplicate canonical route: ${canonical}` };
    seen.add(canonical);
    routes.push({ route: canonical });
  }
  if (typeof boundary.semantic_digest !== "string" || !/^[0-9a-f]{64}$/.test(boundary.semantic_digest)) return { valid: false, reason: "invalid semantic_digest" };
  const { semantic_digest, ...withoutDigest } = boundary as unknown as SoftwareApplicationBoundaryV1;
  if (computeSoftwareApplicationBoundaryDigest({ ...withoutDigest, owned_route_refs: routes }) !== semantic_digest) return { valid: false, reason: "semantic_digest does not match canonical semantic material" };
  return { valid: true, reason: "valid immutable software application boundary declaration" };
}
