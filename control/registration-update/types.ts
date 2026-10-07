/**
 * หน้าที่: the type contracts for the canonical Existing Registration
 * Update path — see ./README.md. Distinct from
 * `control/registration-pipeline/` (CREATE/REGISTER): this folder only
 * ever mutates a row that already exists, and it never touches identity
 * fields (`canonical_name`/`resource_type`/`domain`/source identity/
 * semantic identity).
 *
 * Input: none (pure type definitions).
 * Output: `MutationType`, `AddRelationshipPayload`,
 * `RemoveRelationshipPayload`, `AddEvidencePayload`, `AddVersionPayload`,
 * `UpdateRequest`, `UpdateFailureReason`, `UpdateResult`.
 * Dependency ที่อนุญาต: ../../software/registry-database/contract.ts (types only).
 * สิ่งที่ห้ามแตะ: never add a field that lets a caller set
 * canonical_name/resource_type/domain/content_hash/semantic_fingerprint —
 * this contract has no such field anywhere, by design.
 */

import type { CapabilityLookupResult } from "../../software/registry-database/contract";

export type MutationType = "ADD_RELATIONSHIP" | "REMOVE_RELATIONSHIP" | "ADD_EVIDENCE" | "ADD_VERSION" | "RETIRE";

/**
 * ถอนรายการที่ทะเบียนบอกว่ามีอยู่ แต่ความจริงไม่มี — เพิ่มภายใต้ OWNER UNLOCK 2026-09-04
 * ไม่ลบแถว เปลี่ยนเฉพาะ status เป็น RETIRED เพื่อให้ประวัติยังตรวจสอบได้
 */
export interface RetirePayload {
  reason: string;
}

export interface AddRelationshipPayload {
  to_type: string;
  to_id: string;
  relationship_kind: string;
}

export interface RemoveRelationshipPayload {
  to_type: string;
  to_id: string;
  relationship_kind: string;
}

export interface AddEvidencePayload {
  evidence_ref: string;
}

export interface AddVersionPayload {
  version: string;
  evidence_ref?: string | null;
}

export interface UpdateRequest {
  resource_id: string;
  capability_id: string;
  expected_current_version: string;
  mutation_type: string;
  mutation_payload: unknown;
  evidence_refs: readonly string[];
  correlation_id: string;
}

export type UpdateFailureReason = "UNKNOWN_CAPABILITY" | "STALE_VERSION" | "INVALID_RELATIONSHIP" | "TARGET_NOT_REGISTERED" | "IDENTITY_MUTATION_FORBIDDEN" | "INVALID_MUTATION_PAYLOAD";

export interface UpdateResult {
  status: "APPLIED" | "REJECTED";
  reason_code: UpdateFailureReason | null;
  resource_id: string;
  capability_id: string;
  mutation_type: string;
  correlation_id: string;
  /** The real, freshly-read-back capability after the mutation (or the pre-existing one, unchanged, on rejection) — never a caller-echoed guess. Null only when the capability_id was never found at all. */
  capability: CapabilityLookupResult | null;
}
