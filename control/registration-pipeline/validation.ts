/**
 * หน้าที่: VALIDATION — stage 1, the ONLY stage that checks input shape.
 * Answers exactly one question: "is this candidate structurally complete
 * enough to even attempt classification?" Never checks for a duplicate
 * (that is ./duplicate-resolution.ts's exclusive job), never decides a
 * destination (that is control/artifact-destination/'s, three stages
 * downstream of here).
 *
 * Input: `RegistrationCandidate`.
 * Output: `validateCandidateShape` -> `{ok:true} | {ok:false, reason_code}`.
 * Dependency ที่อนุญาต: ../event-pipeline/contract.ts (types only).
 * สิ่งที่ห้ามแตะ: never call a store, never compute a fingerprint, never
 * call classifyCandidate — shape only.
 */

import type { RegistrationCandidate } from "../event-pipeline/contract";

export type ShapeValidationResult = { ok: true } | { ok: false; reason_code: string };

export function validateCandidateShape(candidate: RegistrationCandidate): ShapeValidationResult {
  if (!candidate.candidate_id) return { ok: false, reason_code: "CANDIDATE_ID_REQUIRED" };
  if (!candidate.name) return { ok: false, reason_code: "CANONICAL_NAME_REQUIRED" };
  if (!candidate.source_location) return { ok: false, reason_code: "SOURCE_LOCATION_REQUIRED" };
  if (!candidate.version) return { ok: false, reason_code: "VERSION_REQUIRED" };
  if (!candidate.evidence_refs || candidate.evidence_refs.length === 0) return { ok: false, reason_code: "EVIDENCE_REQUIRED" };
  if (candidate.kind !== "resource" && candidate.kind !== "capability") return { ok: false, reason_code: "KIND_INVALID" };
  if (candidate.canonical_ref !== undefined && (typeof candidate.canonical_ref !== "object" || !candidate.canonical_ref || typeof candidate.canonical_ref.identity_type !== "string" || !candidate.canonical_ref.identity_type || typeof candidate.canonical_ref.identity_id !== "string" || !candidate.canonical_ref.identity_id)) return { ok: false, reason_code: "CANONICAL_REF_INVALID" };
  if (candidate.projection_kind !== undefined && (typeof candidate.projection_kind !== "string" || !candidate.projection_kind)) return { ok: false, reason_code: "PROJECTION_KIND_INVALID" };
  if ((candidate.canonical_ref === undefined) !== (candidate.projection_kind === undefined)) return { ok: false, reason_code: "PROJECTION_METADATA_INCOMPLETE" };
  return { ok: true };
}
