/**
 * Step 6 — node-local checkout resolution. Temporary directories only.
 * Does not write the production repositories.jsonl.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createRepositoryRegistryStore,
  resolveControlPlaneCheckout,
  resolveRepositoryCheckout,
  setCheckoutResolutionForTests,
} from "../contract";
import type { RepositoryRegistration } from "../contract";

declare const process: { exitCode?: number; cwd(): string };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

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

const REMOTE = "https://github.com/t23598788-oss/-DNA-OS-INFRASTRUCTURE-.git";
const REPO_ID = "repository://t23598788-oss/-DNA-OS-INFRASTRUCTURE-";

function makeGitCheckout(root: string, remote: string): void {
  mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "test"], { cwd: root });
  execFileSync("git", ["remote", "add", "origin", remote], { cwd: root });
  writeFileSync(join(root, "README.md"), "checkout-portability\n");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: root });
}

function controlPlaneRow(root: string): RepositoryRegistration {
  return {
    repository_id: REPO_ID,
    owner: "t23598788-oss",
    repository: "-DNA-OS-INFRASTRUCTURE-",
    world: "CONTROL_PLANE",
    source_authority: REMOTE,
    default_branch: "main",
    repository_root: root,
    connection_id: "conn-existing",
    status: "ACTIVE",
    registered_at: "2026-01-01T00:00:00.000Z",
  };
}

function lookupFor(rows: readonly RepositoryRegistration[]) {
  return {
    getRepository(id: string) {
      return rows.find((r) => r.repository_id === id) ?? null;
    },
    listOperationalRepositories() {
      return rows.filter((r) => r.status === "ACTIVE" && r.world === "CONTROL_PLANE");
    },
  };
}

async function main(): Promise<void> {
  const base = mkdtempSync(join(tmpdir(), "dnaos-checkout-portability-"));
  const macStyle = join(base, "Users", "tam", "Desktop", "DNA-OS-INFRASTRUCTURE");
  const linuxStyle = join(base, "opt", "dna", "current");
  const missing = join(base, "does-not-exist");
  makeGitCheckout(macStyle, REMOTE);
  makeGitCheckout(linuxStyle, REMOTE);

  try {
    await check("1. repository identity is unchanged after checkout rebind", () => {
      const store = createRepositoryRegistryStore(join(base, ".registry-rebind"));
      const { registration } = store.registerRepository({
        owner: "t23598788-oss",
        repository: "-DNA-OS-INFRASTRUCTURE-",
        world: "CONTROL_PLANE",
        source_authority: REMOTE,
        default_branch: "main",
        repository_root: macStyle,
        connection_id: "conn-existing",
      });
      const rebound = store.rebindRepositoryCheckout(registration.repository_id, { repository_root: linuxStyle });
      assert(rebound !== null, "rebind must succeed on ACTIVE row");
      assert(rebound!.repository_id === registration.repository_id, "repository_id changed");
      assert(rebound!.owner === registration.owner, "owner changed");
      assert(rebound!.repository === registration.repository, "repository name changed");
      assert(rebound!.world === registration.world, "world changed");
      assert(rebound!.source_authority === registration.source_authority, "source_authority changed");
      assert(rebound!.connection_id === registration.connection_id, "connection_id changed");
      assert(rebound!.status === "ACTIVE", "status changed");
      assert(resolve(rebound!.repository_root) === resolve(linuxStyle), "checkout path not rebound");
    });

    await check("2. Mac-style checkout path still resolves when it exists", () => {
      const row = controlPlaneRow(macStyle);
      const resolved = resolveRepositoryCheckout(REPO_ID, { lookup: lookupFor([row]) });
      assert(resolved.ok, resolved.ok ? "ok" : resolved.reason);
      if (!resolved.ok) return;
      assert(resolved.repository_id === REPO_ID, "id drifted");
      assert(resolved.repository_root === resolve(macStyle), resolved.repository_root);
      assert(resolved.source === "registered_checkout", resolved.source);
    });

    await check("3. Linux-style checkout path resolves", () => {
      const row = controlPlaneRow(linuxStyle);
      const resolved = resolveRepositoryCheckout(REPO_ID, { lookup: lookupFor([row]) });
      assert(resolved.ok, resolved.ok ? "ok" : resolved.reason);
      if (!resolved.ok) return;
      assert(resolved.repository_root === resolve(linuxStyle), resolved.repository_root);
      const control = resolveControlPlaneCheckout({ lookup: lookupFor([row]) });
      assert(control.ok && control.repository_root === resolve(linuxStyle), control.ok ? control.repository_root : control.reason);
    });

    await check("11. unknown/missing local checkout fails closed", () => {
      const missingRow = controlPlaneRow(missing);
      const resolved = resolveRepositoryCheckout(REPO_ID, {
        lookup: lookupFor([missingRow]),
        host: { cwd: () => join(base, "not-a-git"), exists: (p) => existsSync(p) },
      });
      assert(!resolved.ok, "missing checkout must fail");
      if (resolved.ok) return;
      assert(resolved.code === "CHECKOUT_MISSING" || resolved.code === "CHECKOUT_IDENTITY_MISMATCH", resolved.code);

      const unknown = resolveRepositoryCheckout("repository://nobody/not-registered", { lookup: lookupFor([]) });
      assert(!unknown.ok && unknown.code === "REPOSITORY_NOT_FOUND", unknown.ok ? "ok" : unknown.code);

      const staleMacOnCore = resolveRepositoryCheckout(REPO_ID, {
        lookup: lookupFor([controlPlaneRow("/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE")]),
        nodeCheckoutCandidate: linuxStyle,
        host: {
          cwd: () => linuxStyle,
          exists: (p) => {
            const abs = resolve(p);
            if (abs === resolve("/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE")) return false;
            return existsSync(p);
          },
        },
      });
      assert(staleMacOnCore.ok && staleMacOnCore.repository_root === resolve(linuxStyle), staleMacOnCore.ok ? staleMacOnCore.repository_root : staleMacOnCore.reason);
      assert(staleMacOnCore.ok && staleMacOnCore.source === "node_cwd", staleMacOnCore.ok ? staleMacOnCore.source : staleMacOnCore.reason);
    });

    await check("12. no new repository registry was introduced", () => {
      const files = [
        "software/repository-registry/checkout-resolution.ts",
        "software/repository-registry/registry.ts",
        "software/repository-registry/contract.ts",
        "software/repository-registry/types.ts",
      ];
      for (const file of files) {
        const src = readFileSync(join(process.cwd(), file), "utf8");
        assert(!/repository-location-registry|node-repository-registry|second checkout registry/i.test(src), `${file} invents a second registry`);
      }
      assert(!existsSync(join(process.cwd(), "software/repository-location-registry")), "location registry folder");
      assert(!existsSync(join(process.cwd(), "software/node-repository-registry")), "node-repository registry folder");
      const types = readFileSync(join(process.cwd(), "software/repository-registry/types.ts"), "utf8");
      assert(!/\bnode_id\b/.test(types), "node_id added to OWNER_LOCKED types");
      assert(!/provider/.test(types), "provider field added to types");
    });

    await check("CONTROL_PLANE ambiguous / unresolved fail closed", () => {
      const two = resolveControlPlaneCheckout({
        lookup: lookupFor([controlPlaneRow(macStyle), { ...controlPlaneRow(linuxStyle), repository_id: "repository://other/cp" }]),
      });
      assert(!two.ok && two.code === "CONTROL_PLANE_AMBIGUOUS", two.ok ? "ok" : two.code);
      const none = resolveControlPlaneCheckout({ lookup: lookupFor([]) });
      assert(!none.ok && none.code === "CONTROL_PLANE_UNRESOLVED", none.ok ? "ok" : none.code);
    });

    await check("P1: wrong repository at registered path is rejected", () => {
      const wrong = join(base, "wrong-repo");
      makeGitCheckout(wrong, "https://github.com/example/other.git");
      const row = controlPlaneRow(wrong);
      // row claims DNA-OS remote but checkout is other
      const resolved = resolveRepositoryCheckout(REPO_ID, { lookup: lookupFor([row]) });
      assert(!resolved.ok && resolved.code === "CHECKOUT_IDENTITY_MISMATCH", resolved.ok ? "ok" : resolved.code);
    });

    await check("P2: linked git worktree with matching identity is accepted", () => {
      const mainRoot = join(base, "worktree-main");
      const linked = join(base, "worktree-linked");
      makeGitCheckout(mainRoot, REMOTE);
      execFileSync("git", ["worktree", "add", linked, "HEAD"], { cwd: mainRoot });
      assert(existsSync(join(linked, ".git")), "gitfile missing");
      assert(!statSync(join(linked, ".git")).isDirectory(), ".git should be gitfile");
      const row = controlPlaneRow(linked);
      const resolved = resolveRepositoryCheckout(REPO_ID, { lookup: lookupFor([row]) });
      assert(resolved.ok, resolved.ok ? "ok" : resolved.reason);
      if (!resolved.ok) return;
      assert(resolved.repository_root === resolve(linked), resolved.repository_root);
    });
    await check("P2: HTTPS registered authority matches SSH checkout remote", () => {
      const sshRoot = join(base, "ssh-clone");
      makeGitCheckout(sshRoot, "git@github.com:t23598788-oss/-DNA-OS-INFRASTRUCTURE-.git");
      const row = controlPlaneRow(sshRoot); // HTTPS authority
      const resolved = resolveRepositoryCheckout(REPO_ID, { lookup: lookupFor([row]) });
      assert(resolved.ok, resolved.ok ? "ok" : resolved.reason);
    });
  } finally {
    setCheckoutResolutionForTests(undefined);
    rmSync(base, { recursive: true, force: true });
  }

  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

void main();
