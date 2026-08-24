/**
 * หน้าที่: `submitAgentWork()` — the ONE real entry point an Agent submits
 * work through. Composes only already-real, unmodified capabilities, in
 * strict order:
 *
 *   REPOSITORY_AUTHORITY_RESOLUTION -> WORK_OWNERSHIP
 *   -> SOURCE_WORKSPACE_ISOLATION -> EXISTING_ASSET_LOOKUP
 *   -> DUPLICATE_RESERVATION -> COMPLETE
 *
 * Repository authority resolves FIRST (a plain read, no lock) so the
 * work-ownership claim's SOURCE locks can be scoped to the real,
 * resolved `repository_id` — claiming before resolving would silently
 * scope those locks to "unscoped" and fail to serialize two agents on
 * the same real repository (found and fixed via this folder's own real
 * test, see ./tests/agent-production-ingress.test.ts test C).
 *
 * The Agent supplies only `requested_owner`/`requested_repository`
 * (a CLAIM) — this function independently resolves it against
 * `software/repository-registry/`'s real, already-registered data before
 * ever trusting it for anything downstream. An Agent whose claim does not
 * match a real, ACTIVE registration is rejected here, before any lock is
 * even attempted.
 *
 * SOURCE_WORKSPACE_ISOLATION (real, 2026-08-21): when `resource_scope` is
 * non-empty, a real, isolated `git worktree` is created via
 * `control/source-workspace/` off the repository's own real
 * `default_branch` — never a caller-chosen branch/path. True REMOTE
 * GitHub branch/ref creation remains BLOCKED by two separate, explicit,
 * still-active Owner locks (`execution/run/contract.ts`'s hard block on
 * any `control/` import; `connections/github/host-runtime.ts`'s
 * permanent GET-only/PUT-only fetch restriction) — this stage never
 * touches either; local git worktree isolation is the real, unblocked
 * mechanism this repo can actually provide today.
 *
 * DUPLICATE_RESERVATION now takes a `storeFactory` (never a pre-built
 * store) — see `control/duplicate-reservation/`'s own header for the
 * real, atomic-authoritative-read/write mechanism this closes.
 *
 * Input: `AgentProductionRequest`, a `RegistryStore` factory, the
 * repository's real `repository_root`/`default_branch` (read from
 * `software/repository-registry/`, never caller-supplied).
 * Output: `submitAgentWork` -> `AgentProductionResult`.
 * Dependency ที่อนุญาต: ../../software/repository-registry/contract.ts,
 * ../work-coordination/coordination.ts (claimWork/releaseWorkClaim —
 * imported directly since work-coordination has no separate contract.ts
 * of its own, matching its existing real consumers'
 * `../work-coordination/coordination` import path),
 * ../source-workspace/contract.ts, ../../software/capability-registrar/contract.ts,
 * ../duplicate-reservation/contract.ts,
 * ../../software/registry-database/contract.ts (RegistryStore type only),
 * ./types.ts.
 * สิ่งที่ห้ามแตะ: never trust `requested_owner`/`requested_repository`
 * for anything beyond a repository-registry lookup key. Never call
 * `runRegistrationPipeline`/`classifyCandidate`/`resolveDuplicate`
 * directly — always through `control/duplicate-reservation/`'s
 * `reserveAndRegister`. Never leave a work claim held after this function
 * returns, success or failure alike. Never call `storeFactory()` outside
 * `control/duplicate-reservation/`'s own locked section.
 */

import { getRepository, buildRepositoryId } from "../../software/repository-registry/contract";
import { claimWork, releaseWorkClaim } from "../work-coordination/coordination";
import { createWorkspace } from "../source-workspace/contract";
import { searchOverlap } from "../../software/capability-registrar/contract";
import { reserveAndRegister } from "../duplicate-reservation/contract";
import type { RegistryStore } from "../../software/registry-database/contract";
import type { AgentProductionRequest, AgentProductionResult, AgentProductionStage, AgentProductionStatus } from "./types";

function stop(input: AgentProductionRequest, stage: AgentProductionStage, status: AgentProductionStatus, reason: string, extra: Partial<Pick<AgentProductionResult, "resolved_repository_id" | "workspace" | "overlapping_capabilities" | "resource_id" | "capability_id">> = {}): AgentProductionResult {
  return {
    work_id: input.work_id,
    final_stage: stage,
    final_status: status,
    reason,
    resolved_repository_id: extra.resolved_repository_id ?? null,
    workspace: extra.workspace ?? null,
    overlapping_capabilities: extra.overlapping_capabilities ?? [],
    resource_id: extra.resource_id ?? null,
    capability_id: extra.capability_id ?? null,
    correlation_id: input.correlation_id,
    created_at: new Date().toISOString(),
  };
}

export async function submitAgentWork(input: AgentProductionRequest, storeFactory: () => RegistryStore): Promise<AgentProductionResult> {
  // 1. REPOSITORY_AUTHORITY_RESOLUTION — a plain read, no lock needed yet.
  const repositoryId = buildRepositoryId(input.requested_owner, input.requested_repository);
  const repository = getRepository(repositoryId);
  if (!repository) {
    return stop(input, "REPOSITORY_AUTHORITY_RESOLUTION", "REJECTED", `no real repository registration found for owner=${input.requested_owner} repository=${input.requested_repository} — the Agent's claim does not match any resolved authority`);
  }
  if (repository.status !== "ACTIVE") {
    return stop(input, "REPOSITORY_AUTHORITY_RESOLUTION", "REJECTED", `repository_id=${repositoryId} is real but not ACTIVE (status=${repository.status})`);
  }

  // 2. WORK_OWNERSHIP — real, cross-process-safe (execution/process-lock), scoped to the resolved repository_id.
  const claim = claimWork({ work_id: input.work_id, task_id: input.work_id, holder_agent_id: input.holder_agent_id, repository_id: repositoryId, resource_scope: input.resource_scope, lease_ms: input.lease_ms });
  if (!claim.ok) {
    return stop(input, "WORK_OWNERSHIP", "CONFLICT", claim.reason, { resolved_repository_id: repositoryId });
  }

  try {
    // 3. SOURCE_WORKSPACE_ISOLATION — real, local git worktree (control/source-workspace/), only when there is real source to write.
    let workspace = null;
    if (input.resource_scope.length > 0) {
      const workspaceResult = await createWorkspace({ work_id: input.work_id, repository_id: repositoryId, repository_root: repository.repository_root, base_branch: repository.default_branch });
      if (workspaceResult.status !== "CREATED") {
        return stop(input, "SOURCE_WORKSPACE_ISOLATION", "UNRESOLVED", workspaceResult.reason, { resolved_repository_id: repositoryId });
      }
      workspace = workspaceResult.reservation;
    }

    // 4. EXISTING_ASSET_LOOKUP — real, reused, unmodified; informational only, never blocking on its own.
    const overlaps = searchOverlap(input.candidate.source_location).map((c) => c.CAPABILITY_ID);

    // 5. DUPLICATE_RESERVATION — real, cross-process-atomic (fresh, authoritative store construction inside the fingerprint lock), reuses the unmodified registration pipeline.
    const reservation = reserveAndRegister(input.candidate, storeFactory, input.correlation_id, input.holder_agent_id, input.lease_ms);
    if (reservation.reservation_outcome === "RESERVATION_CONFLICT") {
      return stop(input, "DUPLICATE_RESERVATION", "CONFLICT", `fingerprint reservation held by ${reservation.held_by ?? "unknown"}`, { resolved_repository_id: repositoryId, workspace, overlapping_capabilities: overlaps });
    }
    const pipelineResult = reservation.pipeline_result!;
    if (pipelineResult.status !== "REGISTERED") {
      const status: AgentProductionStatus = pipelineResult.status === "UNRESOLVED" ? "UNRESOLVED" : "REJECTED";
      const reason = pipelineResult.status === "DUPLICATE" ? `${pipelineResult.reason_code}: duplicate of resource_id=${pipelineResult.duplicate_of.resource_id ?? "null"} capability_id=${pipelineResult.duplicate_of.capability_id ?? "null"}` : pipelineResult.reason_code;
      return stop(input, "DUPLICATE_RESERVATION", status, reason, { resolved_repository_id: repositoryId, workspace, overlapping_capabilities: overlaps });
    }

    // 6. COMPLETE — every real stage above genuinely passed.
    return stop(input, "COMPLETE", "PASSED", "work ownership claimed, repository authority resolved, source workspace isolated (or not applicable), no blocking duplicate, real registration committed", {
      resolved_repository_id: repositoryId,
      workspace,
      overlapping_capabilities: overlaps,
      resource_id: pipelineResult.resource_id,
      capability_id: pipelineResult.capability_id,
    });
  } finally {
    releaseWorkClaim(claim.claim);
  }
}
