/**
 * หน้าที่: `applyMutation()` — the one real entry point for the Existing
 * Registration Update path:
 *
 *   LOOKUP EXISTING REGISTRATION -> UPDATE REQUEST -> VALIDATE MUTATION
 *   -> APPLY RELATIONSHIP/VERSION/EVIDENCE UPDATE -> PERSIST -> READ BACK
 *
 * Distinct owner from `control/registration-pipeline/` (CREATE/REGISTER):
 * this function NEVER classifies, NEVER runs Duplicate Resolution, and
 * NEVER writes a new resource/capability row — it only mutates a row
 * that is already there, confirmed by a real lookup first. Relationship
 * validation reuses the exact same closed vocabulary CREATE uses
 * (`validateCandidateRelationships` from
 * `../../software/registry-database/contract.ts`) — one owner for what a
 * valid relationship is, regardless of which path binds it.
 *
 * Input: `UpdateRequest`, a real `RegistryStore`.
 * Output: `applyMutation` -> `UpdateResult`.
 * Dependency ที่อนุญาต: ./validation.ts, ./types.ts,
 * ../../software/registry-database/contract.ts.
 * สิ่งที่ห้ามแตะ: never call classifyCandidate/fingerprintCandidate/
 * resolveDuplicate/commitRegisteredCandidate here — this file is never a
 * CREATE path. Never accept a mutation_payload key that changes
 * canonical_name/resource_type/domain/semantic identity — see
 * ./validation.ts's fail-closed guard, enforced before this function does
 * anything else.
 */

import { findCapability, findResourceById, validateCandidateRelationships } from "../../software/registry-database/contract";
import type { RegistryStore } from "../../software/registry-database/contract";
import { validateUpdateRequest } from "./validation";
import type { AddEvidencePayload, AddRelationshipPayload, AddVersionPayload, RemoveRelationshipPayload, UpdateFailureReason, UpdateRequest, UpdateResult } from "./types";

function rejected(request: UpdateRequest, reason_code: UpdateFailureReason, capability: ReturnType<typeof findCapability>): UpdateResult {
  return { status: "REJECTED", reason_code, resource_id: request.resource_id, capability_id: request.capability_id, mutation_type: request.mutation_type, correlation_id: request.correlation_id, capability };
}

/**
 * `capability_id === ""` is the resource-only sentinel — a real resource
 * that was registered with `kind: "resource"` (no associated capability
 * row at all, e.g. a SOURCE_REFERENCE artifact from
 * `control/work-result-ingress/`). Everything downstream still applies
 * (shape/identity guard, version check, evidence/version mutations); only
 * ADD_RELATIONSHIP/REMOVE_RELATIONSHIP genuinely require a real
 * capability_id, and `validateCandidateRelationships` already enforces
 * that on its own (`RELATIONSHIP_REQUIRES_CAPABILITY_KIND`).
 */
export function applyMutation(request: UpdateRequest, store: RegistryStore): UpdateResult {
  const resourceOnly = request.capability_id === "";

  // 1. LOOKUP EXISTING REGISTRATION — real, first, before anything else.
  const existing = resourceOnly ? null : findCapability({ capability_id: request.capability_id }, store);
  const existingResource = resourceOnly ? findResourceById(request.resource_id, store) : null;
  if (!resourceOnly && !existing) return rejected(request, "UNKNOWN_CAPABILITY", null);
  if (resourceOnly && !existingResource) return rejected(request, "UNKNOWN_CAPABILITY", null);

  // 2. UPDATE REQUEST + 3. VALIDATE MUTATION — shape and identity-guard only.
  const shape = validateUpdateRequest(request);
  if (!shape.ok) return rejected(request, shape.reason_code, existing);

  // Version check: the caller's expected_current_version must appear
  // among the real, current version(s) — a stale caller (working off an
  // outdated read) never gets to mutate.
  const currentVersions = resourceOnly ? [existingResource!.version] : existing!.version;
  if (!currentVersions.includes(request.expected_current_version)) {
    return rejected(request, "STALE_VERSION", existing);
  }

  // 4. APPLY — one real mutation, exactly the kind requested, nothing else.
  if (request.mutation_type === "ADD_RELATIONSHIP") {
    const payload = request.mutation_payload as AddRelationshipPayload;
    const validation = validateCandidateRelationships([{ to_type: payload.to_type, to_id: payload.to_id, relationship_kind: payload.relationship_kind }], request.capability_id, store);
    if (!validation.ok) {
      const reason: UpdateFailureReason = validation.reason.startsWith("RELATIONSHIP_TARGET_NOT_FOUND") ? "TARGET_NOT_REGISTERED" : "INVALID_RELATIONSHIP";
      return rejected(request, reason, existing);
    }
    for (const row of validation.rows) store.addRelationship(row);
  } else if (request.mutation_type === "REMOVE_RELATIONSHIP") {
    const payload = request.mutation_payload as RemoveRelationshipPayload;
    store.removeRelationship(request.capability_id, payload.to_id, payload.relationship_kind);
  } else if (request.mutation_type === "ADD_EVIDENCE") {
    const payload = request.mutation_payload as AddEvidencePayload;
    store.addEvidence({ evidence_ref: payload.evidence_ref, evidence_type: "update", related_resource_id: request.resource_id, related_capability_id: resourceOnly ? null : request.capability_id });
  } else if (request.mutation_type === "ADD_VERSION") {
    const payload = request.mutation_payload as AddVersionPayload;
    const resource = existingResource ?? findResourceById(request.resource_id, store);
    if (!resource) return rejected(request, "UNKNOWN_CAPABILITY", existing);
    store.addVersion({ resource_id: request.resource_id, version: payload.version, commit_sha: null, hash: resource.content_hash, source_location: resource.source_location, evidence_ref: payload.evidence_ref ?? null });
  }

  // Any additional evidence_refs the caller cited for this update
  // (distinct from an ADD_EVIDENCE mutation_payload itself) are recorded too.
  for (const ref of request.evidence_refs) {
    store.addEvidence({ evidence_ref: ref, evidence_type: "update", related_resource_id: request.resource_id, related_capability_id: resourceOnly ? null : request.capability_id });
  }

  // 5. PERSIST already happened inside the store calls above (technical
  // idempotency only — see store-port.ts). 6. READ BACK — the real,
  // current row, never an echo of what the caller asked for. Resource
  // -only mutations have no CapabilityLookupResult to show; the caller
  // reads back through GET /registry/resources/:id instead.
  const readBack = resourceOnly ? null : findCapability({ capability_id: request.capability_id }, store);
  return { status: "APPLIED", reason_code: null, resource_id: request.resource_id, capability_id: request.capability_id, mutation_type: request.mutation_type, correlation_id: request.correlation_id, capability: readBack };
}
