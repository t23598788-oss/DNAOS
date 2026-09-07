/**
 * หน้าที่: the real test for ./github-version-relation.ts and
 * ../owner-projection/github-projection.ts's wiring on top of it. Plain
 * program with its own assertions (no test framework in this repo).
 *
 * How to run: npx tsx control/post-commit-verification/github-version-relation.test.ts
 */

import { deriveSyncState, recordVersionRelation } from "./github-version-relation";
import { projectGithubVersionRelation } from "../owner-projection/github-projection";

let failures = 0;
function assert(condition: boolean, label: string): void {
  if (condition) console.log(`PASS ${label}`);
  else { console.error(`FAIL ${label}`); failures += 1; }
}

const REPO = "test-fixture-repo-github-version-relation";

// Pure decision table
assert(deriveSyncState("abc", "abc", false) === "SYNCED", "same sha both sides is SYNCED");
assert(deriveSyncState("abc", null, false) === "LOCAL_AHEAD", "local only observed is LOCAL_AHEAD");
assert(deriveSyncState(null, "def", false) === "REMOTE_AHEAD", "remote only observed is REMOTE_AHEAD");
assert(deriveSyncState("abc", "def", false) === "DIVERGED", "different shas both sides is DIVERGED");
assert(deriveSyncState("abc", "def", true) === "PUSH_FAILED", "push_failed flag overrides to PUSH_FAILED");

// Recorded relation + owner projection round-trip, for each required state
const cases: Array<{ local: string | null; remote: string | null; pushFailed: boolean; expectThai: string }> = [
  { local: "sha-local-1", remote: null, pushFailed: false, expectThai: "โค้ดถูกส่งขึ้น GitHub แล้ว" },
  { local: "sha-x", remote: "sha-x", pushFailed: false, expectThai: "เครื่องและ GitHub ตรงกัน" },
  { local: null, remote: "sha-remote-1", pushFailed: false, expectThai: "GitHub มีเวอร์ชันใหม่กว่าเครื่อง" },
  { local: "sha-a", remote: "sha-b", pushFailed: false, expectThai: "GitHub มีเวอร์ชันใหม่กว่าเครื่อง" },
  { local: "sha-a", remote: null, pushFailed: true, expectThai: "ส่งโค้ดไม่สำเร็จ" },
];

for (const c of cases) {
  const relation = recordVersionRelation({ repository_id: REPO, branch: "main", local_sha: c.local, remote_sha: c.remote, push_failed: c.pushFailed });
  const payload = projectGithubVersionRelation(relation);
  assert(payload.projection === "SUPPORTED", `projection SUPPORTED for sync_state=${relation.sync_state}`);
  if (payload.projection === "SUPPORTED") {
    assert(payload.state === c.expectThai, `Thai owner message correct for sync_state=${relation.sync_state} ("${payload.state}")`);
  }
}

if (failures > 0) { console.error(`${failures} assertion(s) failed`); process.exitCode = 1; }
else console.log("ALL PASS");
