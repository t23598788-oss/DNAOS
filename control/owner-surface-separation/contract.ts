export {
  STRICT_OPERATIONAL_DEVELOPMENT_SURFACE_SEPARATION,
  OWNER_BIOMETRIC_DEVELOPMENT_GATE,
  DEVELOPMENT_MUTATION_TOOLS,
  OPERATIONAL_ACTIONS,
} from "./types";
export type {
  AuthorityDomain,
  DevelopmentAuthorityLeaseV1,
  DevelopmentChangeProposalV1,
  OwnerSurfaceSessionV1,
  SurfaceId,
} from "./types";

export {
  applyLeasedSourceChange,
  analyzePrechange,
  biometricAuthorizationPreview,
  classifySecurityPath,
  classifySurfaceIntent,
  createDevelopmentAuthority,
  createOwnerSurfaceSession,
  discoverSurfaceTools,
  ensureFixtures,
  expireLease,
  fixtureAllowedFile,
  fixtureOutsideFile,
  fixtureSecurityFile,
  invokeCodingWorker,
  invokeCodingWorkerWithLease,
  leaseIsActive,
  mcpToolAllowedOnSurface,
  operationalModifySource,
  ownerSurfaceSeparationSlice,
  prepareDevelopmentProposal,
  productionPromotionFromLease,
  requestDevelopmentLease,
  routeOperationalCapability,
  sourceReadIsNotWrite,
  switchOwnerSurface,
} from "./surface";

export { latestLease, latestSession } from "./surface";

export { biometricPort, probeNativeBiometric, setBiometricPort, productionBiometricPort } from "./biometric";
export type { BiometricPort } from "./biometric";
export { listNotices } from "./persist";
