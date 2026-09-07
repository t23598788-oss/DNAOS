/**
 * หน้าที่: the one wiring point between
 * `../../connections/github/webhook-receiver.ts`'s verified, normalized
 * `EventEnvelope<GithubPushEventData>` and this pipeline's own
 * `ingestSource` — same "producer calls ingestSource with its own
 * SourceKind" shape ./canonical-event-pipeline.ts already declares for
 * every other producer (`file_modified`, `capability_created`, ...), just
 * for the `"github_push"` kind added alongside this file. No parallel
 * event system: this is the only place a GitHub push webhook reaches
 * `control/event-pipeline/`'s canonical store.
 *
 * Also the one place a push's outcome is turned into a
 * `GithubVersionRelation` row (../post-commit-verification/github-version-relation.ts)
 * and an Owner-facing Thai projection (../owner-projection/github-projection.ts)
 * — kept together because all three consume the exact same verified
 * event, and splitting them across three separate call sites would let
 * one run without the others silently.
 *
 * Input: `RawWebhookDelivery` (../../connections/github/webhook-receiver.ts's
 * own input shape) plus the `repository_id`/`local_sha` this machine
 * already knows for the branch this push concerns (local_sha is this
 * machine's own git HEAD for that branch, if any — null when this
 * machine has not observed a corresponding local commit).
 * Output: `ingestGithubPush` -> `GithubPushIngestResult` (the canonical
 * event, the version relation row, and the Owner display payload) or a
 * rejection carrying the receiver's own typed reason.
 * Dependency ที่อนุญาต: ../../connections/github/webhook-receiver.ts,
 * ../../connections/github/adapter-contract.ts (type only),
 * ./canonical-event-pipeline.ts, ../post-commit-verification/github-version-relation.ts,
 * ../owner-projection/github-projection.ts.
 * สิ่งที่ห้ามแตะ: never call `ingestSource` with a payload the webhook
 * signature has not already verified — this file must always go through
 * `handleGithubWebhookDelivery` first, never parse a delivery itself.
 */

import { handleGithubWebhookDelivery, type RawWebhookDelivery } from "../../connections/github/webhook-receiver";
import type { GithubPushEventData } from "../../connections/github/adapter-contract";
import { ingestSource, type PipelineResult } from "./canonical-event-pipeline";
import { recordVersionRelation, type GithubVersionRelation } from "../post-commit-verification/github-version-relation";
import { projectGithubVersionRelation } from "../owner-projection/github-projection";
import type { DisplayPayload } from "../owner-projection/display-payload";

export type GithubPushIngestResult =
  | { ok: true; pipeline: PipelineResult; relation: GithubVersionRelation; owner_display: DisplayPayload }
  | { ok: false; code: string; reason: string };

export async function ingestGithubPush(delivery: RawWebhookDelivery, localSha: string | null): Promise<GithubPushIngestResult> {
  const received = await handleGithubWebhookDelivery(delivery);
  if (!received.ok) {
    return { ok: false, code: received.code, reason: received.reason };
  }

  const data: GithubPushEventData = received.event.data;
  const repositoryId = `${data.owner}/${data.repo}`;

  const pipeline = ingestSource({
    source: "github_push",
    payload: { ...data },
    resource_id: `resource:github:${repositoryId}@${data.branch}`,
    capability_id: "capability:connections/github/webhook-receiver",
  });

  const relation = recordVersionRelation({
    repository_id: repositoryId,
    branch: data.branch,
    local_sha: localSha,
    remote_sha: data.after_sha,
    event_id: received.event.event_id,
  });

  const owner_display = projectGithubVersionRelation(relation);

  return { ok: true, pipeline, relation, owner_display };
}
