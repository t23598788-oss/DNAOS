/**
 * หน้าที่: type contracts for Integration Verification — the stage that
 * proves a newly-REGISTERED capability's declared consumer relationships
 * are real, not caller-declared fiction. Sits after RELATIONSHIP
 * (control/registration-update's ADD_RELATIONSHIP) and before Delivery
 * Target Resolution in control/external-system-lifecycle/.
 *
 * Input: none (pure type definitions).
 * Output: `IntegrationVerificationStatus`, `ConsumerRelationshipProof`,
 * `IntegrationVerificationInput`, `IntegrationVerificationResult`.
 * Dependency ที่อนุญาต: none — a leaf contract.
 * สิ่งที่ห้ามแตะ: never add a field that lets a caller assert
 * "integrated" without a real relationship edge + a real evidence file —
 * see ./resolver.ts, which re-reads both from the real store/filesystem
 * rather than trusting this input's claims.
 */

export type IntegrationVerificationStatus = "INTEGRATED" | "NOT_INTEGRATED" | "UNRESOLVED";

/** One caller-declared claim: "consumer_capability_id already depends on this capability via relationship_kind, proven by test_evidence_ref". Every field is re-verified by ./resolver.ts, never trusted as-is. */
export interface ConsumerRelationshipProof {
  consumer_capability_id: string;
  relationship_kind: string;
  test_evidence_ref: string;
}

export interface IntegrationVerificationInput {
  capability_id: string;
  proofs: readonly ConsumerRelationshipProof[];
  correlation_id: string;
}

export interface VerifiedConsumer {
  consumer_capability_id: string;
  relationship_kind: string;
  test_evidence_ref: string;
  relationship_found: boolean;
  evidence_file_exists: boolean;
}

export interface IntegrationVerificationResult {
  capability_id: string;
  verified_consumers: readonly VerifiedConsumer[];
  status: IntegrationVerificationStatus;
  reason: string;
  correlation_id: string;
  created_at: string;
}
