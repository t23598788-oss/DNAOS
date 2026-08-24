/**
 * หน้าที่: VALIDATE MUTATION — checks the UpdateRequest's own shape and,
 * critically, that `mutation_payload` carries only the fields its
 * `mutation_type` allows. Any identity-looking key
 * (`canonical_name`/`resource_type`/`domain`/`source_location`/
 * `semantic_fingerprint`/`content_hash`/`owner`) anywhere in
 * `mutation_payload` is rejected outright — IDENTITY_MUTATION_FORBIDDEN,
 * fail-closed, never silently dropped or ignored.
 *
 * Input: `UpdateRequest`.
 * Output: `validateUpdateRequest` -> `{ok:true} | {ok:false, reason_code}`.
 * Dependency ที่อนุญาต: ./types.ts.
 * สิ่งที่ห้ามแตะ: never call a store here — shape/identity-guard only,
 * never a lookup, never a duplicate check.
 */

import type { AddEvidencePayload, AddRelationshipPayload, AddVersionPayload, RemoveRelationshipPayload, UpdateFailureReason, UpdateRequest } from "./types";

export type ShapeValidationResult = { ok: true } | { ok: false; reason_code: UpdateFailureReason };

const KNOWN_MUTATION_TYPES = new Set(["ADD_RELATIONSHIP", "REMOVE_RELATIONSHIP", "ADD_EVIDENCE", "ADD_VERSION"]);

/** Never legal inside mutation_payload, for any mutation_type — these name identity/semantic-identity fields this path may never touch. */
const FORBIDDEN_PAYLOAD_KEYS = new Set(["canonical_name", "name", "resource_type", "domain", "source_location", "source_system", "semantic_fingerprint", "content_hash", "owner", "kind", "data_classification", "scope"]);

function hasForbiddenKey(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null) return false;
  return Object.keys(payload).some((key) => FORBIDDEN_PAYLOAD_KEYS.has(key));
}

export function validateUpdateRequest(request: UpdateRequest): ShapeValidationResult {
  // capability_id === "" is the resource-only sentinel (see
  // ./mutation.ts's own doc comment) — a real, deliberate value, not a
  // missing one. Only resource_id and an entirely-absent capability_id
  // field (undefined) count as shape failures here.
  if (!request.resource_id || request.capability_id === undefined || request.capability_id === null) return { ok: false, reason_code: "UNKNOWN_CAPABILITY" };
  if (!request.expected_current_version) return { ok: false, reason_code: "STALE_VERSION" };
  if (!request.correlation_id) return { ok: false, reason_code: "INVALID_MUTATION_PAYLOAD" };
  if (!KNOWN_MUTATION_TYPES.has(request.mutation_type)) return { ok: false, reason_code: "IDENTITY_MUTATION_FORBIDDEN" };
  if (hasForbiddenKey(request.mutation_payload)) return { ok: false, reason_code: "IDENTITY_MUTATION_FORBIDDEN" };

  const payload = request.mutation_payload as Record<string, unknown> | null;
  if (request.mutation_type === "ADD_RELATIONSHIP" || request.mutation_type === "REMOVE_RELATIONSHIP") {
    const rel = payload as unknown as (AddRelationshipPayload | RemoveRelationshipPayload) | null;
    if (!rel || typeof rel.to_type !== "string" || !rel.to_type || typeof rel.to_id !== "string" || !rel.to_id || typeof rel.relationship_kind !== "string" || !rel.relationship_kind) {
      return { ok: false, reason_code: "INVALID_MUTATION_PAYLOAD" };
    }
  }
  if (request.mutation_type === "ADD_EVIDENCE") {
    const ev = payload as unknown as AddEvidencePayload | null;
    if (!ev || typeof ev.evidence_ref !== "string" || !ev.evidence_ref) return { ok: false, reason_code: "INVALID_MUTATION_PAYLOAD" };
  }
  if (request.mutation_type === "ADD_VERSION") {
    const ver = payload as unknown as AddVersionPayload | null;
    if (!ver || typeof ver.version !== "string" || !ver.version) return { ok: false, reason_code: "INVALID_MUTATION_PAYLOAD" };
  }
  return { ok: true };
}
