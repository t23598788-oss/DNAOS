/**
 * หน้าที่: ขอบเขตสาธารณะของ software/execution-profile/ — ไฟล์เดียวที่โฟลเดอร์อื่น
 * นำเข้าได้ ตาม governance/architecture-rules/CAPABILITY_FOLDER_LAW.md ข้อ 9
 *
 * Input: re-export เท่านั้น.
 * Output: discovery, profile builder, store, eligibility, readback และชนิดที่ผู้เรียกใช้.
 * Dependency ที่อนุญาต: ./discovery.ts, ./profile.ts, ./store.ts, ./eligibility.ts,
 * ./readback.ts, ./types.ts.
 */
export { discoverExecutionResources } from "./discovery";
export type { DiscoveredExecutionResource } from "./discovery";
export { buildProfiles } from "./profile";
export type { UnregisteredExecutionResource } from "./profile";
export { writeProfiles, readProfiles, latestProfiles, latestProfileFor } from "./store";
export { decideEligibility } from "./eligibility";
export { describeExecutionResources, resolveAccountingRequirement, ACCOUNTING_REQUIREMENT } from "./readback";
export type { ResourceAnswer, MissingCapabilityRequirement } from "./readback";
export type {
  ExecutionProfile, Fact, FactState, VerificationState, ResourceFactSheet,
  EligibilityDecision, EligibilityCheck, EligibilityRequest, EligibilityVerdict,
} from "./types";
