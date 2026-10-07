/**
 * หน้าที่: DNA OS Commit Authority. After admitted integration, DNA OS
 * creates a git commit object whose tree contains only admitted paths
 * parented at the registered default branch. Workers cannot supply git
 * commands or commit metadata.
 *
 * Input: VERIFIED EngineeringCompletionResult + registered checkout.
 * Output: DnaOsCommitResult.
 * Dependency ที่อนุญาต: node:child_process, node:fs, node:os, node:path,
 * ./observe.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never git add -A. never include porcelain paths outside
 * the admitted set. never run worker-supplied commit arguments. never
 * git push.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256File } from "./observe";
import type { DnaOsCommitResult, EngineeringCompletionResult, EngineeringGateReason } from "./types";

function fail(reason_code: EngineeringGateReason, detail: string, extra: Partial<DnaOsCommitResult> = {}): DnaOsCommitResult {
  return {
    committed: false,
    reason_code,
    detail,
    commit_sha: extra.commit_sha ?? null,
    parent_sha: extra.parent_sha ?? null,
    staged_paths: extra.staged_paths ?? [],
  };
}

function git(cwd: string, args: readonly string[], env?: Record<string, string | undefined>): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 30_000, env }).trim();
}

function porcelainPaths(checkoutRoot: string): readonly string[] {
  const raw = execFileSync("git", ["status", "--porcelain"], { cwd: checkoutRoot, encoding: "utf8", timeout: 20_000 });
  const paths: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.length < 4) continue;
    const body = line.slice(3);
    const renamed = body.split(" -> ");
    const path = (renamed.length === 2 ? renamed[1]! : body).replaceAll("\\", "/").replace(/\/+$/, "").trim();
    if (path.length === 0) continue;
    let isDirectory = false;
    try {
      isDirectory = statSync(join(checkoutRoot, path)).isDirectory();
    } catch {
      isDirectory = false;
    }
    if (isDirectory) {
      const nested = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z", "--", path], {
        cwd: checkoutRoot,
        encoding: "utf8",
        timeout: 20_000,
      });
      for (const child of nested.split("\0").map((item) => item.replaceAll("\\", "/").trim()).filter(Boolean)) {
        paths.push(child);
      }
      continue;
    }
    paths.push(path);
  }
  return [...new Set(paths)];
}

export function createDnaOsAdmittedTreeCommit(input: {
  readonly checkout_root: string;
  readonly parent_sha: string;
  readonly second_parent_sha?: string;
  readonly repository_id: string;
  readonly work_id: string;
  readonly admitted_paths: readonly string[];
  readonly path_sha256: Readonly<Record<string, string>>;
  readonly message: string;
}): DnaOsCommitResult {
  const admitted = [...input.admitted_paths].sort();
  if (admitted.length === 0) {
    return fail("UNDECLARED_FILE_CHANGE", "admitted changed_paths is empty — nothing to commit");
  }
  if (input.second_parent_sha && input.second_parent_sha === input.parent_sha) {
    return fail("BASE_REVISION_MISMATCH", "merge second parent must be a distinct lineage");
  }
  let dirty: readonly string[];
  try {
    dirty = porcelainPaths(input.checkout_root);
  } catch (error) {
    return fail("INTEGRATION_FAILED", `git status failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const admittedSet = new Set(admitted);
  const unrelated = dirty.filter((path) => !admittedSet.has(path));
  if (unrelated.length > 0) {
    return fail("UNRELATED_CHANGE_PRESENT", `working tree has paths outside the admitted set: ${unrelated.slice(0, 12).join(",")}`);
  }
  for (const path of admitted) {
    if (!dirty.includes(path)) {
      return fail("UNRELATED_CHANGE_PRESENT", `admitted path "${path}" is not present as a working-tree change at commit time`);
    }
    const hash = sha256File(join(input.checkout_root, path));
    const expected = input.path_sha256[path];
    if (!hash || !expected || hash !== expected) {
      return fail("MANIFEST_HASH_MISMATCH", `sha256 of admitted path "${path}" does not match the Engineering Result Manifest`);
    }
  }
  const indexDir = mkdtempSync(join(tmpdir(), "dna-os-commit-"));
  const indexFile = join(indexDir, "index");
  const env: Record<string, string | undefined> = {
    ...process.env,
    GIT_INDEX_FILE: indexFile,
    GIT_AUTHOR_NAME: "DNA OS Commit Authority",
    GIT_AUTHOR_EMAIL: "dna-os-commit-authority@local",
    GIT_COMMITTER_NAME: "DNA OS Commit Authority",
    GIT_COMMITTER_EMAIL: "dna-os-commit-authority@local",
  };
  try {
    git(input.checkout_root, ["read-tree", input.parent_sha], env);
    for (let i = 0; i < admitted.length; i += 80) {
      git(input.checkout_root, ["add", "--", ...admitted.slice(i, i + 80)], env);
    }
    const tree = git(input.checkout_root, ["write-tree"], env);
    const parentArgs = input.second_parent_sha
      ? ["-p", input.parent_sha, "-p", input.second_parent_sha]
      : ["-p", input.parent_sha];
    const commitSha = git(input.checkout_root, ["commit-tree", tree, ...parentArgs, "-m", input.message], env);
    git(input.checkout_root, ["update-ref", `refs/dna-os/engineering/${input.work_id}`, commitSha], env);
    return {
      committed: true,
      reason_code: "ADMITTED",
      detail: `DNA OS created commit ${commitSha} from admitted paths only`,
      commit_sha: commitSha,
      parent_sha: input.parent_sha,
      staged_paths: admitted,
    };
  } catch (error) {
    return fail("INTEGRATION_FAILED", `DNA OS commit-tree failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    rmSync(indexDir, { recursive: true, force: true });
  }
}

export function createDnaOsCommit(input: {
  readonly completion: EngineeringCompletionResult;
  readonly checkout_root: string;
  readonly parent_sha: string;
  readonly repository_id: string;
}): DnaOsCommitResult {
  const completion = input.completion;
  if (completion.status !== "VERIFIED" || completion.result_admission.decision !== "ALLOW" || !completion.integration?.integrated || !completion.manifest) {
    return fail("LOCAL_COMMIT_NOT_ADMITTED", "DNA OS commit requires a VERIFIED admitted integration result");
  }
  if (completion.coding.admission.repository_id !== input.repository_id || completion.manifest.repository_id !== input.repository_id) {
    return fail("REPOSITORY_IDENTITY_MISMATCH", "repository_id at commit time does not match the admitted work");
  }
  if (completion.manifest.base_commit_sha !== input.parent_sha) {
    return fail("BASE_REVISION_MISMATCH", "commit parent is not the admitted reservation base revision");
  }

  const admitted = [...completion.manifest.changed_paths].sort();
  if (admitted.length === 0) {
    return fail("UNDECLARED_FILE_CHANGE", "admitted changed_paths is empty — nothing to commit");
  }

  let dirty: readonly string[];
  try {
    dirty = porcelainPaths(input.checkout_root);
  } catch (error) {
    return fail("INTEGRATION_FAILED", `git status failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const admittedSet = new Set(admitted);
  const unrelated = dirty.filter((path) => !admittedSet.has(path));
  if (unrelated.length > 0) {
    return fail("UNRELATED_CHANGE_PRESENT", `working tree has paths outside the admitted set: ${unrelated.slice(0, 12).join(",")}`);
  }
  for (const path of admitted) {
    if (!dirty.includes(path)) {
      return fail("UNRELATED_CHANGE_PRESENT", `admitted path "${path}" is not present as a working-tree change at commit time`);
    }
    const hash = sha256File(join(input.checkout_root, path));
    const expected = completion.manifest.produced_artifacts.find((row) => row.path === path)?.sha256;
    if (!hash || !expected || hash !== expected) {
      return fail("MANIFEST_HASH_MISMATCH", `sha256 of admitted path "${path}" does not match the Engineering Result Manifest`);
    }
  }

  const requiredTests = completion.manifest.actual_test_results;
  if (requiredTests.some((row) => !row.passed) || requiredTests.length !== completion.manifest.required_tests.length) {
    return fail("TEST_EVIDENCE_MISSING", "required tests are not all passing at DNA OS commit time");
  }

  const message = [
    "DNA OS Engineering source commit",
    "",
    `command_id: ${completion.lineage.command_id}`,
    `work_id: ${completion.lineage.work_id}`,
    `manifest_id: ${completion.manifest.manifest_id}`,
    "admission: ALLOW",
    `integration: ${completion.lineage.integration_status ?? "INTEGRATED"}`,
    `repository_id: ${input.repository_id}`,
    `reservation_id: ${completion.lineage.reservation_id ?? ""}`,
    `base_revision: ${completion.manifest.base_commit_sha}`,
  ].join("\n");

  return createDnaOsAdmittedTreeCommit({
    checkout_root: input.checkout_root,
    parent_sha: input.parent_sha,
    repository_id: input.repository_id,
    work_id: completion.lineage.work_id,
    admitted_paths: admitted,
    path_sha256: Object.fromEntries(admitted.map((path) => [path, completion.manifest!.produced_artifacts.find((row) => row.path === path)!.sha256])),
    message,
  });
}

declare const process: { env: Record<string, string | undefined> };
