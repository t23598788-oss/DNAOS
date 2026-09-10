/**
 * Git credential and write proxy. Direct push/remote rewrite is denied.
 */

import type { CanonicalAgentScope, ScopeDenialReason } from "./types";
import { canonicalizePath, realExistingPath } from "./host-runtime";

export interface GitGuardResult {
  readonly ok: boolean;
  readonly reason?: ScopeDenialReason;
  readonly detail?: string;
}

export function agentGitCredentialAuthority(): { readonly expose_pat: false; readonly mode: "NONE" } {
  return { expose_pat: false, mode: "NONE" };
}

export function guardAgentEnvironmentCredentials(env: Readonly<Record<string, string | undefined>>): GitGuardResult {
  for (const [name, value] of Object.entries(env)) {
    if (!value) continue;
    if (/GITHUB_(TOKEN|PAT)|GH_TOKEN/i.test(name)) {
      return { ok: false, reason: "BROAD_GIT_CREDENTIAL", detail: `${name} must not be present in agent environment` };
    }
  }
  return { ok: true };
}

export function looksLikeGitWriteEscape(argv: readonly string[]): boolean {
  const exe = argv[0] ?? "";
  const base = exe.split(/[/\\]/).pop() ?? "";
  if (base !== "git") return false;
  const rest = argv.slice(1);
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]!;
    if (token === "-C" || token === "-c") {
      i += 1;
      continue;
    }
    if (token.startsWith("-")) continue;
    if (token === "push") return true;
    if (token === "remote" && (rest[i + 1] === "set-url" || rest[i + 1] === "add")) return true;
    return false;
  }
  return false;
}

export function guardGitWrite(
  scope: CanonicalAgentScope,
  input: {
    readonly repository_id: string;
    readonly operation: "commit" | "push";
    readonly base_sha?: string;
    readonly git_root?: string;
    readonly branch?: string;
  },
): GitGuardResult {
  if (input.repository_id !== scope.repository_id) {
    return { ok: false, reason: "GIT_SCOPE_DENIED", detail: "repository_id mismatch" };
  }
  if (input.base_sha && input.base_sha !== scope.base_revision) {
    return { ok: false, reason: "STALE_PATCH", detail: "base sha mismatch" };
  }
  if (input.operation === "push" || scope.git_scope.mode === "NONE") {
    return { ok: false, reason: "GIT_SCOPE_DENIED", detail: "direct git push is not allowed" };
  }
  if (!scope.write_allowed) {
    return { ok: false, reason: "GIT_SCOPE_DENIED", detail: "git write not in scope" };
  }
  if (input.operation === "commit") {
    if (!input.git_root || !input.branch) {
      return { ok: false, reason: "GIT_SCOPE_DENIED", detail: "commit requires scoped git_root and branch" };
    }
    const root = realExistingPath(input.git_root) ?? canonicalizePath(input.git_root, "/");
    const scoped = realExistingPath(scope.worktree_path) ?? canonicalizePath(scope.worktree_path, "/");
    if (root !== scoped) {
      return { ok: false, reason: "GIT_SCOPE_DENIED", detail: "git_root is not the assigned worktree" };
    }
    if (input.branch !== scope.git_scope.allowed_branch) {
      return { ok: false, reason: "GIT_SCOPE_DENIED", detail: "branch is not the assigned agent-work branch" };
    }
  }
  return { ok: true };
}

export function guardGitPushProxy(
  scope: CanonicalAgentScope,
  input: { readonly repository_id: string; readonly remote_authority: string; readonly base_sha: string },
): GitGuardResult {
  if (input.repository_id !== scope.repository_id) {
    return { ok: false, reason: "GIT_SCOPE_DENIED", detail: "repository_id mismatch" };
  }
  if (scope.git_scope.remote_authority && input.remote_authority !== scope.git_scope.remote_authority) {
    return { ok: false, reason: "GIT_SCOPE_DENIED", detail: "remote authority mismatch" };
  }
  if (input.base_sha !== scope.base_revision) {
    return { ok: false, reason: "STALE_PATCH", detail: "stale base" };
  }
  return { ok: false, reason: "GIT_SCOPE_DENIED", detail: "push must use GitHub publish authority, not agent git" };
}
