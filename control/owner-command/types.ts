/**
 * หน้าที่: the type contracts for `control/owner-command/` — the
 * Owner-facing surface state this folder renders. Deliberately a plain
 * data shape, not a UI component: this repo builds no dashboard/server
 * (see ../../README.md's "no framework deps" convention and
 * ../../governance/architecture-rules/).
 *
 * Input: none (pure type definitions).
 * Output: `OwnerCapabilityStatus`, `OwnerSurfaceState`.
 * Dependency ที่อนุญาต: ../../contracts/command/capability-result.ts
 * (type only), ../command-status/lifecycle.ts (type only).
 * สิ่งที่ห้ามแตะ: never add a field exposing source code, a file path
 * inside another repo, or raw stdout/stderr — the Owner surface shows
 * status/result/evidence/warnings, never IDE-shaped content (Owner scope
 * decision — see ./README.md).
 *
 * NOT_YET_BUILT: nothing renders this to a real transport yet — see
 * ./owner-command.ts's header.
 */

import type { CapabilityResult } from "../../contracts/command/capability-result";
import type { CommandLifecycleStage } from "../command-status/lifecycle";
import type { CapabilityRuntimeStatus } from "../command-router/types";

export interface OwnerCapabilityStatus {
  capability_id: string;
  status: CapabilityRuntimeStatus;
  connected: boolean;
}

/**
 * Everything the Owner sees for ONE command, whether it took one worker
 * or several — matches the Owner-facing rule "Owner only ever sees one
 * task, not each sub-step as a separate surface" (../README.md /
 * ../command-router/README.md).
 */
export interface OwnerSurfaceState {
  current_command: string;
  current_worker: string; // last/only capability_id invoked for this command; "none" before routing starts
  current_status: CommandLifecycleStage;
  progress: "PENDING" | "IN_PROGRESS" | "DONE";
  result: CapabilityResult | null;
  evidence: CapabilityResult["evidence"];
  warnings: CapabilityResult["warnings"];
  available_capabilities: readonly OwnerCapabilityStatus[];
}
