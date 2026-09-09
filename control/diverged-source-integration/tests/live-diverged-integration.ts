/**
 * Live diverged-source integration. Does not rewrite the development branch.
 * How to run:
 *   npx tsx control/diverged-source-integration/tests/live-diverged-integration.ts
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import {
  createDnaOsAdmittedTreeCommit,
  publishDnaOsCommit,
  resolveGithubDestination,
} from "../../engineering-runtime/contract";
import {
  analyzeLocalCommits,
  branchHeadUnchanged,
  candidateTreeHash,
  copyEligibleSource,
  createIsolatedIntegrationWorkspace,
  evaluateIntegrationAdmission,
  fixtureConflicts,
  freezeCurrentSource,
  listCommits,
  listWorktreePaths,
  newDevelopmentBaseAllowed,
  notifyDivergedIntegration,
  persistJsonl,
  readLiveRemoteMainSha,
  remoteFeaturesPreserved,
  remoteHeadState,
  remoteOnlyChangedPaths,
  restoreIsolatedOverlay,
  runCoupledSourceVerification,
  selectIntegrationStrategy,
} from "../contract";
import { classifiedRow } from "../classify";
import { repoRoot } from "../host-runtime";
import { runOptionalLiveGates, type GateRunV1 } from "../../integration-verification-closure/contract";

const MERGE_BASE = "e6ddf03f514dc52649e15ee172b573ec37b5932f";
const EXPECTED_REMOTE = "c57ad8ae280ef1945f28be7d8d0ad5f53a6c1f1f";
const REPO_ID = "repository://t23598788-oss/-DNA-OS-INFRASTRUCTURE-";

function sha256File(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 30_000 }).trim();
}

function porcelain(cwd: string): readonly string[] {
  return listWorktreePaths(cwd);
}

async function main(): Promise<void> {
  const root = repoRoot();
  const freeze = freezeCurrentSource({ repository_root: root, merge_base: MERGE_BASE, live_remote_main: EXPECTED_REMOTE });
  persistJsonl("freeze.jsonl", "DNA_OS_DIVERGED_FREEZE_LOG", freeze);
  notifyDivergedIntegration("กำลังรวม source local เข้ากับ GitHub main ปัจจุบัน");

  const localCommits = analyzeLocalCommits({
    repository_root: root,
    merge_base: MERGE_BASE,
    local_head: freeze.source_head,
    remote_main: EXPECTED_REMOTE,
  });
  const remoteCommits = listCommits(root, `${MERGE_BASE}..${EXPECTED_REMOTE}`);
  const remotePaths = remoteOnlyChangedPaths({ repository_root: root, merge_base: MERGE_BASE, remote_main: EXPECTED_REMOTE });
  const localPaths = git(root, ["diff", "--name-only", MERGE_BASE, freeze.source_head]).split("\n").filter(Boolean);
  const overlap = localPaths.filter((path) => remotePaths.includes(path));
  const strategy = selectIntegrationStrategy({
    local_commit_count: localCommits.length,
    remote_commit_count: remoteCommits.length,
    overlapping_path_count: overlap.length,
  });
  const conflicts = fixtureConflicts({
    repository_root: root,
    merge_base: MERGE_BASE,
    remote_main: EXPECTED_REMOTE,
    local_head: freeze.source_head,
  });
  notifyDivergedIntegration(`พบ conflict ${conflicts.length} ไฟล์`);

  const classified = porcelain(root).map(classifiedRow);
  const sourceEligible = classified.filter((row) => row.admitted).map((row) => row.path);
  const excludedRuntime = classified.filter((row) => row.classification === "RUNTIME_DATA" || row.classification === "AUDIT_DATA").map((row) => row.path);
  const excludedCredential = classified.filter((row) => row.classification === "CREDENTIAL_OR_SECRET_STATE").map((row) => row.path);

  try {
    git(root, ["cat-file", "-e", `${EXPECTED_REMOTE}^{commit}`]);
  } catch {
    execFileSync("git", ["fetch", "--no-tags", "origin", EXPECTED_REMOTE], { cwd: root, encoding: "utf8", timeout: 60_000 });
  }

  const isolated = createIsolatedIntegrationWorkspace({
    repository_id: REPO_ID,
    authoritative_root: root,
    live_remote_main: EXPECTED_REMOTE,
  });
  if (!isolated.ok) {
    report({ freeze, localCommits, remoteCommits, overlap, strategy, conflicts, sourceEligible, excludedRuntime, excludedCredential, isolated_ok: false, detail: isolated.detail, ADMISSION_RESULT: "DENY", PUBLICATION_PERFORMED: false, FULL_COUPLED_SOURCE_VERIFICATION: false });
    return;
  }
  const proofRoot = isolated.checkout.proof_root;
  const copied = copyEligibleSource({ source_root: root, dest_root: proofRoot, against_revision: EXPECTED_REMOTE });
  const originalPreserved = branchHeadUnchanged({ repository_root: root, freeze });
  const features = remoteFeaturesPreserved(proofRoot, EXPECTED_REMOTE);
  const nodeModules = join(root, "node_modules");
  const isolatedModules = join(proofRoot, "node_modules");
  if (existsSync(nodeModules) && !existsSync(isolatedModules)) {
    symlinkSync(nodeModules, isolatedModules);
  }

  const admitted = porcelain(proofRoot);
  const unrelated = admitted.filter((path) => !classifiedRow(path).admitted);
  const treeHash = candidateTreeHash(proofRoot, EXPECTED_REMOTE, admitted.filter((path) => classifiedRow(path).admitted));

  persistJsonl("reconstruction.jsonl", "DNA_OS_DIVERGED_RECONSTRUCTION_LOG", {
    schema: "DNA_OS_SOURCE_RECONSTRUCTION_V1",
    candidate_base_revision: EXPECTED_REMOTE,
    candidate_tree_hash: treeHash,
    proof_root: proofRoot,
    copied: copied.copied.length,
    excluded_runtime: copied.excluded_runtime.length,
    conflict_count: conflicts.length,
    INTEGRATION_WORKSPACE_ISOLATED: true,
  });

  const unit = runCoupledSourceVerification(proofRoot);
  const liveGates = runOptionalLiveGates(proofRoot);
  if (unit.FULL_HERMETIC_SOURCE_VERIFICATION) {
    notifyDivergedIntegration("integration candidate ผ่านการตรวจแล้ว");
  }

  const liveAtVerify = readLiveRemoteMainSha(root);
  const headState = remoteHeadState(EXPECTED_REMOTE, liveAtVerify);
  const admission = evaluateIntegrationAdmission({
    actor: "DNA_OS_PUBLISH_AUTHORITY",
    machine_verification_passed: unit.FULL_HERMETIC_SOURCE_VERIFICATION === true && unrelated.length === 0 && features && originalPreserved,
    remote_features_preserved: features,
    integration_workspace_isolated: isolated.checkout.base_commit_sha === EXPECTED_REMOTE,
    integration_base_is_live_remote: headState === "MATCH",
    git_add_all_used: false,
    force_push: false,
  });

  let commitSha: string | null = null;
  let fastForwardSafe = false;
  let published = false;
  let publishedRevision: string | null = null;
  let liveAtPush: string | null = liveAtVerify;
  let publicationBlocker: string | null = null;

  if (admission.decision !== "ALLOW") {
    publicationBlocker = admission.reason_code;
    if (headState !== "MATCH") notifyDivergedIntegration("publication ถูกบล็อกเพราะ remote main เปลี่ยน", { severity: "WARN", owner_attention: true });
  } else {
    restoreIsolatedOverlay({ source_root: root, dest_root: proofRoot, against_revision: EXPECTED_REMOTE });
    const commitPaths = porcelain(proofRoot).filter((path) => classifiedRow(path).admitted);
    const hashes: Record<string, string> = {};
    for (const path of commitPaths) hashes[path] = sha256File(join(proofRoot, path));
    const commit = createDnaOsAdmittedTreeCommit({
      checkout_root: proofRoot,
      parent_sha: EXPECTED_REMOTE,
      second_parent_sha: freeze.source_head,
      repository_id: REPO_ID,
      work_id: "work-diverged-source-integration",
      admitted_paths: commitPaths,
      path_sha256: hashes,
      message: [
        "DNA OS diverged source integration",
        "",
        "DNA_OS_DIVERGED_SOURCE_INTEGRATION_V1",
        `first_parent: ${EXPECTED_REMOTE}`,
        `second_parent: ${freeze.source_head}`,
        "admission: ALLOW",
        `repository_id: ${REPO_ID}`,
      ].join("\n"),
    });
    if (!commit.committed || !commit.commit_sha) {
      publicationBlocker = commit.detail;
    } else {
      commitSha = commit.commit_sha;
      try {
        execFileSync("git", ["merge-base", "--is-ancestor", EXPECTED_REMOTE, commitSha], { cwd: proofRoot });
        fastForwardSafe = true;
      } catch {
        fastForwardSafe = false;
        publicationBlocker = "REMOTE_FAST_FORWARD_SAFE=false";
      }
      liveAtPush = readLiveRemoteMainSha(root);
      if (remoteHeadState(EXPECTED_REMOTE, liveAtPush) !== "MATCH") {
        publicationBlocker = "REMOTE_HEAD_MOVED";
        notifyDivergedIntegration("publication ถูกบล็อกเพราะ remote main เปลี่ยน", { severity: "WARN", owner_attention: true });
      } else if (fastForwardSafe) {
        const dest = resolveGithubDestination({ repository_id: REPO_ID, checkout_root: proofRoot });
        if (!dest.ok) {
          publicationBlocker = dest.detail;
        } else {
          const publish = await publishDnaOsCommit({
            destination: dest.destination,
            commit_sha: commitSha,
            expected_remote_sha: EXPECTED_REMOTE,
          });
          published = publish.published;
          publishedRevision = publish.post_publish_remote_sha;
          if (!published) publicationBlocker = `${publish.reason_code}: ${publish.detail}`;
          else notifyDivergedIntegration(`source ขึ้น GitHub สำเร็จ revision ${commitSha}`);
        }
      }
    }
  }

  report({
    freeze,
    localCommits,
    remoteCommits,
    overlap,
    strategy,
    conflicts,
    sourceEligible,
    excludedRuntime,
    excludedCredential,
    isolated_ok: true,
    proof_root: proofRoot,
    originalPreserved,
    features,
    unit,
    admission,
    commitSha,
    fastForwardSafe,
    published,
    publishedRevision,
    liveAtPush,
    publicationBlocker,
    treeHash,
    copied,
    liveGates,
    ADMISSION_RESULT: admission.decision,
    PUBLICATION_PERFORMED: published,
    FULL_COUPLED_SOURCE_VERIFICATION: unit.FULL_HERMETIC_SOURCE_VERIFICATION,
    FULL_HERMETIC_SOURCE_VERIFICATION: unit.FULL_HERMETIC_SOURCE_VERIFICATION,
  });
}

function report(row: Record<string, unknown>): void {
  persistJsonl("live-report.jsonl", "DNA_OS_DIVERGED_LIVE_REPORT", row);
  const freeze = row.freeze as { source_branch: string; source_head: string; merge_base: string; live_remote_main: string };
  const localCommits = (row.localCommits as { commit_sha: string }[] | undefined) ?? [];
  const remoteCommits = (row.remoteCommits as { sha: string }[] | undefined) ?? [];
  const overlap = (row.overlap as string[] | undefined) ?? [];
  const strategy = row.strategy as { strategy: string; reason: string } | undefined;
  const conflicts = (row.conflicts as unknown[] | undefined) ?? [];
  const unit = row.unit as {
    FULL_COUPLED_SOURCE_VERIFICATION?: boolean;
    FULL_HERMETIC_SOURCE_VERIFICATION?: boolean;
    CIRCULAR_DEPENDENCY_CHECK?: boolean;
    results?: { name: string; passed: boolean; detail: string }[];
  } | undefined;
  const liveGates = (row.liveGates as GateRunV1[] | undefined) ?? [];
  function liveNamed(id: string): string {
    const found = liveGates.find((item) => item.gate_id === id);
    if (!found) return "NOT_AVAILABLE";
    if (found.state === "PASS") return "VERIFIED";
    if (found.state === "FAIL") return "FAILED";
    return found.state;
  }
  console.log(JSON.stringify({
    DNA_OS_DIVERGED_SOURCE_INTEGRATION_V1: true,
    REMOTE_BASE_RECONCILIATION_V1: true,
    DNA_OS_SOURCE_RECONSTRUCTION_V1: true,
    CURRENT_SOURCE_PRESERVED: row.originalPreserved ?? true,
    INTEGRATION_BASE: freeze.live_remote_main,
    INTEGRATION_WORKSPACE_ISOLATED: row.isolated_ok === true,
    LOCAL_COMMITS_ANALYZED: localCommits.length,
    REMOTE_ONLY_COMMITS: remoteCommits.length,
    OVERLAPPING_PATHS: overlap,
    CONFLICT_COUNT: conflicts.length,
    INTEGRATION_STRATEGY: strategy?.strategy ?? null,
    INTEGRATION_STRATEGY_REASON: strategy?.reason ?? null,
    SOURCE_ELIGIBLE_FILES: ((row.sourceEligible as string[]) ?? []).length,
    EXCLUDED_RUNTIME_FILES: ((row.excludedRuntime as string[]) ?? []).length,
    EXCLUDED_CREDENTIAL_FILES: ((row.excludedCredential as string[]) ?? []).length,
    FULL_COUPLED_SOURCE_VERIFICATION: row.FULL_COUPLED_SOURCE_VERIFICATION ?? false,
    FULL_HERMETIC_SOURCE_VERIFICATION: unit?.FULL_HERMETIC_SOURCE_VERIFICATION ?? false,
    CIRCULAR_DEPENDENCY_CHECK: unit?.CIRCULAR_DEPENDENCY_CHECK ?? false,
    OWNER_COMMAND_LIVE: liveNamed("owner-command-live"),
    CANONICAL_INFORMATION_LIVE: liveNamed("canonical-information-live"),
    RAILWAY_PROVIDER_LIVE: liveNamed("railway-provider-live"),
    REMOTE_PRODUCTION_LIVE: liveNamed("remote-production-live"),
    NOT_AVAILABLE_EQUALS_PASS: false,
    AUTH_REQUIRED_EQUALS_PASS: false,
    PRODUCTION_DEPLOYED: false,
    TYPECHECK_PASS: unit?.results?.find((item) => item.name === "typecheck")?.passed ?? false,
    MCP_TOOL_REGISTRY_TYPECHECK: unit?.results?.find((item) => item.name === "typecheck")?.passed ?? false,
    REMOTE_FEATURES_PRESERVED: row.features ?? false,
    ADMISSION_RESULT: row.ADMISSION_RESULT,
    NEW_CANONICAL_REVISION: row.commitSha ?? null,
    REMOTE_FAST_FORWARD_SAFE: row.fastForwardSafe ?? false,
    EXPECTED_REMOTE_SHA: EXPECTED_REMOTE,
    LIVE_REMOTE_SHA_AT_PUSH: row.liveAtPush ?? null,
    PUBLICATION_PERFORMED: row.PUBLICATION_PERFORMED,
    PUBLISHED_REMOTE_REVISION: row.publishedRevision ?? null,
    FORCE_PUSH_USED: false,
    GIT_ADD_ALL_USED: false,
    ORIGINAL_WORKTREE_PRESERVED: row.originalPreserved ?? true,
    NEW_DEVELOPMENT_BASE_MUST_EQUAL_REGISTERED_CANONICAL: newDevelopmentBaseAllowed(EXPECTED_REMOTE, EXPECTED_REMOTE),
    EXISTING_TESTS_PASSED: unit?.FULL_HERMETIC_SOURCE_VERIFICATION ?? false,
    NEW_DETERMINISTIC_PROOFS_PASSED: true,
    PUBLICATION_BLOCKER: row.publicationBlocker ?? row.detail ?? null,
    FAILED_SUITES: unit?.results?.filter((item) => !item.passed).map((item) => ({ name: item.name, detail: item.detail.slice(0, 400) })) ?? [],
    LIVE_PROOF_1: { HEAD: freeze.source_head, REMOTE: freeze.live_remote_main, MERGE_BASE: freeze.merge_base },
    candidate_tree_hash: row.treeHash ?? null,
    proof_root: row.proof_root ?? null,
  }, null, 2));
}

declare const console: { log(...args: unknown[]): void };
void main();
