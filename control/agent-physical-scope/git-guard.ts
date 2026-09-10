/**
 * Git credential and write proxy. Direct push/remote rewrite is denied.
 */

import type { CanonicalAgentScope, ScopeDenialReason } from "./types";

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
  const joined = argv.join(" ").toLowerCase();
  if (joined.includes("remote set-url") || joined.includes("remote add")) return true;
  if (/\bgit\s+push\b/.test(joined) || argv.includes("push")) return true;
  if (joined.includes("--force") || argv.includes("-f")) return true;
  return false;
}

export function guardGitWrite(
  scope: CanonicalAgentScope,
  input: { readonly repository_id: string; readonly operation: "commit" | "push"; readonly base_sha?: string },
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
