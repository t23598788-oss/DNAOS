/**
 * Public boundary of control/semantic-identity/.
 * Derived graph only — existing registries remain authoritative.
 */

export {
  SEMANTIC_IDENTITY_CONTRACT_ID,
  SEMANTIC_IDENTITY_CONTRACT_VERSION,
} from "./types";
export type {
  SemanticKind,
  SemanticId,
  SemanticRelation,
  SemanticLifecycleState,
  SemanticDescriptor,
  SemanticEdge,
  SemanticNode,
  SemanticGraph,
  SemanticDoctorReport,
  SemanticDiscoveryResult,
  SemanticDiscoveryDiagnostics,
  SemanticDiagnostic,
  SemanticSourceRef,
  SemanticObservation,
} from "./types";

export {
  parseSemanticId,
  assertSemanticId,
  canonicalizeSemanticId,
  kindOf,
  isSemanticKind,
} from "./id";
export { semanticKey } from "./key";
export {
  discoverSemantic,
  discoverSemanticGraph,
  graphFingerprint,
  emptyDiscoveryDiagnostics,
} from "./discover";
export type { DiscoverOptions } from "./discover";
export {
  dependencyClosure,
  impactClosure,
  detectDependencyCycles,
  topologicalDependencyOrder,
  conflictingOwners,
  outgoing,
  incoming,
} from "./graph";
export {
  resolveSemanticId,
  doctorSemanticGraph,
  doctorDiscovery,
  doctorIsHealthy,
  doctorExitCode,
} from "./resolve";
export type { SemanticResolveResult, ResolveStatus } from "./resolve";
export { projectResolveThai, kindToThai, stateToThai } from "./project-th";
export {
  createObservationStore,
  recordObservation,
  applyObservations,
  correlateRuntimeEvent,
  advanceLifecycle,
  lifecycleRank,
} from "./observation";
export { bridgeWorkContextToSemantic } from "./bridge-work-context";
export { PILOT_DESCRIPTORS, INFRA_REPO_ID } from "./pilot-descriptors";
