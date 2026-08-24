/**
 * หน้าที่: the type contracts for `permissions/write-gate/` — the
 * deterministic Write Gate Owner spec'd 2026-08-19, built on the same
 * pattern as `../execution-policy/`.
 *
 * Input: none (pure type definitions + re-exports).
 * Output: `WriteGateContext`.
 * Dependency ที่อนุญาต: `../../contracts/write-intent/write-intent.ts`,
 * `../../software/capability-registrar/contract.ts` (type only).
 * สิ่งที่ห้ามแตะ: never let `WriteGateContext` carry a resolver
 * function — only real, already-fetched data, same boundary
 * `ExecutionPolicyContext` already enforces ("context consumed, never
 * looked up by this module").
 *
 * NOT_YET_BUILT: no runtime caller yet — see ./tests/policy.test.ts.
 */

import type { CapabilityMetadata } from "../../software/capability-registrar/contract";

export type {
  WriteGateCanonicalReference,
  WriteGateDecision,
  WriteGateDecisionValue,
  WriteGateEvidence,
  WriteIntent,
  WriteOperation,
  WriteTargetType,
} from "../../contracts/write-intent/write-intent";

/** Owner ข้อ 7: "Gate ต้อง query capability-registrar/index ก่อนทุก CREATE" — the real, already-fetched registrar index, resolved once by the caller (mirrors ExecutionPolicyContext's own boundary: this module never re-scans the repo itself). */
export interface WriteGateContext {
  registryIndex: readonly CapabilityMetadata[];
}
