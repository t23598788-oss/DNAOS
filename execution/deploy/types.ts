/**
 * หน้าที่: type contracts for the Deploy PLAN/GATE layer only — see
 * ./README.md's "Round 1 scope" note. Never a live provider call.
 *
 * Input: none (pure type definitions).
 * Output: `DeployPlanStatus`, `DeployPlanInput`, `DeployPlanResult`.
 * Dependency ที่อนุญาต: none — a leaf contract.
 * สิ่งที่ห้ามแตะ: never add a status value implying a real deploy
 * happened (e.g. "DEPLOYED") — no code path in this folder may ever
 * produce one until `../../connections/vercel/` and
 * `../../governance/release-gate/` are real, per the Owner lock in
 * `../../connections/vercel/README.md`.
 */

export type DeployPlanStatus = "BLOCKED" | "NOT_APPLICABLE";

export interface DeployPlanInput {
  capability_id: string;
  /** From control/external-system-lifecycle's delivery classification — this folder never re-derives it. */
  delivery_target_class: "IN_PROCESS_LOCAL" | "LOCAL_MACOS_OWNER_HOST_PROCESS" | "HOSTED_SERVICE" | "UNRESOLVED";
  correlation_id: string;
}

export interface DeployPlanResult {
  capability_id: string;
  status: DeployPlanStatus;
  reason: string;
  /** Set only when status=BLOCKED — the real, existing file(s) this block is enforced by. */
  blocked_on: readonly string[];
  correlation_id: string;
  created_at: string;
}
