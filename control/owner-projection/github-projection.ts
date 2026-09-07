/**
 * หน้าที่: turn one `GithubVersionRelation` row
 * (../post-commit-verification/github-version-relation.ts) into the same
 * `DisplayPayload` shape ./display-payload.ts already renders for every
 * other Owner-facing subject — reusing `projectOwnerDisplayPayload`
 * completely unmodified (its own whitelist already accepts
 * `result.type === "git"`, with `branch`/`revision` summary facts and a
 * `state` string) rather than building a second projection surface. This
 * file's only job is composing the `CanonicalResult` that function
 * expects, with the required Thai-language `state` strings for GitHub
 * sync outcomes.
 *
 * Input: `GithubVersionRelation`.
 * Output: `projectGithubVersionRelation` -> `DisplayPayload`.
 * Dependency ที่อนุญาต: ./display-payload.ts,
 * ../post-commit-verification/github-version-relation.ts (type only).
 * สิ่งที่ห้ามแตะ: never invent a new `SUPPORTED` type string here — "git"
 * already exists in ./display-payload.ts's whitelist and is reused as-is.
 */

import { projectOwnerDisplayPayload, type DisplayPayload } from "./display-payload";
import type { GithubSyncState, GithubVersionRelation } from "../post-commit-verification/github-version-relation";

/** Required Owner-facing Thai text per SYNC_STATE (task spec, verbatim). */
const STATE_TEXT: Record<GithubSyncState, string> = {
  LOCAL_AHEAD: "โค้ดถูกส่งขึ้น GitHub แล้ว",
  SYNCED: "เครื่องและ GitHub ตรงกัน",
  REMOTE_AHEAD: "GitHub มีเวอร์ชันใหม่กว่าเครื่อง",
  DIVERGED: "GitHub มีเวอร์ชันใหม่กว่าเครื่อง",
  PUSH_FAILED: "ส่งโค้ดไม่สำเร็จ",
};

export function projectGithubVersionRelation(relation: GithubVersionRelation): DisplayPayload {
  const canonical = {
    type: "git",
    subject: `${relation.repository_id}@${relation.branch}`,
    state: STATE_TEXT[relation.sync_state],
    branch: relation.branch,
    revision: relation.local_sha ?? relation.remote_sha ?? "",
    blocker: relation.sync_state === "PUSH_FAILED" ? `push failed for ${relation.repository_id}@${relation.branch}` : null,
    evidence_available: true,
    evidence_id: relation.event_id ?? relation.change_set_id,
    details_reference: relation.event_id ?? relation.change_set_id,
  };
  return projectOwnerDisplayPayload(canonical);
}
