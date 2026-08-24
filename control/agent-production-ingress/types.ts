/**
 * หน้าที่: type contracts for the ONE INGRESS an Agent submits work
 * through. After this point the Agent has no further authority — it may
 * only propose `intent`/`candidate`/`evidence_refs`/`requested_change`;
 * every real decision (world, repository, workspace, lock, duplicate,
 * admission, release) is made by the real capabilities this orchestrator
 * composes, never by the Agent's own claim.
 *
 * Input: none (pure type definitions).
 * Output: `AgentProductionRequest`, `AgentProductionStage`,
 * `AgentProductionResult`.
 * Dependency ที่อนุญาต: ../event-pipeline/contract.ts
 * (RegistrationCandidate — type only), ../source-workspace/contract.ts
 * (WorkspaceReservation — type only).
 * สิ่งที่ห้ามแตะ: never add a field that lets the Agent assert a
 * repository_id/workspace_ref/lock/admission/release outcome directly —
 * `requested_owner`/`requested_repository` are the Agent's CLAIM, always
 * independently re-verified against `software/repository-registry/`'s
 * real, already-registered data before being trusted for anything.
 */

import type { RegistrationCandidate } from "../event-pipeline/contract";
import type { WorkspaceReservation } from "../source-workspace/contract";

export interface AgentProductionRequest {
  work_id: string;
  holder_agent_id: string;
  /** The Agent's CLAIM only — never trusted directly, see ./resolver.ts's REPOSITORY AUTHORITY RESOLUTION stage. */
  requested_owner: string;
  requested_repository: string;
  candidate: RegistrationCandidate;
  /** Real resource paths/scopes this work touches — each gets its own SOURCE lock (see control/work-coordination/coordination.ts's claimWork). A non-empty scope also triggers a real, isolated git worktree via control/source-workspace/. */
  resource_scope: readonly string[];
  lease_ms: number;
  correlation_id: string;
}

export type AgentProductionStage =
  | "REPOSITORY_AUTHORITY_RESOLUTION"
  | "WORK_OWNERSHIP"
  | "SOURCE_WORKSPACE_ISOLATION"
  | "EXISTING_ASSET_LOOKUP"
  | "DUPLICATE_RESERVATION"
  | "COMPLETE";

export type AgentProductionStatus = "PASSED" | "REJECTED" | "CONFLICT" | "UNRESOLVED" | "NOT_APPLICABLE";

export interface AgentProductionResult {
  work_id: string;
  final_stage: AgentProductionStage;
  final_status: AgentProductionStatus;
  reason: string;
  /** Real repository_id this work was actually authorized against — null until REPOSITORY_AUTHORITY_RESOLUTION passes. */
  resolved_repository_id: string | null;
  /** Real, isolated git worktree this Agent may write into — null when resource_scope was empty (NOT_APPLICABLE) or workspace creation failed. */
  workspace: WorkspaceReservation | null;
  /** Existing capabilities found overlapping the candidate's own source_location — informational, from software/capability-registrar/'s real searchOverlap(), never blocking on its own. */
  overlapping_capabilities: readonly string[];
  resource_id: string | null;
  capability_id: string | null;
  correlation_id: string;
  created_at: string;
}
