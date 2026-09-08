/**
 * หน้าที่: the public boundary of `control/event-pipeline/` — the only
 * file another capability folder (e.g. `software/registry-database/`) may
 * import from, per `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md`
 * ข้อ 9. `./registration-contract.ts`, `./domain-classification.ts`, and
 * `./canonical-event-pipeline.ts` stay reachable only through here.
 *
 * Input: re-exports only.
 * Output: registration/classification plus Owner activity producers that
 * emit through `control/owner-backbone` `emitSystemEvent` (Display Queue
 * after persist, then Owner projection).
 * Dependency ที่อนุญาต: ./registration-contract.ts, ./domain-classification.ts,
 * ./owner-activity.ts.
 * สิ่งที่ห้ามแตะ: never re-export `./canonical-event-pipeline.ts`'s
 * internals here until a real caller needs them. Display Queue must never
 * be the execution/coordination queue.
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
export {
  AGENT_DIRECT_UI_WRITE,
  DIRECT_RAW_EVENT_TO_UI,
  EXTERNAL_SELF_VERIFICATION,
  OWNER_ACTIVITY_SOURCE,
  denyDirectOwnerSurfaceWrite,
  ingestOwnerActivity,
  listDisplayQueue,
  loadOwnerActivityEvents,
  projectOwnerActivity,
  recordAgentMessageActivity,
  recordGithubPublicationActivity,
} from "./owner-activity";
export type {
  ActivityHierarchyLevel,
  ActivityStatus,
  ActorType,
  DisplayQueueItem,
  ExternalVerificationProof,
  OwnerActivityEvent,
  OwnerActivityIngest,
  OwnerActivityIngestResult,
  OwnerActivityProjection,
  OwnerProcessingGroup,
  VerificationAuthority,
} from "./owner-activity";
