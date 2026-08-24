/**
 * หน้าที่: proves the Repository Registry against real repositories on
 * this machine — reuses `connections/connection-registry/contract.ts`'s
 * `discoverGitRemote` (never reimplemented) for real evidence, and
 * proves a non-git directory is honestly refused, never fabricated.
 *
 * How to run: npx tsx software/repository-registry/tests/repository-registry.test.ts
 */

import { discoverGitRemote } from "../../../connections/connection-registry/contract";
import { createRepositoryRegistryStore, buildRepositoryId } from "../contract";

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

const sandboxDir = `tests/__sandbox__/repository-registry-${Date.now()}`;
const store = createRepositoryRegistryStore(sandboxDir);

async function main() {
  await check("A. real self-discovery via discoverGitRemote registers DNA-OS-INFRASTRUCTURE with real evidence, never invented", async () => {
    const discovery = await discoverGitRemote(process.cwd());
    assert(discovery.ok, `expected real discovery to succeed, got ${JSON.stringify(discovery)}`);
    if (!discovery.ok) return;
    const { registration, inserted } = store.registerRepository({
      owner: discovery.value.owner,
      repository: discovery.value.repository,
      world: "CONTROL_PLANE",
      source_authority: discovery.value.remote_url,
      default_branch: discovery.value.branch,
      repository_root: discovery.value.repository_root,
    });
    assert(inserted, "first registration must insert");
    assert(registration.source_authority === discovery.value.remote_url, "source_authority must be the real discovered remote_url");
    assert(registration.repository_id === buildRepositoryId(discovery.value.owner, discovery.value.repository), "repository_id must be deterministic");
  });

  await check("B. re-registering the identical real repo is idempotent, never a duplicate row", async () => {
    const discovery = await discoverGitRemote(process.cwd());
    if (!discovery.ok) throw new Error("setup discovery failed");
    const input = { owner: discovery.value.owner, repository: discovery.value.repository, world: "CONTROL_PLANE", source_authority: discovery.value.remote_url, default_branch: discovery.value.branch, repository_root: discovery.value.repository_root };
    store.registerRepository(input);
    const second = store.registerRepository(input);
    assert(second.inserted === false, "second registration of the same real repo must not insert again");
    assert(store.listRepositories().filter((r) => r.repository_id === second.registration.repository_id).length === 1, "must be exactly one row");
  });

  await check("C. real dna-os-deadboard repository, discovered via the same real function with a different cwd", async () => {
    const discovery = await discoverGitRemote("/Users/tam/Desktop/dna-os-deadboard");
    assert(discovery.ok, `expected real discovery of dna-os-deadboard to succeed, got ${JSON.stringify(discovery)}`);
    if (!discovery.ok) return;
    const { registration } = store.registerRepository({
      owner: discovery.value.owner,
      repository: discovery.value.repository,
      world: "SOFTWARE_PRODUCT",
      source_authority: discovery.value.remote_url,
      default_branch: discovery.value.branch,
      repository_root: discovery.value.repository_root,
    });
    assert(registration.source_authority.includes("github.com"), `expected a real github remote, got ${registration.source_authority}`);
  });

  await check("D. a non-git directory is honestly refused, never fabricated as a registered repository", async () => {
    const discovery = await discoverGitRemote("/Users/tam/Desktop/DNA-LAB-FILE-INTELLIGENCE");
    assert(discovery.ok === false, `expected a real refusal for a non-git directory, got ${JSON.stringify(discovery)}`);
    if (discovery.ok === false) assert(discovery.reason === "NOT_A_GIT_REPOSITORY", `expected NOT_A_GIT_REPOSITORY, got ${discovery.reason}`);
  });

  await check("E. suspend transitions status, restart-safe (read back fresh from a new store instance)", async () => {
    const discovery = await discoverGitRemote(process.cwd());
    if (!discovery.ok) throw new Error("setup discovery failed");
    const { registration } = store.registerRepository({ owner: discovery.value.owner, repository: `${discovery.value.repository}-suspend-test`, world: "CONTROL_PLANE", source_authority: discovery.value.remote_url, default_branch: discovery.value.branch, repository_root: discovery.value.repository_root });
    const suspended = store.suspendRepository(registration.repository_id);
    assert(suspended?.status === "SUSPENDED", `expected SUSPENDED, got ${suspended?.status}`);

    const restarted = createRepositoryRegistryStore(sandboxDir);
    const rebuilt = restarted.getRepository(registration.repository_id);
    assert(rebuilt?.status === "SUSPENDED", "a fresh store instance over the same directory must read back SUSPENDED");
  });

  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("FATAL", error);
  process.exitCode = 1;
});
