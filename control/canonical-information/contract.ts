export {
  DNA_OS_CANONICAL_INFORMATION_BACKEND,
  CANONICAL_ENUMS,
  ENTITY_TYPES,
  RELATIONSHIP_TYPES,
  DETAIL_LEVELS,
  SOURCE_PRECEDENCE,
} from "./types";
export type {
  CanonicalActivityV1,
  CanonicalBoundaryV1,
  CanonicalConsumerPayloadV1,
  CanonicalEntityV1,
  CanonicalEventV1,
  CanonicalFactV1,
  CanonicalRelationshipV1,
  CanonicalStateV1,
  OwnerInformationProjectionV1,
} from "./types";

export { ensureSafeCanonicalIngest, ingestSafeCanonicalSources } from "./ingest-safe";
export {
  canonicalMetrics,
  consumerPayload,
  documentationProjection,
  frontendBoundary,
  getActiveActivities,
  getBoundaries,
  getCurrentState,
  getEvidenceRefs,
  getFacts,
  getRecentEvents,
  getRelationships,
  invalidateEntity,
  listEntitiesByStatus,
  listEntitiesByType,
  liveVerifiedOverridesDocumentation,
  projectOwnerInformation,
  queryBoundary,
  queryEntityByCanonicalName,
  queryEntityById,
  resolveFact,
} from "./query";
export { getStore, resetCanonicalStore } from "./store";
export { ingestProductionCanonical, ingestExistingRemoteProduction } from "./ingest-production";
