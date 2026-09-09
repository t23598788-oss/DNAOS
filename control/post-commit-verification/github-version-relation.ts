/**
 * หน้าที่: the canonical "does the local repo agree with GitHub" relation
 * — the layer directly after ../../connections/github/webhook-receiver.ts
 * (an inbound GitHub push, once normalized into an EventEnvelope) and
 * after a local commit/push attempt (../../connections/github/write-api.ts,
 * or a local `git` operation on the machine): both sides record their
 * observed SHA here, and this file is the only place that decides
 * LOCAL_AHEAD | REMOTE_AHEAD | SYNCED | DIVERGED | PUSH_FAILED from those
 * two observations. Same append-only JSONL evidence-store convention as
 * this capability's sibling state (compare
 * ../event-pipeline/canonical-event-pipeline.ts's EVENTS/REGISTRY/DECISIONS
 * files) and as ../deployable-artifact-readiness/'s own data/ store — one
 * row per observation, never mutated, "latest row per (repository_id,
 * branch) wins" for current state.
 *
 * Input: `RecordVersionRelationInput` — REPOSITORY_ID, BRANCH, LOCAL_SHA,
 * REMOTE_SHA (either may be null when only one side has been observed
 * yet), CHANGE_SET_ID, EVENT_ID, plus an explicit `push_failed` flag for
 * the one state this file cannot derive from SHAs alone (a push attempt
 * that never reached GitHub at all).
 * Output: `GithubVersionRelation` (also persisted as one JSONL row).
 * Dependency ที่อนุญาต: node:fs, node:path, node:crypto (randomUUID for
 * change_set_id defaulting only).
 * สิ่งที่ห้ามแตะ: never write to the same file `../event-pipeline/`
 * already owns — this is a separate relation, cross-referenced by
 * `event_id`, not merged into that store. Never guess a SHA this call was
 * not actually given.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

export type GithubSyncState = "LOCAL_AHEAD" | "REMOTE_AHEAD" | "SYNCED" | "DIVERGED" | "PUSH_FAILED";

export interface GithubVersionRelation {
  repository_id: string;
  branch: string;
  local_sha: string | null;
  remote_sha: string | null;
  change_set_id: string;
  event_id: string | null;
  sync_state: GithubSyncState;
  recorded_at: string;
}

export interface RecordVersionRelationInput {
  repository_id: string;
  branch: string;
  local_sha: string | null;
  remote_sha: string | null;
  /** Ties this row back to the specific local edit that produced local_sha — defaults to a fresh id when the caller has none yet. */
  change_set_id?: string;
  /** Ties this row back to the inbound EventEnvelope.event_id that produced remote_sha, when one exists (a webhook-observed push). */
  event_id?: string | null;
  /** Set true when a push ATTEMPT was made and failed before GitHub ever recorded remote_sha — the one state SHA comparison alone cannot see. */
  push_failed?: boolean;
}

const ROOT = join(process.cwd(), "control/post-commit-verification/data");
const RELATIONS_FILE = join(ROOT, "github-version-relation.jsonl");

function ensure(): void {
  mkdirSync(ROOT, { recursive: true });
  if (!existsSync(RELATIONS_FILE)) appendFileSync(RELATIONS_FILE, "");
}

/**
 * Pure decision — SHA equality is SYNCED, an unresolved remote is
 * LOCAL_AHEAD (nothing observed from GitHub yet, but a local commit
 * exists), an unresolved local is REMOTE_AHEAD (a webhook push arrived
 * for a SHA this machine has not built locally), and two different
 * non-null SHAs where neither is a strict predecessor of the other as far
 * as this function can tell is reported as DIVERGED — it never assumes
 * ancestry it was not given evidence of.
 */
export function deriveSyncState(localSha: string | null, remoteSha: string | null, pushFailed: boolean): GithubSyncState {
  if (pushFailed) return "PUSH_FAILED";
  if (localSha !== null && remoteSha !== null) return localSha === remoteSha ? "SYNCED" : "DIVERGED";
  if (localSha !== null && remoteSha === null) return "LOCAL_AHEAD";
  if (localSha === null && remoteSha !== null) return "REMOTE_AHEAD";
  return "DIVERGED"; // both null: no observation on either side is itself an unresolved relation, never silently "synced"
}

export function recordVersionRelation(input: RecordVersionRelationInput): GithubVersionRelation {
  ensure();
  const relation: GithubVersionRelation = {
    repository_id: input.repository_id,
    branch: input.branch,
    local_sha: input.local_sha,
    remote_sha: input.remote_sha,
    change_set_id: input.change_set_id ?? `changeset-${randomUUID()}`,
    event_id: input.event_id ?? null,
    sync_state: deriveSyncState(input.local_sha, input.remote_sha, input.push_failed === true),
    recorded_at: new Date().toISOString(),
  };
  appendFileSync(RELATIONS_FILE, JSON.stringify(relation) + "\n");
  return relation;
}

function readAll(): GithubVersionRelation[] {
  ensure();
  return readFileSync(RELATIONS_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as GithubVersionRelation);
}

/** Latest row for (repository_id, branch), or null when none has ever been recorded. */
export function latestVersionRelation(repositoryId: string, branch: string): GithubVersionRelation | null {
  const rows = readAll().filter((r) => r.repository_id === repositoryId && r.branch === branch);
  return rows.length > 0 ? rows[rows.length - 1] : null;
}

export function listVersionRelations(repositoryId?: string): readonly GithubVersionRelation[] {
  const rows = readAll();
  return repositoryId ? rows.filter((r) => r.repository_id === repositoryId) : rows;
}
