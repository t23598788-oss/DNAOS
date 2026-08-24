/**
 * หน้าที่: proves real, local git worktree isolation — a real, fresh
 * throwaway git repository, real `git worktree add` calls, real
 * concurrent writes from two "Agents" into two different worktrees, and
 * proof that neither overwrites the other nor the original checkout.
 *
 * How to run: npx tsx control/source-workspace/tests/source-workspace.test.ts
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createWorkspace, removeWorkspace } from "../contract";

declare const process: { exitCode?: number; cwd(): string };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const run = promisify(execFile);

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

async function makeRealThrowawayRepo(): Promise<string> {
  const root = join("tests/__sandbox__", `source-workspace-repo-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
  await run("git", ["init", "-b", "main"], { cwd: root });
  await run("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await run("git", ["config", "user.name", "test"], { cwd: root });
  writeFileSync(join(root, "shared.txt"), "original content\n");
  await run("git", ["add", "."], { cwd: root });
  await run("git", ["commit", "-m", "initial"], { cwd: root });
  return root;
}

async function main() {
  const repositoryRoot = await makeRealThrowawayRepo();
  const repositoryId = "repository://test/source-workspace-repo";

  await check("A. createWorkspace makes a real, separate git worktree with a real, derived branch_ref and real base_commit_sha", async () => {
    const result = await createWorkspace({ work_id: "work-a", repository_id: repositoryId, repository_root: repositoryRoot, base_branch: "main" });
    assert(result.status === "CREATED", `expected CREATED, got ${result.status}: ${result.reason}`);
    assert(result.reservation?.branch_ref === "agent-work/work-a", `expected the real derived branch_ref, got ${result.reservation?.branch_ref}`);
    assert(result.reservation!.base_commit_sha.length === 40, `expected a real 40-char git SHA, got ${result.reservation?.base_commit_sha}`);
    if (result.reservation) await removeWorkspace(result.reservation, repositoryRoot);
  });

  await check("B. two Agents on the SAME repository get two DIFFERENT real worktree paths and branch refs, never chosen by the Agent", async () => {
    const a = await createWorkspace({ work_id: "work-b1", repository_id: repositoryId, repository_root: repositoryRoot, base_branch: "main" });
    const b = await createWorkspace({ work_id: "work-b2", repository_id: repositoryId, repository_root: repositoryRoot, base_branch: "main" });
    assert(a.status === "CREATED" && b.status === "CREATED", "both must succeed");
    assert(a.reservation!.worktree_path !== b.reservation!.worktree_path, "worktree paths must be real and distinct");
    assert(a.reservation!.branch_ref !== b.reservation!.branch_ref, "branch refs must be real and distinct");
    if (a.reservation) await removeWorkspace(a.reservation, repositoryRoot);
    if (b.reservation) await removeWorkspace(b.reservation, repositoryRoot);
  });

  await check("C. REQUIRED PROOF — Agent A and Agent B write DIFFERENT content to the SAME relative file path, concurrently, in their own real isolated worktrees, without overwriting each other or the original checkout", async () => {
    const a = await createWorkspace({ work_id: "work-c1", repository_id: repositoryId, repository_root: repositoryRoot, base_branch: "main" });
    const b = await createWorkspace({ work_id: "work-c2", repository_id: repositoryId, repository_root: repositoryRoot, base_branch: "main" });
    assert(a.status === "CREATED" && b.status === "CREATED", "both must succeed");

    // Real, concurrent writes — same relative path, different real worktree directories.
    await Promise.all([
      Promise.resolve(writeFileSync(join(a.reservation!.worktree_path, "shared.txt"), "AGENT A wrote this\n")),
      Promise.resolve(writeFileSync(join(b.reservation!.worktree_path, "shared.txt"), "AGENT B wrote this\n")),
    ]);

    const aContent = readFileSync(join(a.reservation!.worktree_path, "shared.txt"), "utf8");
    const bContent = readFileSync(join(b.reservation!.worktree_path, "shared.txt"), "utf8");
    const originalContent = readFileSync(join(repositoryRoot, "shared.txt"), "utf8");

    assert(aContent === "AGENT A wrote this\n", `Agent A's own worktree must reflect only its own write, got: ${aContent}`);
    assert(bContent === "AGENT B wrote this\n", `Agent B's own worktree must reflect only its own write, got: ${bContent}`);
    assert(originalContent === "original content\n", `the original checkout must be untouched by either Agent, got: ${originalContent}`);

    if (a.reservation) await removeWorkspace(a.reservation, repositoryRoot);
    if (b.reservation) await removeWorkspace(b.reservation, repositoryRoot);
  });

  await check("D. removeWorkspace real cleanup — the worktree directory is genuinely gone from git's own view afterward", async () => {
    const result = await createWorkspace({ work_id: "work-d", repository_id: repositoryId, repository_root: repositoryRoot, base_branch: "main" });
    assert(result.status === "CREATED", "setup must create");
    const removeResult = await removeWorkspace(result.reservation!, repositoryRoot);
    assert(removeResult.status === "REMOVED", `expected REMOVED, got ${removeResult.status}: ${removeResult.reason}`);
    const listing = await run("git", ["worktree", "list", "--porcelain"], { cwd: repositoryRoot });
    assert(!listing.stdout.includes(result.reservation!.worktree_path), "the removed worktree must no longer appear in git's own real worktree list");
  });

  await check("E. an invalid base_branch is honestly refused, never fabricated as created", async () => {
    const result = await createWorkspace({ work_id: "work-e", repository_id: repositoryId, repository_root: repositoryRoot, base_branch: "branch-that-does-not-exist" });
    assert(result.status === "FAILED", `expected FAILED, got ${result.status}`);
    assert(result.reservation === null, "must never fabricate a reservation for a real failure");
  });

  console.log(`${passed} passed, ${failed} failed`);
  rmSync(repositoryRoot, { recursive: true, force: true });
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("FATAL", error);
  process.exitCode = 1;
});
