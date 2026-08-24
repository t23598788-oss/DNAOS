/**
 * หน้าที่: the Output Contract — the ONE point every execution result
 * splits into exactly one of two lanes, never both, never neither:
 *
 * SYSTEM_STATE  -> a Status/Metrics fact. Read straight by a UI, never
 *                  mediated or re-narrated by an AI agent. Carries no
 *                  Worker/Agent involvement at all.
 * WORK_ITEM     -> a unit of work actually dispatched to a Worker/Agent
 *                  (`control/agent-gateway/`'s AgentAdapter path). Its
 *                  Result/Evidence always comes back through DNA OS's own
 *                  Verify (`confirmDnaOsDecision`) / Register
 *                  (`software/registry-database/registerCandidate`, when
 *                  the work item is a software registration) / Next
 *                  Decision (`computeNextDecisionFromEvidence`) pipeline
 *                  — never handed straight to a UI report page.
 *
 * A UI never invents SYSTEM_STATE on its own — it reads this lane's
 * output only. An Agent never invents its own report page — a WORK_ITEM's
 * only path back is through DNA OS's Verify/Register/Next Decision.
 *
 * Input: none (pure type definitions).
 * Output: `OutputLane`, `SystemStateOutput`, `WorkItemOutput`, `DnaOsOutput`.
 * Dependency ที่อนุญาต: ./capability-result.ts (types only).
 * สิ่งที่ห้ามแตะ: never add a third lane — every result is exactly one of
 * these two. Never let `SystemStateOutput` carry a field only a Worker
 * dispatch could have produced (`dispatcher_task_id`), and never let
 * `WorkItemOutput` omit it.
 */

import type { CapabilityResultArtifact, CapabilityResultEvidence, CapabilityResultStatus } from "./capability-result";

export type OutputLane = "SYSTEM_STATE" | "WORK_ITEM";

export interface SystemStateOutput {
  lane: "SYSTEM_STATE";
  task_id: string;
  capability_id: string;
  status: CapabilityResultStatus;
  summary: string;
  evidence: readonly CapabilityResultEvidence[];
  next_action: string | null;
}

export interface WorkItemOutput {
  lane: "WORK_ITEM";
  task_id: string;
  capability_id: string;
  status: CapabilityResultStatus;
  summary: string;
  evidence: readonly CapabilityResultEvidence[];
  artifacts: readonly CapabilityResultArtifact[];
  /** The real control/agent-gateway/ task_id the dispatched Work Order actually ran under — never the same value as `task_id` above by coincidence, always the real dispatcher_task_id artifact. */
  dispatcher_task_id: string | null;
  next_action: string | null;
}

export type DnaOsOutput = SystemStateOutput | WorkItemOutput;
