/**
 * หน้าที่: corroborate that a local directory is a checkout or git
 * worktree of exactly one ACTIVE repository-registry row. Identity is
 * the git common directory plus origin URL matching source_authority —
 * never process.cwd() alone, never a model-supplied repository_id.
 *
 * Input: a local checkout or worktree root.
 * Output: exactly one ACTIVE registration, or a fail-closed reason.
 * Dependency ที่อนุญาต: node:child_process, node:fs, node:path, ./types.ts,
 * ../../software/repository-registry/contract.ts.
 * สิ่งที่ห้ามแตะ: never pick among multiple matches. never invent a row.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { listRepositories, type RepositoryRegistration } from "../../software/repository-registry/contract";

export type RepositoryIdentity =
  | { readonly ok: true; readonly repository: RepositoryRegistration }
  | { readonly ok: false; readonly reason_code: "REPOSITORY_IDENTITY_MISSING" | "REPOSITORY_IDENTITY_AMBIGUOUS"; readonly detail: string };

function gitText(cwd: string, args: readonly string[]): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 10_000 }).trim() || null;
  } catch {
    return null;
  }
}

function normalizeGithubUrl(url: string): string {
  return url.replace(/\/+$/, "").replace(/\.git$/i, "").toLowerCase();
}

export function gitCommonDir(checkoutRoot: string): string | null {
  const raw = gitText(checkoutRoot, ["rev-parse", "--git-common-dir"]);
  if (!raw) return null;
  return resolve(checkoutRoot, raw);
}

export function gitOriginUrl(checkoutRoot: string): string | null {
  return gitText(checkoutRoot, ["remote", "get-url", "origin"]);
}

function configContainsAuthority(repositoryRoot: string, sourceAuthority: string): boolean {
  const common = gitCommonDir(repositoryRoot);
  const configPath = common ? join(common, "config") : join(repositoryRoot, ".git", "config");
  if (!existsSync(configPath)) return false;
  try {
    return readFileSync(configPath, "utf8").includes(sourceAuthority);
  } catch {
    return false;
  }
}

export function resolveCodingRepository(checkoutRoot: string): RepositoryIdentity {
  const checkout = resolve(checkoutRoot);
  const commonDir = gitCommonDir(checkout);
  const origin = gitOriginUrl(checkout);
  if (!commonDir || !origin) {
    return { ok: false, reason_code: "REPOSITORY_IDENTITY_MISSING", detail: "checkout is not a git repository with an origin remote — DNA OS will not guess a repository" };
  }

  const corroborated = listRepositories().filter((row) => {
    if (row.status !== "ACTIVE" || row.source_authority.length === 0) return false;
    const rowCommon = gitCommonDir(row.repository_root);
    if (!rowCommon || rowCommon !== commonDir) return false;
    if (normalizeGithubUrl(origin) !== normalizeGithubUrl(row.source_authority)) return false;
    return configContainsAuthority(row.repository_root, row.source_authority);
  });

  if (corroborated.length === 0) {
    return { ok: false, reason_code: "REPOSITORY_IDENTITY_MISSING", detail: "no ACTIVE repository-registry row corroborates this checkout via git common-dir and source_authority" };
  }
  if (corroborated.length > 1) {
    return {
      ok: false,
      reason_code: "REPOSITORY_IDENTITY_AMBIGUOUS",
      detail: `multiple ACTIVE repository rows corroborate this checkout: ${corroborated.map((row) => row.repository_id).join(", ")}`,
    };
  }
  return { ok: true, repository: corroborated[0]! };
}
