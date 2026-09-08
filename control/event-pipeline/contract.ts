/**
 * หน้าที่: the public boundary of `control/event-pipeline/` — the only
 * file another capability folder (e.g. `software/registry-database/`) may
 * import from, per `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md`
 * ข้อ 9. `./registration-contract.ts`, `./domain-classification.ts`, and
 * `./canonical-event-pipeline.ts` stay reachable only through here.
 *
 * Input: re-exports only.
 * Output: `RegistrationCandidate`, `RegistrationFingerprint`,
 * `ClassificationDecision`, `ClassificationResult`, `fingerprintCandidate`,
 * `classifyCandidate` (Domain/Resource Type Classification only — never
 * duplicate detection, that is
 * `control/registration-pipeline/duplicate-resolution.ts`'s exclusive
 * job), plus the Domain Classification boundary types
 * (`RegistrationDomain`, `RegistrationResourceType`, `DomainRoutingResult`,
 * `DomainClassificationResult`, `BatchClassificationResult`) and functions
 * (`classifyRegistrationDomain`, `classifyRegistrationBatch`), plus the
 * AI_INGRESS Type Validation boundary (`IngressMetadata`,
 * `IngressAudience`, `IngressValidationResult`, `validateIngressMetadata`)
 * and `CandidateRelationship` for caller-supplied relationship edges.
 * Dependency ที่อนุญาต: ./registration-contract.ts, ./domain-classification.ts.
 * สิ่งที่ห้ามแตะ: never re-export `./canonical-event-pipeline.ts`'s
 * internals here until a real caller needs them — this round only wires
 * the registration/duplicate-detection gate, not the event ingestion
 * pipeline itself.
 */

export type { RegistrationCandidate, RegistrationFingerprint, CandidateRelationship, ClassificationDecision, ClassificationResult } from "./registration-contract";
export { fingerprintCandidate, classifyCandidate } from "./registration-contract";
export type {
  RegistrationDomain,
  RegistrationResourceType,
  SoftwareResourceType,
  BusinessResourceType,
  DomainRoutingResult,
  DomainClassificationInput,
  DomainClassificationResult,
  BatchClassificationResult,
  IngressAudience,
  IngressMetadata,
  IngressValidationResult,
} from "./domain-classification";
export { classifyRegistrationDomain, classifyRegistrationBatch, validateIngressMetadata } from "./domain-classification";
