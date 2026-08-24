/**
 * หน้าที่: PHASE 1 proof — closes the verified `repository_id: null` gap
 * (software/registry-database/registry-writer.ts previously hardcoded
 * `null` unconditionally; RegistrationCandidate previously had no field
 * to even carry a repository claim). Proves the new REPOSITORY_RESOLUTION
 * stage (./repository-resolution.ts) genuinely resolves a candidate's
 * requested_owner/requested_repository CLAIM against the real, existing
 * software/repository-registry/ — never trusts the claim directly, never
 * fabricates a repository_id, fails closed on an unknown/incomplete
 * claim, and never lets one candidate's claim bleed into another's
 * persisted repository_id.
 *
 * Uses the REAL production repository-registry store (module-level
 * singleton, durable default data dir) — every owner/repository name
 * here is unique per test run (`Date.now()`-suffixed) to avoid colliding
 * with stale records from earlier runs, the same lesson already applied
 * in software/repository-registry/tests/ and
 * control/agent-production-ingress/tests/ this session.
 *
 * How to run: npx tsx control/registration-pipeline/tests/repository-resolution.test.ts
 */

import { registerRepository, buildRepositoryId } from "../../../software/repository-registry/contract";
import { createLocalFileStore } from "../../../software/registry-database/adapters/local-file-store";
import { findResourceById } from "../../../software/registry-database/contract";
import type { RegistrationCandidate } from "../../event-pipeline/contract";
import { runRegistrationPipeline } from "../contract";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

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

const RUN = Date.now();
function fixtureCandidate(scenario: string, overrides: Partial<RegistrationCandidate> = {}): RegistrationCandidate {
  return {
    candidate_id: `candidate-repo-resolution-${scenario}-${Math.random().toString(36).slice(2)}`,
    name: `test-repo-resolution-${scenario}`,
    kind: "capability",
    source_location: `test-fixtures/repository-resolution/${scenario}/`,
    owner: "control/registration-pipeline/tests/repository-resolution.test.ts",
    input: [], output: [], side_effects: [], dependencies: [],
    behavior: "test_repository_resolution_scenario_fixture",
    version: "1.0.0",
    evidence_refs: ["control/registration-pipeline/tests/repository-resolution.test.ts"],
    domain: "SOFTWARE_CONTROL_PLANE",
    resource_type: "CAPABILITY",
    data_classification: "INTERNAL",
    source_system: "dna-os-infrastructure",
    scope: `repository-resolution-test-${scenario}-${RUN}`,
    ...overrides,
  };
}

function main(): void {
  const store = createLocalFileStore({ dataDir: `tests/__sandbox__/repository-resolution-${RUN}` });

  const ownerA = `repo-res-owner-a-${RUN}`;
  const repoA = `repo-res-repo-a-${RUN}`;
  const ownerB = `repo-res-owner-b-${RUN}`;
  const repoB = `repo-res-repo-b-${RUN}`;

  registerRepository({ owner: ownerA, repository: repoA, world: "CONTROL_PLANE", source_authority: `https://github.com/${ownerA}/${repoA}.git`, default_branch: "main", repository_root: `/tmp/does-not-need-to-exist/${ownerA}/${repoA}` });
  registerRepository({ owner: ownerB, repository: repoB, world: "CONTROL_PLANE", source_authority: `https://github.com/${ownerB}/${repoB}.git`, default_branch: "main", repository_root: `/tmp/does-not-need-to-exist/${ownerB}/${repoB}` });
  const repositoryIdA = buildRepositoryId(ownerA, repoA);
  const repositoryIdB = buildRepositoryId(ownerB, repoB);

  check("A. known repository -> correct repository_id persisted", () => {
    const candidate = fixtureCandidate("a-known-repo", { requested_owner: ownerA, requested_repository: repoA });
    const result = runRegistrationPipeline(candidate, store, "corr-a");
    assert(result.status === "REGISTERED", `expected REGISTERED, got ${result.status}: ${JSON.stringify(result)}`);
    assert((result as { repository_id: string | null }).repository_id === repositoryIdA, `expected repository_id=${repositoryIdA}, got ${(result as { repository_id: string | null }).repository_id}`);
    const resource = findResourceById((result as { resource_id: string }).resource_id, store);
    assert(resource !== null && resource.repository_id === repositoryIdA, `expected the real persisted ResourceRow to carry repository_id=${repositoryIdA}, got ${resource?.repository_id}`);
  });

  check("B. fabricated/incomplete repository claim -> REJECTED, never silently null", () => {
    const candidate = fixtureCandidate("b-incomplete-claim", { requested_owner: ownerA, requested_repository: null });
    const result = runRegistrationPipeline(candidate, store, "corr-b");
    assert(result.status === "REJECTED", `expected REJECTED, got ${result.status}: ${JSON.stringify(result)}`);
    assert((result as { failed_stage: string }).failed_stage === "REPOSITORY_RESOLUTION", `expected failed_stage=REPOSITORY_RESOLUTION, got ${(result as { failed_stage: string }).failed_stage}`);
    assert((result as { reason_code: string }).reason_code === "INCOMPLETE_REPOSITORY_CLAIM", `expected INCOMPLETE_REPOSITORY_CLAIM, got ${(result as { reason_code: string }).reason_code}`);
  });

  check("C. unknown repository -> UNRESOLVED, never fabricated", () => {
    const candidate = fixtureCandidate("c-unknown-repo", { requested_owner: `repo-res-never-registered-owner-${RUN}`, requested_repository: `repo-res-never-registered-repo-${RUN}` });
    const result = runRegistrationPipeline(candidate, store, "corr-c");
    assert(result.status === "UNRESOLVED", `expected UNRESOLVED, got ${result.status}: ${JSON.stringify(result)}`);
    assert((result as { failed_stage: string }).failed_stage === "REPOSITORY_RESOLUTION", `expected failed_stage=REPOSITORY_RESOLUTION, got ${(result as { failed_stage: string }).failed_stage}`);
    assert((result as { reason_code: string }).reason_code === "REPOSITORY_NOT_FOUND", `expected REPOSITORY_NOT_FOUND, got ${(result as { reason_code: string }).reason_code}`);
  });

  check("D. repository A candidate cannot be registered as repository B — no cross-contamination between two real, distinct repositories", () => {
    const candidateA = fixtureCandidate("d-repo-a", { requested_owner: ownerA, requested_repository: repoA });
    const candidateB = fixtureCandidate("d-repo-b", { requested_owner: ownerB, requested_repository: repoB });
    const resultA = runRegistrationPipeline(candidateA, store, "corr-d-a");
    const resultB = runRegistrationPipeline(candidateB, store, "corr-d-b");
    assert(resultA.status === "REGISTERED" && resultB.status === "REGISTERED", `both must register, got A=${resultA.status} B=${resultB.status}`);
    const repoIdA = (resultA as { repository_id: string | null }).repository_id;
    const repoIdB = (resultB as { repository_id: string | null }).repository_id;
    assert(repoIdA === repositoryIdA, `candidate A must resolve to repository A's real id, got ${repoIdA}`);
    assert(repoIdB === repositoryIdB, `candidate B must resolve to repository B's real id, got ${repoIdB}`);
    assert(repoIdA !== repoIdB, "the two real repositories must never resolve to the same repository_id");

    // Same claim shape as candidate A, but claiming B by owner/name — must independently resolve to B's own id, never A's, and never fabricate a cross-repo id.
    const candidateAClaimingB = fixtureCandidate("d-repo-a-claiming-b", { requested_owner: ownerB, requested_repository: repoB });
    const resultAClaimingB = runRegistrationPipeline(candidateAClaimingB, store, "corr-d-a-claiming-b");
    assert(resultAClaimingB.status === "REGISTERED", `expected REGISTERED, got ${resultAClaimingB.status}`);
    assert((resultAClaimingB as { repository_id: string | null }).repository_id === repositoryIdB, "a candidate claiming repository B must resolve to B's real id regardless of which repository an earlier, unrelated candidate resolved to");
  });

  check("E. duplicate registration preserves the ORIGINAL resource's canonical repository ownership, even if the resubmission claims a different real repository", () => {
    const original = fixtureCandidate("e-original", { requested_owner: ownerA, requested_repository: repoA });
    const first = runRegistrationPipeline(original, store, "corr-e-1");
    assert(first.status === "REGISTERED", `setup must register, got ${first.status}: ${JSON.stringify(first)}`);
    const originalResourceId = (first as { resource_id: string }).resource_id;

    // Identical semantic content (name/behavior/scope/etc unchanged), but claiming repository B this time — this must resolve as DUPLICATE and never reach Repository Resolution or the Writer at all.
    const resubmission: RegistrationCandidate = { ...original, candidate_id: `${original.candidate_id}-resubmit`, requested_owner: ownerB, requested_repository: repoB };
    const second = runRegistrationPipeline(resubmission, store, "corr-e-2");
    assert(second.status === "DUPLICATE", `expected DUPLICATE (proving Repository Resolution never runs for a duplicate), got ${second.status}: ${JSON.stringify(second)}`);

    const resource = findResourceById(originalResourceId, store);
    assert(resource !== null && resource.repository_id === repositoryIdA, `the original resource's repository_id must remain repository A's real id (${repositoryIdA}), untouched by the resubmission's different claim — got ${resource?.repository_id}`);
  });

  check("(no repository claim at all is a legitimate NOT_APPLICABLE, not a failure — existing candidate shape stays compatible)", () => {
    const candidate = fixtureCandidate("no-claim");
    const result = runRegistrationPipeline(candidate, store, "corr-no-claim");
    assert(result.status === "REGISTERED", `expected REGISTERED, got ${result.status}: ${JSON.stringify(result)}`);
    assert((result as { repository_id: string | null }).repository_id === null, `expected repository_id=null for a candidate with no repository claim, got ${(result as { repository_id: string | null }).repository_id}`);
  });

  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
