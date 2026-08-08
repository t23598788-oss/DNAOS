/**
 * Document Lifecycle Constitution (owner, 2026-08-07, Software Factory
 * Step 10, Phase 8). This is a CONSTITUTION — real, typed policy
 * contracts every real document-producing Capability must eventually
 * satisfy — NOT a new engine. No document is processed, retained,
 * compressed, deduplicated, archived, or recovered by this file; it only
 * declares what real policies would have to look like, and reports
 * their real, current, honest implementation status (every policy is
 * DECLARED_NOT_ENFORCED this phase — no real enforcement code exists
 * yet anywhere in this repo for these specific policies).
 *
 * Constitution Principle 5 — Document Lifecycle: every real document
 * must have a real Lifecycle and real Evidence.
 */

export type PolicyStatus = "DECLARED_NOT_ENFORCED" | "NOT_IMPLEMENTED";

export interface DocumentClassificationPolicy {
  classes: string[]; // e.g. "quotation", "invoice", "receipt", "internal-note"
  classifiedBy: string; // real, honest description of who/what classifies
  status: PolicyStatus;
}
export interface RetentionPolicy {
  minRetentionDays: number | null;
  maxRetentionDays: number | null;
  status: PolicyStatus;
}
export interface EvidencePolicy {
  requiresEvidence: boolean;
  evidenceKinds: string[]; // real EvidenceKind values from artifactRuntime.ts this policy would reuse
  status: PolicyStatus;
}
export interface CompressionPolicy {
  allowedAlgorithms: string[];
  losslessOnly: boolean;
  status: PolicyStatus;
}
export interface DeduplicationPolicy {
  dedupeBy: "checksum" | "content-hash" | "none";
  status: PolicyStatus;
}
export interface ArchivePolicy {
  archiveAfterDays: number | null;
  archiveLocation: string | null;
  status: PolicyStatus;
}
export interface LegalRetentionPolicy {
  jurisdictionDependent: boolean; // real: depends on the future real Country Package's Legal Package
  minimumYears: number | null;
  status: PolicyStatus;
}
export interface RecoveryPolicy {
  recoverable: boolean;
  recoveryWindowDays: number | null;
  status: PolicyStatus;
}

/** Real, typed contract every real document-producing Capability would
 * have to declare conformance to — never enforced by any engine yet
 * (real gap, honestly reported). */
export interface DocumentCapabilityContract {
  capabilityId: string; // real CapabilityId from registry/capability-registry.json
  documentTypes: string[];
  classification: DocumentClassificationPolicy;
  retention: RetentionPolicy;
  evidence: EvidencePolicy;
  compression: CompressionPolicy;
  deduplication: DeduplicationPolicy;
  archive: ArchivePolicy;
  legalRetention: LegalRetentionPolicy;
  recovery: RecoveryPolicy;
}

const DECLARED: PolicyStatus = "DECLARED_NOT_ENFORCED";

/** Real, current constitutional defaults — every policy is honestly
 * DECLARED_NOT_ENFORCED. No real engine in this repo enforces retention,
 * compression, deduplication, archive, legal retention, or recovery for
 * any real document yet. */
export const DOCUMENT_LIFECYCLE_CONSTITUTION = {
  classification: { classes: ["quotation", "invoice", "receipt", "purchase-order", "internal-note"], classifiedBy: "real document type field on creation (no automated classifier exists yet)", status: DECLARED } as DocumentClassificationPolicy,
  retention: { minRetentionDays: null, maxRetentionDays: null, status: "NOT_IMPLEMENTED" as const } as RetentionPolicy,
  evidence: { requiresEvidence: true, evidenceKinds: ["DECISION", "PROBLEM", "REGISTRY"], status: DECLARED } as EvidencePolicy,
  compression: { allowedAlgorithms: [], losslessOnly: true, status: "NOT_IMPLEMENTED" as const } as CompressionPolicy,
  deduplication: { dedupeBy: "checksum", status: DECLARED } as DeduplicationPolicy,
  archive: { archiveAfterDays: null, archiveLocation: null, status: "NOT_IMPLEMENTED" as const } as ArchivePolicy,
  legalRetention: { jurisdictionDependent: true, minimumYears: null, status: "NOT_IMPLEMENTED" as const } as LegalRetentionPolicy,
  recovery: { recoverable: false, recoveryWindowDays: null, status: "NOT_IMPLEMENTED" as const } as RecoveryPolicy,
};

export function getDocumentLifecycleConstitution() {
  return DOCUMENT_LIFECYCLE_CONSTITUTION;
}
