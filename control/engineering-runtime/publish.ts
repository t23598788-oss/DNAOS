/**
 * หน้าที่: DNA OS source publication rail after local Engineering
 * VERIFIED: Commit Authority then GitHub Publish Authority.
 *
 * Input: EngineeringCompletionResult + checkout_root.
 * Output: EngineeringPublicationResult.
 * Dependency ที่อนุญาต: ./complete.ts types, ./commit-authority.ts,
 * ./github-destination.ts, ./github-publish-authority.ts, ./persist.ts,
 * ../agent-gateway/contract.ts.
 * สิ่งที่ห้ามแตะ: never continueRegisteredArtifact. never deploy. never
 * open a PR. never let the caller choose GitHub destination.
 */

import { randomUUID } from "node:crypto";
import { saveEvidence } from "../agent-gateway/contract";
import { createDnaOsCommit } from "./commit-authority";
import { resolveGithubDestination } from "./github-destination";
import { publishDnaOsCommit, type GithubPublishDeps } from "./github-publish-authority";
import { persistCompletionRegistry } from "./persist";
import { recordGithubPublicationActivity } from "../event-pipeline/contract";
import type { EngineeringCompletionResult, EngineeringLineage, EngineeringPublicationResult } from "./types";

function record(taskId: string, note: string, payload: unknown, lineage?: { correlation_id: string; work_order_id: string }): void {
  saveEvidence({
    evidence_id: `ev-eng-publish-${randomUUID()}`,
    task_id: taskId,
    correlation_id: lineage?.correlation_id,
    work_order_id: lineage?.work_order_id,
    kind: "execution_output",
    source: "control/engineering-runtime/publish.ts",
    recorded_at: new Date().toISOString(),
    payload: { note, ...((typeof payload === "object" && payload !== null) ? payload as Record<string, unknown> : { payload }) },
  });
}

function blocked(
  completion: EngineeringCompletionResult,
  reason_code: EngineeringPublicationResult["reason_code"],
  detail: string,
  extra: Partial<EngineeringPublicationResult> = {},
): EngineeringPublicationResult {
  const lineage: EngineeringLineage = {
    ...completion.lineage,
    ...(extra.lineage ?? {}),
    publish_status: extra.publish?.reason_code ?? extra.commit?.reason_code ?? reason_code,
  };
  persistCompletionRegistry({
    kind: "github_publish",
    status: "BLOCKED",
    reason_code,
    detail,
    command_id: completion.lineage.command_id,
    work_id: completion.lineage.work_id,
    repository_id: completion.lineage.repository_id,
    manifest_id: completion.lineage.manifest_id,
    dna_os_commit_sha: extra.commit?.commit_sha ?? null,
    publish: extra.publish ?? null,
  });
  return {
    status: "BLOCKED",
    reason_code,
    detail,
    completion,
    commit: extra.commit ?? null,
    publish: extra.publish ?? null,
    lineage,
  };
}

export async function publishEngineeringSource(input: {
  readonly completion: EngineeringCompletionResult;
  readonly checkout_root: string;
  readonly requested?: { readonly owner?: string; readonly repository?: string; readonly branch?: string };
  readonly deps?: GithubPublishDeps;
}): Promise<EngineeringPublicationResult> {
  const completion = input.completion;
  const taskId = `task-${completion.lineage.command_id}-engineering-publish`;
  const lineageIds = { correlation_id: completion.lineage.command_id, work_order_id: completion.lineage.work_id };
  if (completion.status !== "VERIFIED" || !completion.manifest || !completion.lineage.repository_id) {
    return blocked(completion, "LOCAL_COMMIT_NOT_ADMITTED", "GitHub publication requires a VERIFIED admitted Engineering result");
  }

  const destination = resolveGithubDestination({
    repository_id: completion.lineage.repository_id,
    checkout_root: input.checkout_root,
    requested: input.requested,
  });
  if (!destination.ok) {
    record(taskId, "destination_denied", { reason_code: destination.reason_code, detail: destination.detail }, lineageIds);
    return blocked(completion, destination.reason_code, destination.detail, {
      lineage: {
        ...completion.lineage,
        github_owner: input.requested?.owner ?? null,
        github_repository: input.requested?.repository ?? null,
        publish_branch: input.requested?.branch ?? null,
      },
    });
  }
  const dest = destination.destination;
  const destLineage: EngineeringLineage = {
    ...completion.lineage,
    github_owner: dest.owner,
    github_repository: dest.repository,
    publish_branch: dest.publish_branch,
    github_remote_url: dest.remote_url,
    credential_ref: dest.credential_ref,
  };

  const commit = createDnaOsCommit({
    completion,
    checkout_root: input.checkout_root,
    parent_sha: dest.local_default_branch_sha,
    repository_id: dest.repository_id,
  });
  record(taskId, "dna_os_commit", { commit: { ...commit } }, lineageIds);
  if (!commit.committed || !commit.commit_sha) {
    return blocked(completion, commit.reason_code, commit.detail, { commit, lineage: destLineage });
  }

  const publish = await publishDnaOsCommit({
    destination: dest,
    commit_sha: commit.commit_sha,
    expected_remote_sha: dest.local_default_branch_sha,
    deps: input.deps,
  });
  record(taskId, "github_publish", {
    publish: {
      published: publish.published,
      reason_code: publish.reason_code,
      detail: publish.detail,
      commit_sha: publish.commit_sha,
      pre_publish_remote_sha: publish.pre_publish_remote_sha,
      post_publish_remote_sha: publish.post_publish_remote_sha,
      github_owner: publish.github_owner,
      github_repository: publish.github_repository,
      publish_branch: publish.publish_branch,
      force_push_attempted: publish.force_push_attempted,
    },
  }, lineageIds);
  await recordGithubPublicationActivity({
    command_id: completion.lineage.command_id,
    work_order_id: completion.lineage.work_id,
    dna_os_commit_sha: commit.commit_sha,
    github_owner: dest.owner,
    github_repository: dest.repository,
    publish_branch: dest.publish_branch,
    pre_publish_remote_sha: publish.pre_publish_remote_sha,
    post_publish_remote_sha: publish.post_publish_remote_sha,
    published: publish.published,
    publish_source: "connections/github/github-read-api.ts#getBranch",
  });

  const lineage: EngineeringLineage = {
    ...destLineage,
    dna_os_commit_sha: commit.commit_sha,
    pre_publish_remote_sha: publish.pre_publish_remote_sha,
    post_publish_remote_sha: publish.post_publish_remote_sha,
    publish_status: publish.published ? "PUBLISHED" : publish.reason_code,
  };

  if (!publish.published) {
    return blocked(completion, publish.reason_code, publish.detail, { commit, publish, lineage });
  }

  persistCompletionRegistry({
    kind: "github_publish",
    status: "VERIFIED",
    reason_code: "ADMITTED",
    command_id: completion.lineage.command_id,
    work_id: completion.lineage.work_id,
    repository_id: dest.repository_id,
    reservation_id: completion.lineage.reservation_id,
    base_revision: completion.manifest.base_commit_sha,
    changed_paths: completion.manifest.changed_paths,
    tests: completion.manifest.actual_test_results,
    manifest_id: completion.manifest.manifest_id,
    admission: "ALLOW",
    integration: completion.lineage.integration_status,
    dna_os_commit_sha: commit.commit_sha,
    github_destination: `${dest.owner}/${dest.repository}`,
    publish_branch: dest.publish_branch,
    pre_publish_remote_sha: publish.pre_publish_remote_sha,
    post_publish_remote_sha: publish.post_publish_remote_sha,
  });

  return {
    status: "VERIFIED",
    reason_code: "ADMITTED",
    detail: publish.detail,
    completion,
    commit,
    publish,
    lineage,
  };
}
