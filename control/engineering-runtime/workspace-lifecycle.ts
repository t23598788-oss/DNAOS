/**
 * After Engineering VERIFIED (remote + CI when required + registry),
 * evaluate disposable local workspaces. Does not invent a second cleanup
 * capability — it supplies DNA OS facts to source-workspace cleanup.
 */

import { latestGithubPublicationProof, latestPublicationPointer, listVerifiedCapabilities, persistWorkspaceCleanup } from "./persist";
import { latestLifecycleForWork } from "./lifecycle";
import { cleanupWorkspacesForWork, type CleanupOutcome } from "../source-workspace/contract";

export async function cleanupAfterEngineeringVerified(workId: string, commandId: string): Promise<readonly CleanupOutcome[]> {
  const lifecycle = latestLifecycleForWork(workId);
  const proof = latestGithubPublicationProof<{
    status?: string;
    ci_required?: boolean;
    remote_sha?: string;
    recorded_at?: string;
  }>(workId);
  const pointer = latestPublicationPointer(workId);
  const registry = listVerifiedCapabilities().some((row) => row.work_id === workId);
  const remoteOk = proof?.status === "CI_VERIFIED" || proof?.status === "REMOTE_COMMIT_VERIFIED";
  const ciOk = proof?.ci_required === false || proof?.status === "CI_VERIFIED";
  const facts = {
    remote_commit_verified: remoteOk && Boolean(pointer?.remote_sha),
    ci_verified_when_required: Boolean(ciOk),
    registry_write_verified: registry,
    final_result_recorded: lifecycle?.stage === "VERIFIED",
    published_sha: pointer?.remote_sha,
  };
  const remaining = await cleanupWorkspacesForWork(workId, facts);
  for (const row of remaining) {
    persistWorkspaceCleanup({
      work_id: workId,
      command_id: commandId,
      workspace_id: row.workspace_id,
      status: row.status,
      reason_code: row.reason_code,
      evidence_id: row.evidence_id,
      recorded_at: new Date().toISOString(),
    });
  }
  return remaining;
}
