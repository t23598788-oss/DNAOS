/**
 * หน้าที่: the public boundary of `software/live-census/` — the only file
 * another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Input: re-exports only.
 * Output: the derivation functions and every type a caller needs. Host
 * observation stays internal on purpose — a caller derives from observations it
 * supplies, so the census can be computed for a synthetic repository in a test.
 * Dependency ที่อนุญาต: ./derive.ts, ./types.ts.
 */

export { allCodeFilesIn } from "./host-runtime";
export { deriveImpact, applyImpact, impactOf } from "./impact";
export type { ImpactFinding } from "./impact";
export { deriveCensus, deriveCapability, deriveStatus, deriveDrift, deriveEdges, deriveDomain, capabilityKey } from "./derive";
export type { Observation } from "./derive";
export type {
  CapabilityRecord, CapabilityStatus, CensusDrift, LiveCensus, VerificationRecord,
  RuntimeState, TestState, RegistrationState, ChangeKind, EdgeState, GraphEdge,
} from "./types";
