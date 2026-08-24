/**
 * หน้าที่: end-to-end proof of the ONE INGRESS — a real Agent submission
 * through every real composed stage (including real, local git worktree
 * SOURCE_WORKSPACE_ISOLATION), plus the required failure proof: an
 * Agent's repository claim that does not match a real, registered
 * authority is rejected before any lock is even attempted.
 *
 * How to run: npx tsx control/agent-production-ingress/tests/agent-production-ingress.test.ts
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { registerRepository } from "../../../software/repository-registry/contract";
import { createLocalFileStore } from "../../../software/registry-database/adapters/local-file-store";
import { claimWork, releaseWorkClaim } from "../../work-coordination/coordination";
import { submitAgentWork } from "../contract";
import type { AgentProductionRequest } from "../contract";
import type { RegistrationCandidate } from "../../event-pipeline/contract";

declare const process: { exitCode?: number };
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

let fixtureCounter = 0;
function fixtureCandidate(name: string): RegistrationCandidate {
  fixtureCounter += 1;
  return {
    candidate_id: `candidate-ingress-${name}-${Math.random().toString(36).slice(2)}`,
    name: `test-ingress-${name}`,
    kind: "capability",
    source_location: `control/agent-production-ingress/tests/fixtures/${name}/`,
    owner: "control/agent-production-ingress/tests/agent-production-ingress.test.ts",
    input: [], output: [], side_effects: [], dependencies: [],
    behavior: `a fixture capability for agent production ingress ${"marker ".repeat(fixtureCounter).trim()}`,
    version: "1.0.0",
    evidence_refs: ["control/agent-production-ingress/tests/agent-production-ingress.test.ts"],
    domain: "SOFTWARE_CONTROL_PLANE",
    resource_type: "CAPABILITY",
    data_classification: "INTERNAL",
    source_system: "dna-os-infrastructure",
    scope: "test",
  };
}

async function makeRealThrowawayRepo(): Promise<string> {
  const root = join("tests/__sandbox__", `agent-ingress-repo-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
  await run("git", ["init", "-b", "main"], { cwd: root });
  await run("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await run("git", ["config", "user.name", "test"], { cwd: root });
  writeFileSync(join(root, "README.md"), "real throwaway repo for agent-production-ingress tests\n");
  await run("git", ["add", "."], { cwd: root });
  await run("git", ["commit", "-m", "initial"], { cwd: root });
  return root;
}

async function main() {
  const sharedDataDir = join("tests/__sandbox__", `agent-ingress-store-${Date.now()}`);
  const storeFactory = () => createLocalFileStore({ dataDir: sharedDataDir });
  const repositoryRoot = await makeRealThrowawayRepo();

  // A unique repository name per real run — software/repository-registry/'s
  // real store is a durable, module-level singleton (by design, matching
  // every other registry in this repo) and registerRepository() is
  // deliberately idempotent (re-registering an existing repository_id
  // returns the EXISTING record, never overwrites it). A fixed literal
  // name here would silently resolve to a STALE record left over from an
  // earlier real test run (found and fixed live — this exact bug produced
  // "spawn git ENOENT" against a long-gone /tmp path from a prior session).
  const testRepoName = `test-repo-real-${Date.now()}`;

  // Real repository registration to resolve against — no fabrication, this is exactly the mechanism.
  registerRepository({ owner: "test-owner", repository: testRepoName, world: "CONTROL_PLANE", source_authority: `https://github.com/test-owner/${testRepoName}.git`, default_branch: "main", repository_root: repositoryRoot });

  await check("A. happy path — real repository resolves, real ownership claim, real isolated git worktree, real registration -> COMPLETE", async () => {
    const request: AgentProductionRequest = {
      work_id: `work-a-${Math.random().toString(36).slice(2)}`,
      holder_agent_id: "agent-1",
      requested_owner: "test-owner",
      requested_repository: testRepoName,
      candidate: fixtureCandidate("happy-path"),
      resource_scope: ["src/foo.ts"],
      lease_ms: 10_000,
      correlation_id: "corr-a",
    };
    const result = await submitAgentWork(request, storeFactory);
    assert(result.final_stage === "COMPLETE", `expected COMPLETE, got ${result.final_stage}: ${result.reason}`);
    assert(result.final_status === "PASSED", `expected PASSED, got ${result.final_status}`);
    assert(result.capability_id !== null, "must have a real capability_id");
    assert(result.resolved_repository_id === `repository://test-owner/${testRepoName}`, `expected the real resolved repository_id, got ${result.resolved_repository_id}`);
    assert(result.workspace !== null, "resource_scope was non-empty — a real workspace must have been created");
    assert(result.workspace!.branch_ref === `agent-work/${request.work_id}`, `expected the real derived branch_ref, got ${result.workspace?.branch_ref}`);
  });

  await check("B. REQUIRED FAILURE TEST — Agent claims a repository that was never registered -> REJECTED at REPOSITORY_AUTHORITY_RESOLUTION, before any lock is attempted", async () => {
    const request: AgentProductionRequest = {
      work_id: `work-b-${Math.random().toString(36).slice(2)}`,
      holder_agent_id: "agent-1",
      requested_owner: "attacker-owner",
      requested_repository: "repo-that-was-never-registered",
      candidate: fixtureCandidate("wrong-repo"),
      resource_scope: [],
      lease_ms: 10_000,
      correlation_id: "corr-b",
    };
    const result = await submitAgentWork(request, storeFactory);
    assert(result.final_stage === "REPOSITORY_AUTHORITY_RESOLUTION", `expected to stop at REPOSITORY_AUTHORITY_RESOLUTION, got ${result.final_stage}`);
    assert(result.final_status === "REJECTED", `expected REJECTED, got ${result.final_status}`);
    assert(result.resolved_repository_id === null, "must never resolve a repository_id for an unregistered claim");
  });

  await check("C. a real, still-held claim on the same repository+resource correctly blocks a second agent's full ingress submission — real conflict propagated, not simulated", async () => {
    const repositoryId = `repository://test-owner/${testRepoName}`;
    const resource = ["shared-resource-c.ts"];
    const heldClaim = claimWork({ work_id: "work-c-holder", task_id: "work-c-holder", holder_agent_id: "agent-1", repository_id: repositoryId, resource_scope: resource, lease_ms: 10_000 });
    assert(heldClaim.ok, "setup must hold a real claim");

    const second = await submitAgentWork({ work_id: `work-c2-${Math.random().toString(36).slice(2)}`, holder_agent_id: "agent-2", requested_owner: "test-owner", requested_repository: testRepoName, candidate: fixtureCandidate("collision-2"), resource_scope: resource, lease_ms: 10_000, correlation_id: "corr-c2" }, storeFactory);
    assert(second.final_stage === "WORK_OWNERSHIP", `expected the second agent to be stopped at WORK_OWNERSHIP by the real still-held claim, got ${second.final_stage}`);
    assert(second.final_status === "CONFLICT", `expected CONFLICT, got ${second.final_status}`);

    if (heldClaim.ok) releaseWorkClaim(heldClaim.claim);
    const retry = await submitAgentWork({ work_id: `work-c3-${Math.random().toString(36).slice(2)}`, holder_agent_id: "agent-2", requested_owner: "test-owner", requested_repository: testRepoName, candidate: fixtureCandidate("collision-3"), resource_scope: resource, lease_ms: 10_000, correlation_id: "corr-c3" }, storeFactory);
    assert(retry.final_status === "PASSED", `expected the retry after release to succeed, got ${retry.final_status}: ${retry.reason}`);
  });

  await check("D. an unknown/malformed candidate still resolves to an honest, real reason — never a fabricated success", async () => {
    const request: AgentProductionRequest = {
      work_id: `work-d-${Math.random().toString(36).slice(2)}`,
      holder_agent_id: "agent-1",
      requested_owner: "test-owner",
      requested_repository: testRepoName,
      candidate: { ...fixtureCandidate("bad-domain"), domain: "BUSINESS_OPERATIONAL_DATA" as RegistrationCandidate["domain"], resource_type: "INVOICE" as RegistrationCandidate["resource_type"] },
      resource_scope: [],
      lease_ms: 10_000,
      correlation_id: "corr-d",
    };
    const result = await submitAgentWork(request, storeFactory);
    assert(result.final_stage === "DUPLICATE_RESERVATION", `expected to reach DUPLICATE_RESERVATION and then honestly fail classification inside it, got ${result.final_stage}`);
    assert(result.final_status === "REJECTED", `expected REJECTED (business data rejected by the real, unmodified classifier), got ${result.final_status}`);
  });

  await check("E. REQUIRED PROOF — Agent A and Agent B, SAME repository, non-conflicting resource claims, submitted concurrently, get two real DIFFERENT isolated git worktrees and never overwrite each other's file", async () => {
    // Deliberately DIFFERENT resource_scope per agent — two agents both
    // declaring the identical resource_scope is a real logical conflict
    // and is CORRECTLY rejected at WORK_OWNERSHIP (already proven by test
    // C above). This test instead proves the separate concern: given two
    // agents with non-conflicting claims on the SAME repository, do they
    // get genuinely isolated worktrees such that even writing to the
    // SAME relative filename inside each one never cross-contaminates?
    const requestA: AgentProductionRequest = { work_id: `work-e1-${Math.random().toString(36).slice(2)}`, holder_agent_id: "agent-1", requested_owner: "test-owner", requested_repository: testRepoName, candidate: fixtureCandidate("concurrent-a"), resource_scope: ["concurrent-a.ts"], lease_ms: 10_000, correlation_id: "corr-e1" };
    const requestB: AgentProductionRequest = { work_id: `work-e2-${Math.random().toString(36).slice(2)}`, holder_agent_id: "agent-2", requested_owner: "test-owner", requested_repository: testRepoName, candidate: fixtureCandidate("concurrent-b"), resource_scope: ["concurrent-b.ts"], lease_ms: 10_000, correlation_id: "corr-e2" };

    const [resultA, resultB] = await Promise.all([submitAgentWork(requestA, storeFactory), submitAgentWork(requestB, storeFactory)]);
    assert(resultA.final_status === "PASSED" && resultB.final_status === "PASSED", `both must succeed on different worktrees, got A=${resultA.final_status}(${resultA.reason}) B=${resultB.final_status}(${resultB.reason})`);
    assert(resultA.workspace!.worktree_path !== resultB.workspace!.worktree_path, "worktree paths must be real and distinct");

    writeFileSync(join(resultA.workspace!.worktree_path, "concurrent-shared.txt"), "written by agent A\n");
    writeFileSync(join(resultB.workspace!.worktree_path, "concurrent-shared.txt"), "written by agent B\n");
    const aContent = readFileSync(join(resultA.workspace!.worktree_path, "concurrent-shared.txt"), "utf8");
    const bContent = readFileSync(join(resultB.workspace!.worktree_path, "concurrent-shared.txt"), "utf8");
    assert(aContent === "written by agent A\n" && bContent === "written by agent B\n", "each Agent's own worktree must reflect only its own write, proving no overwrite");
  });

  console.log(`${passed} passed, ${failed} failed`);
  rmSync(sharedDataDir, { recursive: true, force: true });
  rmSync(repositoryRoot, { recursive: true, force: true });
  rmSync(join("tests/__sandbox__", ".dna-os-agent-worktrees"), { recursive: true, force: true });
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("FATAL", error);
  process.exitCode = 1;
});
