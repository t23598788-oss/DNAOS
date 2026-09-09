/**
 * หน้าที่: authenticate the registered GitHub SOURCE_AUTHORITY destination
 * through the Keychain credential reference only, then corroborate
 * owner/repo/branch and remote HEAD. Distinguishes credential failure
 * from repository inaccessibility. Never creates a repository.
 *
 * Input: RegisteredGithubDestination.
 * Output: remote identity + remote HEAD SHA, or a closed reason.
 * Dependency ที่อนุญาต: ../../connections/connection-registry/contract.ts,
 * ../../connections/github/credential-resolution.ts,
 * ../../connections/github/github-read-api.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never log token values. never use env_var fallback.
 * never ask a worker/model for a credential.
 */

import { lookupConnection } from "../../connections/connection-registry/contract";
import { resolveGithubCredential } from "../../connections/github/credential-resolution";
import { getAuthenticatedUser, getBranch, getRepository } from "../../connections/github/github-read-api";
import type { RegisteredGithubDestination } from "./github-destination";
import type { EngineeringGateReason } from "./types";

export interface AuthenticatedRemoteIdentity {
  readonly owner: string;
  readonly repository: string;
  readonly branch: string;
  readonly remote_head_sha: string;
  readonly credential_ref: string;
  readonly credential_source: string;
  readonly authenticated_login: string;
}

export type RemoteCorroboration =
  | { readonly ok: true; readonly remote: AuthenticatedRemoteIdentity }
  | { readonly ok: false; readonly reason_code: EngineeringGateReason; readonly detail: string };

export async function corroborateAuthenticatedGithubRemote(destination: RegisteredGithubDestination): Promise<RemoteCorroboration> {
  const connection = lookupConnection({ connection_id: destination.connection_id });
  if (!connection || connection.adapter !== "github") {
    return { ok: false, reason_code: "UNREGISTERED_REMOTE", detail: "GitHub connection_id is not registered" };
  }
  if (connection.credential_ref.kind !== "keychain_ref") {
    return { ok: false, reason_code: "CREDENTIAL_UNAVAILABLE", detail: "publication requires the registered Keychain credential_ref — env/worker/model fallback is denied" };
  }
  if (connection.credential_ref.ref !== destination.credential_ref) {
    return { ok: false, reason_code: "CREDENTIAL_UNAVAILABLE", detail: "connection credential_ref does not match the registered destination credential reference" };
  }

  const credential = await resolveGithubCredential(connection);
  if (!credential.ok) {
    return { ok: false, reason_code: "CREDENTIAL_UNAVAILABLE", detail: "Keychain credential reference could not be resolved — no worker/user/model fallback" };
  }

  const user = await getAuthenticatedUser(credential.token);
  if (user.kind !== "found") {
    const status = "http_status" in user ? user.http_status : null;
    if (status === 401 || status === 403) {
      return { ok: false, reason_code: "CREDENTIAL_INVALID", detail: "GitHub rejected the registered credential (invalid, expired, revoked, or forbidden)" };
    }
    return { ok: false, reason_code: "CREDENTIAL_INVALID", detail: "could not authenticate the registered GitHub credential as a user" };
  }

  const repo = await getRepository(credential.token, { owner: destination.owner, repo: destination.repository });
  if (repo.kind === "not_found_or_no_access") {
    return {
      ok: false,
      reason_code: "REPOSITORY_NOT_ACCESSIBLE",
      detail: `${destination.owner}/${destination.repository} is not visible to the registered credential — DNA OS will not create another repository`,
    };
  }
  if (repo.kind !== "found") {
    return { ok: false, reason_code: "REPOSITORY_NOT_ACCESSIBLE", detail: "GitHub repository lookup failed for the registered destination" };
  }
  if (repo.default_branch && repo.default_branch !== destination.default_branch) {
    return {
      ok: false,
      reason_code: "REMOTE_IDENTITY_MISMATCH",
      detail: `authenticated default_branch "${repo.default_branch}" does not match registered "${destination.default_branch}"`,
    };
  }

  const branch = await getBranch(credential.token, { owner: destination.owner, repo: destination.repository, branch: destination.publish_branch });
  if (branch.kind === "absent") {
    return { ok: false, reason_code: "REMOTE_NOT_FOUND", detail: `registered branch "${destination.publish_branch}" was not found on the authenticated repository` };
  }
  if (branch.kind !== "found" || !branch.head_commit_sha) {
    return { ok: false, reason_code: "REPOSITORY_NOT_ACCESSIBLE", detail: "could not read authenticated remote main HEAD" };
  }

  return {
    ok: true,
    remote: {
      owner: destination.owner,
      repository: destination.repository,
      branch: destination.publish_branch,
      remote_head_sha: branch.head_commit_sha,
      credential_ref: destination.credential_ref,
      credential_source: credential.credential_source,
      authenticated_login: user.login,
    },
  };
}
