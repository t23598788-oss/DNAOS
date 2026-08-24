/**
 * หน้าที่: `resolveDeployPlan()` — Round 1 (plan/gate layer only, see
 * ./README.md): decides whether a real deploy could even be attempted,
 * without ever attempting one. `IN_PROCESS_LOCAL` never needs a deploy at
 * all (NOT_APPLICABLE — the capability is already co-located with its
 * consumers, nothing to deploy). Every other class is BLOCKED today,
 * honestly, because the two real dependencies this folder's own README
 * requires are not built yet: `../../governance/release-gate/` (decision
 * layer, NOT_YET_BUILT) and, for HOSTED_SERVICE specifically,
 * `../../connections/vercel/` (Owner-locked NOT_YET_BUILT — see its
 * README's "ห้ามสร้าง write-capable intent" lock, 2026-08-14). This file
 * never imports either — it only cites their real, existing README paths
 * as the reason.
 *
 * Input: `DeployPlanInput`.
 * Output: `resolveDeployPlan` -> `DeployPlanResult`.
 * Dependency ที่อนุญาต: ./types.ts, ./host-runtime.ts.
 * สิ่งที่ห้ามแตะ: never import `../../connections/vercel/` or
 * `../../governance/release-gate/` here — both remain
 * NOT_YET_BUILT/Owner-locked. Never resolve anything but NOT_APPLICABLE
 * for IN_PROCESS_LOCAL, and never anything but BLOCKED for every other
 * class, until those two real dependencies exist.
 */

import { nowIso } from "./host-runtime";
import type { DeployPlanInput, DeployPlanResult } from "./types";

export function resolveDeployPlan(input: DeployPlanInput): DeployPlanResult {
  const created_at = nowIso();

  if (input.delivery_target_class === "IN_PROCESS_LOCAL") {
    return { capability_id: input.capability_id, status: "NOT_APPLICABLE", reason: "in-process library, already co-located with its consumers — this repo has no separate deploy step for it", blocked_on: [], correlation_id: input.correlation_id, created_at };
  }

  if (input.delivery_target_class === "LOCAL_MACOS_OWNER_HOST_PROCESS") {
    return { capability_id: input.capability_id, status: "BLOCKED", reason: "no local host-process deploy adapter exists yet, and governance/release-gate/ (required before any deploy, per execution/deploy/README.md) is still NOT_YET_BUILT", blocked_on: ["governance/release-gate/README.md"], correlation_id: input.correlation_id, created_at };
  }

  if (input.delivery_target_class === "HOSTED_SERVICE") {
    return {
      capability_id: input.capability_id,
      status: "BLOCKED",
      reason: "governance/release-gate/ (required before any deploy) is NOT_YET_BUILT, and connections/vercel/ is Owner-locked against any write-capable deploy intent pending its CHECKS_API_LIVE_TEST_PLAN.md running live (Owner, 2026-08-14)",
      blocked_on: ["governance/release-gate/README.md", "connections/vercel/README.md", "connections/vercel/CHECKS_API_LIVE_TEST_PLAN.md"],
      correlation_id: input.correlation_id,
      created_at,
    };
  }

  return { capability_id: input.capability_id, status: "BLOCKED", reason: "delivery_target_class was never resolved upstream — nothing to plan", blocked_on: [], correlation_id: input.correlation_id, created_at };
}
