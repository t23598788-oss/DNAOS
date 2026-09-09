/**
 * DNA_OS_DIVERGED_SOURCE_INTEGRATION_V1
 * How to run:
 *   npx tsx control/diverged-source-integration/tests/diverged-source-integration.test.ts
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyPath,
  evaluateIntegrationAdmission,
  newDevelopmentBaseAllowed,
  overlappingPaths,
  remoteHeadState,
  selectIntegrationStrategy,
} from "../contract";
import { projectHumanNotification } from "../../owner-notification/contract";

declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };
declare const process: { exitCode?: number };

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
function check(name: string, body: () => void): void {
  try {
    body();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

check("D. jsonl and credentials never admit", () => {
  assert(classifyPath("audit/command-audit/execution-audit.jsonl") === "AUDIT_DATA", "audit");
  assert(classifyPath("control/agent-gateway/data/tasks.jsonl") === "RUNTIME_DATA", "runtime jsonl");
  assert(classifyPath("credentials/registry/data/api-credential-references.jsonl") === "CREDENTIAL_OR_SECRET_STATE" || classifyPath("credentials/registry/data/api-credential-references.jsonl") === "RUNTIME_DATA" || classifyPath("credentials/registry/data/api-credential-references.jsonl") === "AUDIT_DATA", "cred path");
  assert(classifyPath("control/foo.ts") === "SOURCE_ELIGIBLE", "ts source");
  assert(classifyPath("connections/github/credential-rebind.ts") === "SOURCE_ELIGIBLE", "credential-*.ts is source");
  assert(classifyPath("credentials/registry/data/api-credential-references.jsonl") === "CREDENTIAL_OR_SECRET_STATE", "cred jsonl");
  assert(classifyPath("tests/__pipeline__/test-a-local.ts") === "TEST_ELIGIBLE", "pipeline ts");
  assert(classifyPath("tests/__pipeline__/test-a-evidence.jsonl") === "CACHE_TEMP" || classifyPath("tests/__pipeline__/test-a-evidence.jsonl") === "RUNTIME_DATA", "pipeline jsonl");
});

check("H. strategy is MIXED not rebase", () => {
  const row = selectIntegrationStrategy({ local_commit_count: 13, remote_commit_count: 7, overlapping_path_count: 4 });
  assert(row.strategy === "MIXED", row.strategy);
  assert(!row.reason.toLowerCase().includes("rebase onto"), "must not default to rebase");
});

check("F. overlapping fixture paths identified", () => {
  const overlap = overlappingPaths(
    ["a.ts", "control/engineering-runtime/fixtures/completion/HUMAN.md"],
    ["control/engineering-runtime/fixtures/completion/HUMAN.md", "b.ts"],
  );
  assert(overlap.length === 1, String(overlap.length));
});

check("K. changed remote head is not MATCH", () => {
  assert(remoteHeadState("c57ad8ae280ef1945f28be7d8d0ad5f53a6c1f1f", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") === "REMOTE_HEAD_MOVED", "moved");
  assert(remoteHeadState("c57ad8ae280ef1945f28be7d8d0ad5f53a6c1f1f", "c57ad8ae280ef1945f28be7d8d0ad5f53a6c1f1f") === "MATCH", "match");
});

check("N. new development base must equal registered canonical", () => {
  assert(newDevelopmentBaseAllowed("c57ad8ae280ef1945f28be7d8d0ad5f53a6c1f1f", "c57ad8ae280ef1945f28be7d8d0ad5f53a6c1f1f") === true, "equal");
  assert(newDevelopmentBaseAllowed("4a37d63ce4c177cabc304af2a76f6927000f37d3", "c57ad8ae280ef1945f28be7d8d0ad5f53a6c1f1f") === false, "stale");
});

check("O. coding client cannot self-admit", () => {
  const denied = evaluateIntegrationAdmission({
    actor: "CODING_CLIENT",
    machine_verification_passed: true,
    remote_features_preserved: true,
    integration_workspace_isolated: true,
    integration_base_is_live_remote: true,
    git_add_all_used: false,
    force_push: false,
  });
  assert(denied.decision === "DENY", denied.reason_code);
  const force = evaluateIntegrationAdmission({
    actor: "DNA_OS_PUBLISH_AUTHORITY",
    machine_verification_passed: true,
    remote_features_preserved: true,
    integration_workspace_isolated: true,
    integration_base_is_live_remote: true,
    git_add_all_used: false,
    force_push: true,
  });
  assert(force.decision === "DENY", force.reason_code);
  const addAll = evaluateIntegrationAdmission({
    actor: "DNA_OS_PUBLISH_AUTHORITY",
    machine_verification_passed: true,
    remote_features_preserved: true,
    integration_workspace_isolated: true,
    integration_base_is_live_remote: true,
    git_add_all_used: true,
    force_push: false,
  });
  assert(addAll.decision === "DENY", addAll.reason_code);
});

check("L. DNA OS authority can admit when verification passed", () => {
  const allow = evaluateIntegrationAdmission({
    actor: "DNA_OS_PUBLISH_AUTHORITY",
    machine_verification_passed: true,
    remote_features_preserved: true,
    integration_workspace_isolated: true,
    integration_base_is_live_remote: true,
    git_add_all_used: false,
    force_push: false,
  });
  assert(allow.decision === "ALLOW", allow.reason_code);
  assert(allow.coding_client_self_approved === false, "self");
  assert(allow.FORCE_PUSH_USED === false, "force");
  assert(allow.GIT_ADD_ALL_USED === false, "add-all");
});

check("X. owner notification uses Thai subject", () => {
  const projected = projectHumanNotification({
    schema: "OWNER_NOTIFICATION_V1",
    notification_id: "n1",
    event_id: "e1",
    entity_id: "entity:repository:github-canonical-main",
    work_id: null,
    command_id: null,
    source_system: "diverged-source-integration",
    notification_type: "CONNECTION_CHANGED",
    severity: "INFO",
    title_key: "CONNECTION_CHANGED",
    message_key: "CONNECTION_CHANGED",
    structured_facts: { subject: "กำลังรวม source local เข้ากับ GitHub main ปัจจุบัน" },
    state_before: "DIVERGED",
    state_after: "INTEGRATING",
    action_required: false,
    owner_action_refs: [],
    resource_refs: [],
    capability_refs: [],
    evidence_refs: [],
    created_at: "2026-09-09T00:00:00.000Z",
    read_at: null,
    dismissed_at: null,
    delivery_state: "PENDING",
    delivery_channels: [],
    deduplication_key: "k1",
    version: 1,
  });
  assert(projected.title.includes("กำลังรวม source"), projected.title);
});

check("C. merge commit can have two parents without rewriting either", () => {
  const dir = mkdtempSync(join(tmpdir(), "dna-os-merge-proof-"));
  git(dir, ["init", "-b", "main"]);
  git(dir, ["config", "user.email", "dna-os-commit-authority@local"]);
  git(dir, ["config", "user.name", "DNA OS Commit Authority"]);
  writeFileSync(join(dir, "a.txt"), "base\n");
  git(dir, ["add", "a.txt"]);
  git(dir, ["commit", "-m", "base"]);
  git(dir, ["checkout", "-b", "side"]);
  writeFileSync(join(dir, "b.txt"), "local\n");
  git(dir, ["add", "b.txt"]);
  git(dir, ["commit", "-m", "local"]);
  const local = git(dir, ["rev-parse", "HEAD"]);
  git(dir, ["checkout", "main"]);
  writeFileSync(join(dir, "c.txt"), "remote\n");
  git(dir, ["add", "c.txt"]);
  git(dir, ["commit", "-m", "remote"]);
  const remote = git(dir, ["rev-parse", "HEAD"]);
  const tree = git(dir, ["rev-parse", `${remote}^{tree}`]);
  const merge = execFileSync("git", ["commit-tree", tree, "-p", remote, "-p", local, "-m", "merge"], { cwd: dir, encoding: "utf8" }).trim();
  const parents = git(dir, ["rev-list", "--parents", "-n", "1", merge]).split(" ");
  assert(parents[1] === remote, "first parent remote");
  assert(parents[2] === local, "second parent local");
  execFileSync("git", ["merge-base", "--is-ancestor", remote, merge], { cwd: dir });
  execFileSync("git", ["merge-base", "--is-ancestor", local, merge], { cwd: dir });
});

console.log(`diverged-source-integration ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
