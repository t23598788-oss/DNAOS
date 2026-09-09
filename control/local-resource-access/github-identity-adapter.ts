/**
 * Harmless GitHub identity read via existing publication probe.
 * Returns credential_ref and login only — never a token.
 */

import { listConnections } from "../../connections/connection-registry/contract";
import { probeGithubPublicationAuth } from "../../connections/github/publication-auth-probe";
import type { ConnectionRegistration } from "../../contracts/connector/connection";

function latestGithubConnection(): ConnectionRegistration | null {
  const rows = listConnections().filter((row) => row.adapter === "github");
  return [...rows].reverse().find((row) => row.status === "connected") ?? rows[rows.length - 1] ?? null;
}

export async function readGithubIdentity(): Promise<Record<string, unknown>> {
  const connection = latestGithubConnection();
  const probe = await probeGithubPublicationAuth(connection);
  const credential_ref = connection?.credential_ref.kind === "keychain_ref"
    ? connection.credential_ref.ref
    : connection?.credential_ref.kind === "env_var"
      ? `env:${connection.credential_ref.name}`
      : null;
  return {
    provider: "github",
    connection_id: probe.connection_id,
    credential_ref,
    account_identity_non_secret: probe.authenticated_login,
    publication_auth_ok: probe.publication_auth_ok,
    resolve_ok: probe.resolve_ok,
    github_http_status: probe.github_http_status,
    secret_exposed: false,
    locality: "REMOTE",
    detail: probe.publication_auth_ok ? "authenticated GET /user via credential_ref" : probe.detail,
  };
}
