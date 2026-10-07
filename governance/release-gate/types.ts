/**
 * หน้าที่: type contracts for Release Authority — Round 1 (per this
 * folder's own README: real, deterministic ELIGIBLE/BLOCKED/UNRESOLVED
 * decision only, never a live deploy). Reads the already-produced
 * `post_commit_verification` Evidence row (never re-runs the real
 * checks — avoids re-triggering `npm run test:integration`, and matches
 * this repo's "never re-decide a prior stage" discipline everywhere
 * else) and re-checks each declared dependency's CURRENT real version
 * against what was declared at build/test time.
 *
 * Input: none (pure type definitions).
 * Output: `ReleaseDecisionStatus`, `DependencyDeclaration`,
 * `ReleaseAuthorityInput`, `ReleaseAuthorityResult`.
 * Dependency ที่อนุญาต: none — leaf contract.
 * สิ่งที่ห้ามแตะ: never add a field that lets a caller pre-supply a
 * `decision` — every field here is only ever produced by
 * ./resolver.ts running the real checks below.
 */

export type ReleaseDecisionStatus = "RELEASE_ELIGIBLE" | "RELEASE_BLOCKED" | "RELEASE_UNRESOLVED";

export interface DependencyDeclaration {
  capability_id: string;
  /** The version this dependency was pinned at when build/test ran — re-checked against the real, current CapabilityLookupResult.version at release-decision time. */
  declared_version: string;
}

export interface ReleaseAuthorityInput {
  task_id: string;
  commit_sha: string;
  repository_id: string;
  declared_dependencies: readonly DependencyDeclaration[];
  required_evidence_refs: readonly string[];
  correlation_id: string;
}

export interface ReleaseAuthorityResult {
  release_decision_id: string;
  status: ReleaseDecisionStatus;
  reason: string;
  commit_sha: string;
  repository_id: string;
  stale_dependencies: readonly string[];
  correlation_id: string;
  created_at: string;
}
