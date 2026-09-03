/**
 * Read-only canonical Resource selection at the registry boundary.
 *
 * V1 deliberately has no precedence rule: one eligible Resource resolves;
 * zero or multiple eligible Resources fail closed. In particular, array
 * order, timestamps, version numbers, and repository_id presence are never
 * authority. This is selection only, not reconciliation or mutation.
 */
import { isAbsolute, relative, resolve } from "node:path";
import { existsSync } from "node:fs";
import { getRepository } from "../repository-registry/contract";
import type { RegistryStore } from "./store-port";
import type { ResourceRow } from "./types";

export interface CanonicalResourceQuery {
  readonly capability_id?: string;
  readonly purpose?: string;
  readonly expected_repository_id?: string;
  readonly expected_world?: string;
  readonly source_location?: string;
  readonly explicit_resource_id?: string;
}

export type CanonicalResourceResolution =
  | { readonly status: "RESOLVED"; readonly resource_id: string; readonly identity: ResourceIdentity; readonly evidence: readonly string[]; readonly reason_code: "ONE_ELIGIBLE_RESOURCE" }
  | { readonly status: "AMBIGUOUS"; readonly candidate_resource_ids: readonly string[]; readonly evidence: readonly string[]; readonly reason_code: "MULTIPLE_EQUALLY_ELIGIBLE_RESOURCES" }
  | { readonly status: "UNRESOLVED"; readonly candidate_resource_ids: readonly string[]; readonly evidence: readonly string[]; readonly reason_code: CanonicalUnresolvedReason }
  | { readonly status: "INELIGIBLE"; readonly resource_id: string; readonly evidence: readonly string[]; readonly reason_code: CanonicalIneligibleReason };

export interface ResourceIdentity {
  readonly resource_id: string;
  readonly source_location: string;
  readonly repository_id: string | null;
  readonly version: string;
  readonly status: ResourceRow["status"];
}

export type CanonicalUnresolvedReason =
  | "CAPABILITY_NOT_FOUND"
  | "REGISTRY_ENUMERATION_UNAVAILABLE"
  | "NO_RESOURCE_MATCH"
  | "PURPOSE_COMPATIBILITY_UNPROVEN"
  | "REPOSITORY_NOT_FOUND"
  | "REPOSITORY_WORLD_UNPROVEN"
  | "PATH_CONTAINMENT_UNPROVEN";

export type CanonicalIneligibleReason =
  | "RESOURCE_NOT_REGISTERED"
  | "RESOURCE_NOT_BOUND_TO_CAPABILITY"
  | "REPOSITORY_MISMATCH"
  | "SOURCE_LOCATION_MISMATCH"
  | "RESOURCE_STATUS_NOT_ELIGIBLE";

function identity(resource: ResourceRow): ResourceIdentity {
  return {
    resource_id: resource.resource_id,
    source_location: resource.source_location,
    repository_id: resource.repository_id,
    version: resource.version,
    status: resource.status,
  };
}

function containedByRoot(sourceLocation: string, repositoryRoot: string): boolean {
  if (!existsSync(repositoryRoot)) return false;
  const source = resolve(isAbsolute(sourceLocation) ? sourceLocation : repositoryRoot, isAbsolute(sourceLocation) ? "" : sourceLocation);
  const root = resolve(repositoryRoot);
  const rest = relative(root, source);
  return rest === "" || (rest !== ".." && !rest.startsWith(`..${requireSeparator()}`) && !isAbsolute(rest));
}

function requireSeparator(): string { return "/"; }

function repositoryEvidence(resource: ResourceRow, query: CanonicalResourceQuery): { ok: true; evidence: string[] } | { ok: false; status: "UNRESOLVED" | "INELIGIBLE"; reason_code: CanonicalUnresolvedReason | CanonicalIneligibleReason; evidence: string[] } {
  if (query.expected_repository_id === undefined && resource.repository_id === null) return { ok: true, evidence: ["repository_id=null; repository provenance not required by query"] };
  if (query.expected_repository_id !== undefined && resource.repository_id !== query.expected_repository_id) {
    return { ok: false, status: "INELIGIBLE", reason_code: "REPOSITORY_MISMATCH", evidence: [`resource.repository_id=${resource.repository_id ?? "null"}`, `expected_repository_id=${query.expected_repository_id}`] };
  }
  if (resource.repository_id === null) return { ok: false, status: "UNRESOLVED", reason_code: "REPOSITORY_NOT_FOUND", evidence: ["repository-bound resolution requires a non-null repository_id"] };
  const repository = getRepository(resource.repository_id);
  if (!repository) return { ok: false, status: "UNRESOLVED", reason_code: "REPOSITORY_NOT_FOUND", evidence: [`repository_id=${resource.repository_id} not found`] };
  if (repository.status !== "ACTIVE") return { ok: false, status: "INELIGIBLE", reason_code: "REPOSITORY_MISMATCH", evidence: [`repository status=${repository.status}`] };
  if (query.expected_world !== undefined) {
    return { ok: false, status: "UNRESOLVED", reason_code: "REPOSITORY_WORLD_UNPROVEN", evidence: [`repository.world=${repository.world}`, `expected_world=${query.expected_world}`, "no authoritative world-classification owner exists"] };
  }
  if (!containedByRoot(resource.source_location, repository.repository_root)) {
    return { ok: false, status: "UNRESOLVED", reason_code: "PATH_CONTAINMENT_UNPROVEN", evidence: [`source_location=${resource.source_location}`, `repository_root=${repository.repository_root}`] };
  }
  return { ok: true, evidence: [`repository_id=${resource.repository_id}`, `repository.status=${repository.status}`, `source_location contained by repository_root`] };
}

function checkResource(resource: ResourceRow, query: CanonicalResourceQuery): { ok: true; evidence: string[] } | { ok: false; status: "UNRESOLVED" | "INELIGIBLE"; reason_code: CanonicalUnresolvedReason | CanonicalIneligibleReason; evidence: string[] } {
  if (resource.status !== "REGISTERED") return { ok: false, status: "INELIGIBLE", reason_code: "RESOURCE_STATUS_NOT_ELIGIBLE", evidence: [`resource.status=${resource.status}; SUPERSEDED/RETIRED semantics are not used as current`] };
  if (query.source_location !== undefined && resource.source_location !== query.source_location) return { ok: false, status: "INELIGIBLE", reason_code: "SOURCE_LOCATION_MISMATCH", evidence: [`source_location=${resource.source_location}`, `expected_source_location=${query.source_location}`] };
  return repositoryEvidence(resource, query);
}

export function resolveCanonicalResource(query: CanonicalResourceQuery, store: RegistryStore): CanonicalResourceResolution {
  // ResourceRow/CapabilityRow has no shared purpose taxonomy or compatibility
  // relation. Never invent one: a purpose-bearing query fails closed until an
  // authoritative mapping exists.
  if (query.purpose !== undefined) return { status: "UNRESOLVED", candidate_resource_ids: [], evidence: [`purpose=${query.purpose}`, "no authoritative purpose compatibility mapping exists"], reason_code: "PURPOSE_COMPATIBILITY_UNPROVEN" };
  if (query.explicit_resource_id !== undefined) {
    const resource = store.findResourceById(query.explicit_resource_id);
    if (!resource) return { status: "UNRESOLVED", candidate_resource_ids: [], evidence: [`resource_id=${query.explicit_resource_id}`], reason_code: "NO_RESOURCE_MATCH" };
    const checked = checkResource(resource, query);
    if (!checked.ok) return { status: checked.status, ...(checked.status === "INELIGIBLE" ? { resource_id: resource.resource_id } : { candidate_resource_ids: [resource.resource_id] }), evidence: checked.evidence, reason_code: checked.reason_code } as CanonicalResourceResolution;
    return { status: "RESOLVED", resource_id: resource.resource_id, identity: identity(resource), evidence: ["explicit_resource_id exact lookup", ...checked.evidence], reason_code: "ONE_ELIGIBLE_RESOURCE" };
  }

  if (query.capability_id === undefined) return { status: "UNRESOLVED", candidate_resource_ids: [], evidence: ["capability_id and explicit_resource_id are both absent"], reason_code: "NO_RESOURCE_MATCH" };
  const capability = store.findCapabilityById(query.capability_id);
  if (!capability) return { status: "UNRESOLVED", candidate_resource_ids: [], evidence: [`capability_id=${query.capability_id}`], reason_code: "CAPABILITY_NOT_FOUND" };
  if (!store.listResourceRows || !store.listResourceCapabilityLinks) return { status: "UNRESOLVED", candidate_resource_ids: [], evidence: ["registry store cannot enumerate ResourceRow and capability links"], reason_code: "REGISTRY_ENUMERATION_UNAVAILABLE" };
  const links = new Set(store.listResourceCapabilityLinks().filter((link) => link.capability_id === query.capability_id).map((link) => link.resource_id));
  const candidates = store.listResourceRows().filter((resource) => links.has(resource.resource_id));
  const eligible: ResourceRow[] = [];
  const rejectionEvidence: string[] = [];
  for (const resource of candidates) {
    const checked = checkResource(resource, query);
    if (checked.ok) eligible.push(resource);
    else {
      rejectionEvidence.push(`${resource.resource_id}:${checked.reason_code}`);
      // An unknown eligibility fact is not the same as an ineligible Resource.
      // Do not select another candidate while one candidate remains unproven.
      if (checked.status === "UNRESOLVED") return { status: "UNRESOLVED", candidate_resource_ids: candidates.map((r) => r.resource_id).sort(), evidence: rejectionEvidence, reason_code: checked.reason_code as CanonicalUnresolvedReason };
    }
  }
  if (eligible.length === 0) return { status: "UNRESOLVED", candidate_resource_ids: candidates.map((r) => r.resource_id).sort(), evidence: rejectionEvidence, reason_code: "NO_RESOURCE_MATCH" };
  if (eligible.length > 1) return { status: "AMBIGUOUS", candidate_resource_ids: eligible.map((r) => r.resource_id).sort(), evidence: ["no authoritative precedence; candidate IDs sorted only for deterministic output", ...rejectionEvidence], reason_code: "MULTIPLE_EQUALLY_ELIGIBLE_RESOURCES" };
  const selected = eligible[0]!;
  return { status: "RESOLVED", resource_id: selected.resource_id, identity: identity(selected), evidence: ["capability binding", ...rejectionEvidence], reason_code: "ONE_ELIGIBLE_RESOURCE" };
}
