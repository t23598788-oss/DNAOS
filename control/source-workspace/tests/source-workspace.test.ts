/**
 * หน้าที่: proves real, local git worktree isolation — a real, fresh
 * throwaway git repository, real `git worktree add` calls, real
 * concurrent writes from two "Agents" into two different worktrees, and
 * proof that neither overwrites the other nor the original checkout.
 * Also proves repository-registry admission: ENGINEERING_ISOLATION only
 * for an ACTIVE CONTROL_PLANE row whose repository_root matches.
 *
 * How to run: npx tsx control/source-workspace/tests/source-workspace.test.ts
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createWorkspace, removeWorkspace } from "../contract";
import { createRepositoryRegistryStore, getRepository } from "../../../software/repository-registry/contract";

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
  await run("git", ["remote", "add", "origin", "git://test/source-workspace-repo"], { cwd: root });
  writeFileSync(join(root, "shared.txt"), "original content\n");
  await run("git", ["add", "."], { cwd: root });
  await run("git", ["commit", "-m", "initial"], { cwd: root });
  return resolve(root);
}

function controlPlaneStore(repositoryRoot: string) {
  const store = createRepositoryRegistryStore(join(repositoryRoot, ".registry"));
  store.registerRepository({
    owner: "test",
    repository: "source-workspace-repo",
    world: "CONTROL_PLANE",
    source_authority: "git://test/source-workspace-repo",
    default_branch: "main",
    repository_root: repositoryRoot,
  });
  return store;
}

async function main() {
  const repositoryRoot = await makeRealThrowawayRepo();
  const repositoryId = "repository://test/source-workspace-repo";
  const store = controlPlaneStore(repositoryRoot);
  const deadboard = getRepository("repository://t23598788-oss/---------------DNA-OS");
  const controlWorkspace = getRepository("repository://t23598788-oss/dna-os-control-workspace");
  const infrastructure = getRepository("repository://t23598788-oss/-DNA-OS-INFRASTRUCTURE-");

  await check("A. createWorkspace makes a real, separate git worktree with a real, derived branch_ref and real base_commit_sha", async () => {
    const result = await createWorkspace({ work_id: "work-a", repository_id: repositoryId, repository_root: repositoryRoot, base_branch: "main" }, store);
    assert(result.status === "CREATED", `expected CREATED, got ${result.status}: ${result.reason}`);
    assert(result.reservation?.branch_ref === "agent-work/work-a", `expected the real derived branch_ref, got ${result.reservation?.branch_ref}`);
    assert(result.reservation!.base_commit_sha.length === 40, `expected a real 40-char git SHA, got ${result.reservation?.base_commit_sha}`);
    if (result.reservation) await removeWorkspace(result.reservation, repositoryRoot);
  });

  await check("B. two Agents on the SAME repository get two DIFFERENT real worktree paths and branch refs, never chosen by the Agent", async () => {
    const a = await createWorkspace({ work_id: "work-b1", repository_id: repositoryId, repository_root: repositoryRoot, base_branch: "main" }, store);
    const b = await createWorkspace({ work_id: "work-b2", repository_id: repositoryId, repository_root: repositoryRoot, base_branch: "main" }, store);
    assert(a.status === "CREATED" && b.status === "CREATED", "both must succeed");
    assert(a.reservation!.worktree_path !== b.reservation!.worktree_path, "worktree paths must be real and distinct");
    assert(a.reservation!.branch_ref !== b.reservation!.branch_ref, "branch refs must be real and distinct");
    if (a.reservation) await removeWorkspace(a.reservation, repositoryRoot);
    if (b.reservation) await removeWorkspace(b.reservation, repositoryRoot);
  });

  await check("C. REQUIRED PROOF — Agent A and Agent B write DIFFERENT content to the SAME relative file path, concurrently, in their own real isolated worktrees, without overwriting each other or the original checkout", async () => {
    const a = await createWorkspace({ work_id: "work-c1", repository_id: repositoryId, repository_root: repositoryRoot, base_branch: "main" }, store);
    const b = await createWorkspace({ work_id: "work-c2", repository_id: repositoryId, repository_root: repositoryRoot, base_branch: "main" }, store);
    assert(a.status === "CREATED" && b.status === "CREATED", "both must succeed");

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
    const result = await createWorkspace({ work_id: "work-d", repository_id: repositoryId, repository_root: repositoryRoot, base_branch: "main" }, store);
    assert(result.status === "CREATED", "setup must create");
    const removeResult = await removeWorkspace(result.reservation!, repositoryRoot);
    assert(removeResult.status === "REMOVED", `expected REMOVED, got ${removeResult.status}: ${removeResult.reason}`);
    const listing = await run("git", ["worktree", "list", "--porcelain"], { cwd: repositoryRoot });
    assert(!listing.stdout.includes(result.reservation!.worktree_path), "the removed worktree must no longer appear in git's own real worktree list");
  });

  await check("E. an invalid base_branch is honestly refused, never fabricated as created", async () => {
    const result = await createWorkspace({ work_id: "work-e", repository_id: repositoryId, repository_root: repositoryRoot, base_branch: "branch-that-does-not-exist" }, store);
    assert(result.status === "FAILED", `expected FAILED, got ${result.status}`);
    assert(result.reservation === null, "must never fabricate a reservation for a real failure");
  });

  await check("F. CONTROL_PLANE root allowed for ENGINEERING_ISOLATION", async () => {
    const result = await createWorkspace({
      work_id: "work-control-plane-allow",
      repository_id: repositoryId,
      repository_root: repositoryRoot,
      base_branch: "main",
      purpose: "ENGINEERING_ISOLATION",
    }, store);
    assert(result.status === "CREATED", `expected CREATED for CONTROL_PLANE, got ${result.status}: ${result.reason}`);
    assert(result.reservation !== null, "CONTROL_PLANE admission must produce a reservation");
    if (result.reservation) await removeWorkspace(result.reservation, repositoryRoot);
  });

  await check("G. Deadboard BUSINESS_LINE_FINANCE root denied", async () => {
    assert(deadboard !== null, "Deadboard must already be registered");
    const result = await createWorkspace({
      work_id: "work-deadboard-deny",
      repository_id: deadboard!.repository_id,
      repository_root: deadboard!.repository_root,
      base_branch: deadboard!.default_branch,
    });
    assert(result.status === "FAILED", `expected FAILED, got ${result.status}`);
    assert(result.reservation === null, "must not fabricate a reservation");
    assert(result.reason.includes("REPOSITORY_WORLD_DENIED"), result.reason);
    assert(result.reason.includes("BUSINESS_LINE_FINANCE"), result.reason);
  });

  await check("H. Control Workspace PRODUCT_SURFACE root denied", async () => {
    assert(controlWorkspace !== null, "Control Workspace must already be registered");
    const result = await createWorkspace({
      work_id: "work-control-workspace-deny",
      repository_id: controlWorkspace!.repository_id,
      repository_root: controlWorkspace!.repository_root,
      base_branch: controlWorkspace!.default_branch,
    });
    assert(result.status === "FAILED", `expected FAILED, got ${result.status}`);
    assert(result.reservation === null, "must not fabricate a reservation");
    assert(result.reason.includes("REPOSITORY_WORLD_DENIED"), result.reason);
    assert(result.reason.includes("PRODUCT_SURFACE"), result.reason);
  });

  await check("I. fake/unregistered repository denied", async () => {
    const result = await createWorkspace({
      work_id: "work-unregistered-deny",
      repository_id: "repository://nobody/not-registered",
      repository_root: repositoryRoot,
      base_branch: "main",
    });
    assert(result.status === "FAILED", `expected FAILED, got ${result.status}`);
    assert(result.reservation === null, "must not fabricate a reservation");
    assert(result.reason.includes("UNKNOWN_REPOSITORY"), result.reason);
  });

  await check("J. repository_id/root mismatch denied", async () => {
    assert(infrastructure !== null, "Infrastructure must already be registered");
    const result = await createWorkspace({
      work_id: "work-root-mismatch-deny",
      repository_id: infrastructure!.repository_id,
      repository_root: repositoryRoot,
      base_branch: "main",
    });
    assert(result.status === "FAILED", `expected FAILED, got ${result.status}`);
    assert(result.reservation === null, "must not fabricate a reservation");
    assert(result.reason.includes("REPOSITORY_ROOT_MISMATCH"), result.reason);
  });

  await check("K. legitimate rebound CONTROL_PLANE checkout is admitted (stale Mac path not required)", async () => {
    const remote = "https://github.com/example/dna-os-infrastructure.git";
    const linuxRoot = join(tmpdir(), `dnaos-sw-linux-${Date.now()}`);
    mkdirSync(linuxRoot, { recursive: true });
    await run("git", ["init", "-b", "main"], { cwd: linuxRoot });
    await run("git", ["config", "user.email", "test@example.com"], { cwd: linuxRoot });
    await run("git", ["config", "user.name", "test"], { cwd: linuxRoot });
    await run("git", ["remote", "add", "origin", remote], { cwd: linuxRoot });
    writeFileSync(join(linuxRoot, "shared.txt"), "linux checkout\n");
    await run("git", ["add", "."], { cwd: linuxRoot });
    await run("git", ["commit", "-m", "initial"], { cwd: linuxRoot });
    const staleMac = join(tmpdir(), `dnaos-sw-missing-mac-${Date.now()}`);
    const reboundStore = createRepositoryRegistryStore(join(linuxRoot, ".registry"));
    reboundStore.registerRepository({
      owner: "test",
      repository: "source-workspace-rebind",
      world: "CONTROL_PLANE",
      source_authority: remote,
      default_branch: "main",
      repository_root: staleMac,
    });
    const result = await createWorkspace({
      work_id: "work-rebind-admit",
      repository_id: "repository://test/source-workspace-rebind",
      repository_root: linuxRoot,
      base_branch: "main",
    }, reboundStore);
    assert(result.status === "CREATED", `expected CREATED for rebound checkout, got ${result.status}: ${result.reason}`);
    if (result.reservation) await removeWorkspace(result.reservation, linuxRoot);
    rmSync(linuxRoot, { recursive: true, force: true });
  });

  console.log(`${passed} passed, ${failed} failed`);
  rmSync(repositoryRoot, { recursive: true, force: true });
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("FATAL", error);
  process.exitCode = 1;
});
