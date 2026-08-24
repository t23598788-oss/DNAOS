/**
 * หน้าที่: REPOSITORY_RESOLUTION — the stage that closes the verified
 * `repository_id: null` gap in `software/registry-database/registry-writer.ts`.
 * Runs only for a candidate that is about to be written (after
 * Classification + Duplicate Resolution both already passed), never for
 * a candidate that is REJECTED/UNRESOLVED/DUPLICATE at an earlier stage —
 * a DUPLICATE never reaches here, so the original resource's real
 * repository_id is never touched by a later resubmission.
 *
 * Reuses `software/repository-registry/`'s real `getRepository`/
 * `buildRepositoryId` verbatim — the exact same resolution
 * `control/agent-production-ingress/resolver.ts`'s own
 * REPOSITORY_AUTHORITY_RESOLUTION stage already performs. No second
 * repository model, no new store.
 *
 * A candidate's `requested_owner`/`requested_repository` is a CLAIM,
 * never trusted as a repository_id on its own — this function always
 * independently resolves it against the real registry. Neither field
 * present means no repository claim was made at all (e.g. an
 * evidence-only/AI_INGRESS row with no source-code identity) — a
 * legitimate NOT_APPLICABLE, resolving to repository_id: null exactly as
 * every candidate did before this STEP, never a failure. Exactly one
 * field present is an incomplete claim and fails closed. Both present
 * but not resolving to a real, ACTIVE repository fails closed too —
 * repository_id is never silently null after a claim was actually made.
 *
 * Input: `RegistrationCandidate`.
 * Output: `resolveRepositoryOwnership` -> `RepositoryResolutionResult`.
 * Dependency ที่อนุญาต: ../../software/repository-registry/contract.ts,
 * ../event-pipeline/contract.ts (RegistrationCandidate type only).
 * สิ่งที่ห้ามแตะ: never accept a caller-supplied repository_id field —
 * RegistrationCandidate has none; only the owner/repository claim exists,
 * and it is always independently resolved here, never trusted.
 */

import { getRepository, buildRepositoryId } from "../../software/repository-registry/contract";
import type { RegistrationCandidate } from "../event-pipeline/contract";

export type RepositoryResolutionStatus = "RESOLVED" | "NOT_APPLICABLE" | "REJECTED" | "UNRESOLVED";

export interface RepositoryResolutionResult {
  status: RepositoryResolutionStatus;
  repository_id: string | null;
  reason_code: string | null;
}

export function resolveRepositoryOwnership(candidate: RegistrationCandidate): RepositoryResolutionResult {
  const requestedOwner = candidate.requested_owner ?? null;
  const requestedRepository = candidate.requested_repository ?? null;

  if (!requestedOwner && !requestedRepository) {
    return { status: "NOT_APPLICABLE", repository_id: null, reason_code: null };
  }
  if (!requestedOwner || !requestedRepository) {
    return { status: "REJECTED", repository_id: null, reason_code: "INCOMPLETE_REPOSITORY_CLAIM" };
  }

  const repositoryId = buildRepositoryId(requestedOwner, requestedRepository);
  const repository = getRepository(repositoryId);
  if (!repository) {
    return { status: "UNRESOLVED", repository_id: null, reason_code: "REPOSITORY_NOT_FOUND" };
  }
  if (repository.status !== "ACTIVE") {
    return { status: "REJECTED", repository_id: null, reason_code: `REPOSITORY_NOT_ACTIVE:${repository.status}` };
  }
  return { status: "RESOLVED", repository_id: repositoryId, reason_code: null };
}
