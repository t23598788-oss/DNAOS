/**
 * หน้าที่: `verifyIntegration()` — the one real entry point for
 * Integration Verification. For every caller-declared
 * `ConsumerRelationshipProof` it re-reads the real registered consumer
 * capability from `store` and checks the exact relationship edge is
 * actually there (never trusts the caller's claim), and independently
 * checks the cited test evidence file actually exists on disk. Only when
 * every proof passes both checks does this report `INTEGRATED`.
 *
 * Input: `IntegrationVerificationInput`, a real `RegistryStore`.
 * Output: `verifyIntegration` -> `IntegrationVerificationResult`.
 * Dependency ที่อนุญาต: ./types.ts, ./host-runtime.ts,
 * ../../software/registry-database/contract.ts (types + findCapability).
 * สิ่งที่ห้ามแตะ: never mark a proof verified because the caller supplied
 * it — `relationship_found` and `evidence_file_exists` are always
 * independently re-derived here.
 */

import { findCapability } from "../../software/registry-database/contract";
import type { RegistryStore } from "../../software/registry-database/contract";
import { fileExistsOnDisk, nowIso } from "./host-runtime";
import type { IntegrationVerificationInput, IntegrationVerificationResult, VerifiedConsumer } from "./types";

export function verifyIntegration(input: IntegrationVerificationInput, store: RegistryStore): IntegrationVerificationResult {
  if (input.proofs.length === 0) {
    return { capability_id: input.capability_id, verified_consumers: [], status: "UNRESOLVED", reason: "NO_PROOFS_SUPPLIED", correlation_id: input.correlation_id, created_at: nowIso() };
  }

  const verified: VerifiedConsumer[] = input.proofs.map((proof) => {
    const consumer = findCapability({ capability_id: proof.consumer_capability_id }, store);
    const relationshipFound = consumer?.relationships?.some((rel) => rel.to_id === input.capability_id && rel.relationship_kind === proof.relationship_kind) ?? false;
    const evidenceExists = fileExistsOnDisk(proof.test_evidence_ref);
    return {
      consumer_capability_id: proof.consumer_capability_id,
      relationship_kind: proof.relationship_kind,
      test_evidence_ref: proof.test_evidence_ref,
      relationship_found: relationshipFound,
      evidence_file_exists: evidenceExists,
    };
  });

  const allVerified = verified.every((v) => v.relationship_found && v.evidence_file_exists);
  const status = allVerified ? "INTEGRATED" : "NOT_INTEGRATED";
  const reason = allVerified
    ? "every declared consumer relationship is real and its cited evidence file exists on disk"
    : `at least one proof failed: ${verified.filter((v) => !v.relationship_found || !v.evidence_file_exists).map((v) => v.consumer_capability_id).join(", ")}`;

  return { capability_id: input.capability_id, verified_consumers: verified, status, reason, correlation_id: input.correlation_id, created_at: nowIso() };
}
