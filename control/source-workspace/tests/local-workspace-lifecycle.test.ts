/**
 * Deterministic A–H proofs for Local Workspace Registry and safe cleanup.
 * How to run:
 *   npx tsx control/source-workspace/tests/local-workspace-lifecycle.test.ts
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createWorkspace,
  evaluateDisposableCleanup,
  isRegisteredManagedWorktree,
  latestWorkspaceForWork,
  recreateWorkspaceFromRegisteredSource,
  removeWorkspace,
  resumeCleanupPending,
  transitionLocalWorkspace,
  workspacesForWork,
} from "../contract";
import { evaluateScopedWrite } from "../../engineering-runtime/contract";

const run = promisify(execFile);
declare const process: { cwd(): string; env: Record<string, string | undefined>; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const STAMP = Date.now();
const DATA = join(process.cwd(), "control/source-workspace/data");
process.env.LOCAL_WORKSPACE_REGISTRY_LOG = join(DATA, `local-workspaces-${STAMP}.jsonl`);
process.env.LOCAL_WORKSPACE_CLEANUP_EVIDENCE_LOG = join(DATA, `workspace-cleanup-${STAMP}.jsonl`);
process.env.SOURCE_WORKSPACE_RESERVATION_LOG = join(DATA, `reservations-${STAMP}.jsonl`);
process.env.DNA_OS_MACHINE_ID = "machine:test-lifecycle";

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
async function check(name: string, body: () => Promise<void> | void): Promise<void> {
  try {
    await body();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function makeRepo(): Promise<string> {
  const root = join("tests/__sandbox__", `lws-repo-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
  await run("git", ["init", "-b", "main"], { cwd: root });
  await run("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await run("git", ["config", "user.name", "test"], { cwd: root });
  writeFileSync(join(root, "required.txt"), "source-v1\n");
  await run("git", ["add", "."], { cwd: root });
  await run("git", ["commit", "-m", "initial"], { cwd: root });
  return root;
}

function facts(ok: boolean) {
  return {
    remote_commit_verified: ok,
    ci_verified_when_required: ok,
    registry_write_verified: ok,
    final_result_recorded: ok,
  };
}

const admission = {
  admitted: true,
  reason_code: "ADMITTED" as const,
  detail: "test",
  repository_id: "repository://test/lws",
  repository_root: "/tmp",
  allowed_paths: ["required.txt"],
  allowed_symbols: [],
  required_tests: [],
  forbidden_paths: [],
  work_resolution_decision: null,
  work_id: "work-test",
  command_id: "cmd-test",
};

async function main(): Promise<void> {
  const repositoryRoot = await makeRepo();
  const repositoryId = "repository://test/local-workspace-lifecycle";
  const ownerFile = join("tests/__sandbox__", `owner-unknown-${STAMP}.txt`);
  writeFileSync(ownerFile, "owner-owned never delete\n");

  let verifiedWorkId = "";
  let verifiedSha = "";

  await check("A. Registered workspace is created for new engineering work", async () => {
    const work_id = `work-${randomUUID()}`;
    const created = await createWorkspace({ work_id, repository_id: repositoryId, repository_root: repositoryRoot, base_branch: "main" });
    assert(created.status === "CREATED", created.reason);
    const row = latestWorkspaceForWork(work_id);
    assert(row !== null, "workspace must be registered");
    assert(row!.current_state === "ACTIVE", row!.current_state);
    assert(row!.work_id === work_id, "canonical work_id must be stored");
    assert(isRegisteredManagedWorktree(created.reservation!.worktree_path), "path must be managed");
    await removeWorkspace(created.reservation!, repositoryRoot);
  });

  await check("B. Worker cannot write to an unmanaged workspace", async () => {
    const unmanaged = join("tests/__sandbox__", `unmanaged-${STAMP}`);
    mkdirSync(unmanaged, { recursive: true });
    writeFileSync(join(unmanaged, "required.txt"), "no\n");
    const decision = evaluateScopedWrite({
      admission: { ...admission, work_id: `work-${randomUUID()}` },
      worktree_path: unmanaged,
      proposed_path: join(unmanaged, "required.txt"),
    });
    assert(!decision.allowed, "unmanaged write must be denied");
    assert(decision.reason_code === "UNMANAGED_WORKSPACE", decision.reason_code);
  });

  await check("C. VERIFIED published workspace is cleaned safely", async () => {
    const work_id = `work-${randomUUID()}`;
    verifiedWorkId = work_id;
    const created = await createWorkspace({ work_id, repository_id: repositoryId, repository_root: repositoryRoot, base_branch: "main" });
    assert(created.status === "CREATED", created.reason);
    verifiedSha = created.reservation!.base_commit_sha;
    const row = latestWorkspaceForWork(work_id)!;
    const outcome = await evaluateDisposableCleanup({ workspace: row, facts: facts(true) });
    assert(outcome.status === "CLEANED", `${outcome.status} ${outcome.detail}`);
    assert(outcome.unmanaged_files_deleted === false, "must not delete unmanaged files");
    assert(!existsSync(created.reservation!.worktree_path), "worktree path must be gone");
    assert(latestWorkspaceForWork(work_id)?.current_state === "CLEANED", "state CLEANED");
  });

  await check("D. Unverified work is never cleaned", async () => {
    const work_id = `work-${randomUUID()}`;
    const created = await createWorkspace({ work_id, repository_id: repositoryId, repository_root: repositoryRoot, base_branch: "main" });
    const row = latestWorkspaceForWork(work_id)!;
    const outcome = await evaluateDisposableCleanup({ workspace: row, facts: facts(false) });
    assert(outcome.status === "PRESERVED" || outcome.status === "BLOCKED", outcome.status);
    assert(existsSync(created.reservation!.worktree_path), "unverified worktree must remain");
    await removeWorkspace(created.reservation!, repositoryRoot);
  });

  await check("E. Uncommitted required source blocks cleanup", async () => {
    const work_id = `work-${randomUUID()}`;
    const created = await createWorkspace({ work_id, repository_id: repositoryId, repository_root: repositoryRoot, base_branch: "main" });
    writeFileSync(join(created.reservation!.worktree_path, "required.txt"), "dirty-uncommitted\n");
    const row = latestWorkspaceForWork(work_id)!;
    const outcome = await evaluateDisposableCleanup({ workspace: row, facts: facts(true) });
    assert(outcome.status === "BLOCKED", outcome.status);
    assert(outcome.reason_code === "UNCOMMITTED_REQUIRED_SOURCE", outcome.reason_code);
    assert(existsSync(created.reservation!.worktree_path), "dirty worktree preserved");
    await removeWorkspace(created.reservation!, repositoryRoot);
  });

  await check("F. Unknown Owner files are never deleted", async () => {
    assert(existsSync(ownerFile), "owner file must still exist after previous cleanups");
    assert(readFileSync(ownerFile, "utf8").includes("owner-owned"), "owner file content must be intact");
  });

  await check("G. Restart resumes CLEANUP_PENDING safely", async () => {
    const work_id = `work-${randomUUID()}`;
    const created = await createWorkspace({ work_id, repository_id: repositoryId, repository_root: repositoryRoot, base_branch: "main" });
    const row = latestWorkspaceForWork(work_id)!;
    transitionLocalWorkspace(row.workspace_id, "CLEANUP_PENDING", "simulated-restart");
    const resumed = await resumeCleanupPending(work_id, facts(true));
    assert(resumed.length === 1, "one workspace");
    assert(resumed[0]!.status === "CLEANED", resumed[0]!.detail);
    assert(!existsSync(created.reservation!.worktree_path), "resumed cleanup removed worktree");
  });

  await check("H. Replacement-machine recovery reconstructs workspace from registered remote source", async () => {
    const recovered = await recreateWorkspaceFromRegisteredSource({
      work_id: verifiedWorkId,
      repository_id: repositoryId,
      repository_root: repositoryRoot,
      commit_sha: verifiedSha,
      base_branch: "main",
    });
    assert(recovered.ok, recovered.ok ? "" : recovered.detail);
    if (recovered.ok) {
      assert(existsSync(join(recovered.worktree_path, "required.txt")), "required source restored from registered commit");
      assert(readFileSync(join(recovered.worktree_path, "required.txt"), "utf8") === "source-v1\n", "content matches registered source");
      const reservation = workspacesForWork(verifiedWorkId).find((row) => row.workspace_id === recovered.workspace_id);
      assert(reservation !== undefined, "recovered workspace is registered");
      await removeWorkspace({
        repository_id: repositoryId,
        worktree_path: recovered.worktree_path,
        branch_ref: `agent-work/${verifiedWorkId}`,
      }, repositoryRoot);
    }
  });

  rmSync(repositoryRoot, { recursive: true, force: true });
  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
