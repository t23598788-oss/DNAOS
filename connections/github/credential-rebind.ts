/**
 * Replacement-environment GitHub credential lifecycle.
 * Credentials are rebindable, never reconstructed from git.
 * States: UNBOUND -> REBIND_REQUIRED -> VERIFIED.
 *
 * Input: a ConnectionRegistration (credential_ref only).
 * Output: bind report with references and credential_source names only.
 * Dependency ที่อนุญาต: ./credential-resolution.ts, macos-keychain provider type.
 * สิ่งที่ห้ามแตะ: never copy, print, persist, or return raw token/secret values.
 */

import type { ConnectionRegistration } from "../../contracts/connector/connection";
import type { MacOsKeychainProvider } from "../../credentials/macos-keychain/index";
import { getAuthenticatedUser } from "./github-read-api";
import { resolveGithubCredential } from "./credential-resolution";

export type CredentialBindState = "UNBOUND" | "REBIND_REQUIRED" | "VERIFIED";

export interface CredentialBindReport {
  readonly state: CredentialBindState;
  readonly connection_id: string | null;
  readonly credential_ref: string | null;
  readonly credential_source: string | null;
  readonly secret_exposed: false;
  readonly detail: string;
}

function refString(connection: ConnectionRegistration | null): string | null {
  if (!connection) return null;
  if (connection.credential_ref.kind === "keychain_ref") return connection.credential_ref.ref;
  if (connection.credential_ref.kind === "env_var") return `env:${connection.credential_ref.name}`;
  return null;
}

export function inspectGithubCredentialBind(connection: ConnectionRegistration | null): CredentialBindReport {
  if (!connection) {
    return {
      state: "UNBOUND",
      connection_id: null,
      credential_ref: null,
      credential_source: null,
      secret_exposed: false,
      detail: "no GitHub connection is registered in the reconstructed environment",
    };
  }
  const credential_ref = refString(connection);
  if (!credential_ref) {
    return {
      state: "UNBOUND",
      connection_id: connection.connection_id,
      credential_ref: null,
      credential_source: null,
      secret_exposed: false,
      detail: "connection exists but has no real credential_ref — Device Flow / Owner bind is required",
    };
  }
  return {
    state: "REBIND_REQUIRED",
    connection_id: connection.connection_id,
    credential_ref,
    credential_source: null,
    secret_exposed: false,
    detail: "credential_ref is present; Keychain/Device Flow must be verified on this environment",
  };
}

export async function verifyGithubCredentialBind(
  connection: ConnectionRegistration | null,
  provider?: MacOsKeychainProvider,
  options: { readonly authenticate_github?: boolean } = {},
): Promise<CredentialBindReport> {
  const inspected = inspectGithubCredentialBind(connection);
  if (inspected.state === "UNBOUND" || !connection) return inspected;
  const resolved = await resolveGithubCredential(connection, provider);
  if (!resolved.ok) {
    return {
      ...inspected,
      state: "REBIND_REQUIRED",
      detail: `rebind required: ${resolved.reason}`,
    };
  }
  const authenticateGithub = options.authenticate_github ?? provider === undefined;
  if (!authenticateGithub) {
    return {
      state: "VERIFIED",
      connection_id: connection.connection_id,
      credential_ref: inspected.credential_ref,
      credential_source: resolved.credential_source,
      secret_exposed: false,
      detail: `credential resolved via ${resolved.credential_source} (GitHub /user not requested)`,
    };
  }
  const user = await getAuthenticatedUser(resolved.token);
  if (user.kind !== "found") {
    return {
      ...inspected,
      state: "REBIND_REQUIRED",
      credential_source: resolved.credential_source,
      detail: `Keychain resolved ${resolved.credential_source} but GitHub /user rejected it (http_status=${user.http_status}) — Device Flow rebind is required`,
    };
  }
  return {
    state: "VERIFIED",
    connection_id: connection.connection_id,
    credential_ref: inspected.credential_ref,
    credential_source: resolved.credential_source,
    secret_exposed: false,
    detail: `credential verified via ${resolved.credential_source} as GitHub login ${user.login}`,
  };
}

export function credentialBindReportExposesSecret(report: CredentialBindReport, extra?: unknown): boolean {
  const blob = JSON.stringify({ report, extra });
  return /\b(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN (RSA |OPENSSH )?PRIVATE KEY-----)/.test(blob);
}
