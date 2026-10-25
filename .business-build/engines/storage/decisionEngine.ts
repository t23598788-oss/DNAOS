/**
 * Storage Intelligence — Decision Engine. The ONE place in this capability
 * that ever assigns state SAFE. moveSafeToTrash() in engine.ts refuses to
 * move anything not already SAFE — this is the enforcement point for the
 * Trash Policy (only these 9 classifications are ever eligible).
 */
import { randomUUID } from "crypto";
import type {
  StorageResource,
  StorageClassificationResult,
  StorageResourceState,
  StorageReclaimPlan,
} from "@/core/shared/types";
import { TRASH_ELIGIBLE_CLASSIFICATIONS as ELIGIBLE } from "@/core/shared/types";

export function decideState(classification: StorageClassificationResult): StorageResourceState {
  if (classification.classification === "UNKNOWN") return "BLOCKED";
  if (classification.recommended_action === "keep") return "BLOCKED";
  if (classification.recommended_action === "manual_prune_only") return "BLOCKED";
  if (classification.recommended_action === "review") return "BLOCKED";
  if (!ELIGIBLE.includes(classification.classification)) return "BLOCKED";
  if (classification.confidence < 0.6) return "BLOCKED";
  return "SAFE";
}

export function buildReclaimPlan(scanRunId: string, resources: StorageResource[]): StorageReclaimPlan {
  const safe = resources.filter((r) => r.state === "SAFE");
  return {
    plan_id: randomUUID(),
    created_at: new Date().toISOString(),
    resources: safe,
    total_bytes: safe.reduce((sum, r) => sum + r.size_bytes, 0),
    scan_run_id: scanRunId,
  };
}
