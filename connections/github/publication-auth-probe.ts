/**
 * Safe publication-authentication probe.
 * Uses the same resolveGithubCredential + GET /user path as
 * corroborateAuthenticatedGithubRemote. Never returns or logs token values.
 *
 * Input: a ConnectionRegistration.
 * Output: metadata fingerprints + GitHub user lookup status.
 * Dependency ที่อนุญาต: ./credential-resolution.ts, ./github-read-api.ts,
 * ../../credentials/registry/api-credential-registry.ts, node:crypto.
 * สิ่งที่ห้ามแตะ: never include token/secret in the report.
 */

import { createHash } from "node:crypto";
import type { ConnectionRegistration } from "../../contracts/connector/connection";
import { findApiCredential } from "../../credentials/registry/api-credential-registry";
import { getAuthenticatedUser } from "./github-read-api";
import { resolveGithubCredential } from "./credential-resolution";

export interface PublicationAuthProbe {
  readonly process_cwd: string;
  readonly process_pid: number;
  readonly connection_id: string | null;
  readonly credential_ref: string | null;
  readonly credential_ref_kind: string | null;
  readonly provider: string | null;
  readonly resolver_kind: string | null;
  readonly resolver_service: string | null;
  readonly resolver_account: string | null;
  readonly registry_status: string | null;
  readonly registry_updated_at: string | null;
  readonly credential_source: string | null;
  readonly metadata_fingerprint: string | null;
  readonly resolve_ok: boolean;
  readonly github_user_kind: string | null;
  readonly github_http_status: number | null;
  readonly authenticated_login: string | null;
  readonly publication_auth_ok: boolean;
  readonly secret_exposed: false;
  readonly detail: string;
}

function refKind(connection: ConnectionRegistration | null): string | null {
  return connection?.credential_ref.kind ?? null;
}

function refValue(connection: ConnectionRegistration | null): string | null {
  if (!connection) return null;
  if (connection.credential_ref.kind === "keychain_ref") return connection.credential_ref.ref;
  if (connection.credential_ref.kind === "env_var") return `env:${connection.credential_ref.name}`;
  return null;
}

function fingerprint(parts: Record<string, string | null>): string {
  const stable = JSON.stringify(parts);
  return createHash("sha256").update(stable).digest("hex").slice(0, 16);
}

export async function probeGithubPublicationAuth(connection: ConnectionRegistration | null): Promise<PublicationAuthProbe> {
  const base = {
    process_cwd: process.cwd(),
    process_pid: process.pid,
    connection_id: connection?.connection_id ?? null,
    credential_ref: refValue(connection),
    credential_ref_kind: refKind(connection),
    secret_exposed: false as const,
  };
  if (!connection) {
    return {
      ...base,
      provider: null,
      resolver_kind: null,
      resolver_service: null,
      resolver_account: null,
      registry_status: null,
      registry_updated_at: null,
      credential_source: null,
      metadata_fingerprint: null,
      resolve_ok: false,
      github_user_kind: null,
      github_http_status: null,
      authenticated_login: null,
      publication_auth_ok: false,
      detail: "no connection registered",
    };
  }
  const ref = refValue(connection);
  const entry = ref && connection.credential_ref.kind === "keychain_ref" ? findApiCredential(ref) : null;
  const metadata_fingerprint = fingerprint({
    connection_id: connection.connection_id,
    credential_ref: ref,
    resolver_service: entry?.resolver_service ?? null,
    resolver_account: entry?.resolver_account ?? null,
    registry_status: entry?.status ?? null,
  });
  const resolved = await resolveGithubCredential(connection);
  if (!resolved.ok) {
    return {
      ...base,
      provider: entry?.provider ?? connection.adapter,
      resolver_kind: entry?.resolver_kind ?? null,
      resolver_service: entry?.resolver_service ?? null,
      resolver_account: entry?.resolver_account ?? null,
      registry_status: entry?.status ?? null,
      registry_updated_at: entry?.updated_at ?? null,
      credential_source: null,
      metadata_fingerprint,
      resolve_ok: false,
      github_user_kind: null,
      github_http_status: null,
      authenticated_login: null,
      publication_auth_ok: false,
      detail: resolved.reason,
    };
  }
  const user = await getAuthenticatedUser(resolved.token);
  return {
    ...base,
    provider: entry?.provider ?? connection.adapter,
    resolver_kind: entry?.resolver_kind ?? null,
    resolver_service: entry?.resolver_service ?? null,
    resolver_account: entry?.resolver_account ?? null,
    registry_status: entry?.status ?? null,
    registry_updated_at: entry?.updated_at ?? null,
    credential_source: resolved.credential_source,
    metadata_fingerprint,
    resolve_ok: true,
    github_user_kind: user.kind,
    github_http_status: user.http_status,
    authenticated_login: user.kind === "found" ? user.login : null,
    publication_auth_ok: user.kind === "found",
    detail: user.kind === "found"
      ? `GitHub /user accepted credential_source=${resolved.credential_source}`
      : `GitHub /user ${user.kind} http_status=${user.http_status} reason=${user.reason}`,
  };
}

declare const process: { cwd(): string; pid: number };
