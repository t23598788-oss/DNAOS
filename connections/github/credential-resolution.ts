/**
 * หน้าที่: resolve the REAL GitHub credential for one
 * `ConnectionRegistration`. STEP "Build Real GitHub Connection
 * Registration + Keychain Resolution" makes the CANONICAL path
 * `credential_ref` (a `keychain_ref` logical identity, e.g.
 * `credential://github/<owner>/<repository>/source-authority`) ->
 * `credentials/registry/api-credential-registry.ts` (metadata: which real
 * macOS Keychain service/account holds it) -> `credentials/macos-
 * keychain/`'s `MacOsKeychainProvider` (the real, allowlisted `security
 * find-generic-password` call) -> the secret, in memory, for this one
 * GitHub request only, discarded after use.
 *
 * The registry (this repo's `software_registry`, `connections/
 * connection-registry/`, and `credentials/registry/`) never holds the
 * token itself at any point — only references to where it lives. This is
 * the same env-var-by-reference DISCIPLINE this file always had; what
 * changed is that the reference can now point at a real macOS Keychain
 * entry instead of only a process environment variable.
 *
 * `env_var` remains supported, but ONLY as an explicit TEST/LEGACY
 * fallback (still restricted to the single allowlisted channel name,
 * `EXPECTED_GITHUB_CREDENTIAL_ENV_VAR_NAME`) — it is no longer the
 * canonical production path. A caller that wants the canonical path
 * registers a real Keychain-backed connection through
 * `connections/connection-registry/` and gets a `keychain_ref` back.
 *
 * Input: a `ConnectionRegistration`.
 * Output: `GithubCredentialResolution` — the token in memory, plus
 * `credential_source` (safe to log and audit — `keychain:<service>/<account>`
 * or `env:<name>`; the token value never is).
 * Dependency ที่อนุญาต: `../../contracts/connector/connection.ts`,
 * `./host-runtime`, `./adapter-config`,
 * `../../credentials/registry/api-credential-registry.ts` (metadata read
 * only — `findApiCredential`, never a write), `../../credentials/macos-
 * keychain/index.ts` (`MacOsKeychainProvider` — the real Keychain read,
 * reused unmodified), `../../credentials/secret-resolver/` and
 * `../../credentials/process-environment/` (CORE_NODE material only).
 * สิ่งที่ห้ามแตะ: ห้ามอ่าน credential จากที่อื่นนอกจาก
 * `process.env[EXPECTED_GITHUB_CREDENTIAL_ENV_VAR_NAME]` (legacy path),
 * a registered Keychain entry via `MacOsKeychainProvider` on darwin, or
 * the explicit CORE_NODE process-environment mapping for the same
 * credential_ref — ไม่มี fallback อื่น, ไม่มีการอ่าน env var ชื่อที่ไม่ได้
 * ถูก map. ห้ามใส่ค่า token ลงใน `reason`, log, error, event, หรือ
 * return value ใดๆ นอกจาก `token` เอง. ห้าม cache token ไว้ข้ามการเรียก.
 */

import type { ConnectionRegistration } from "../../contracts/connector/connection";
import { EXPECTED_GITHUB_CREDENTIAL_ENV_VAR_NAME } from "./adapter-config";
import { readEnvVar } from "./host-runtime";
import { findApiCredential } from "../../credentials/registry/api-credential-registry";
import { MacOsKeychainProvider } from "../../credentials/macos-keychain/index";
import { secretResolutionBackend } from "../../credentials/secret-resolver/node-credential-resolver";
import { resolveProcessEnvironmentSecret } from "../../credentials/process-environment/provider";

export type GithubCredentialResolution =
  | { ok: true; token: string; credential_source: string }
  | { ok: false; reason: string };

const defaultKeychainProvider = new MacOsKeychainProvider();

/**
 * `provider` defaults to a real `MacOsKeychainProvider` — the only
 * injection point in this file, and only for the exact same reason
 * `credentials/macos-keychain/provider.ts`'s own `commandRunner` option
 * exists: `credentials/macos-keychain/tests/provider.test.ts` already
 * proves the real OS-call shape (allowlisted command, argv, no bypass
 * flags) once, in that capability's own tests; this parameter lets
 * `connections/github/`'s and `control/source-execution/`'s own tests
 * prove the WIRING (credential_ref -> registry lookup -> the right
 * service/account passed to Keychain) is correct, without a second real
 * Keychain write per test run. Production code never passes this.
 */
async function resolveViaKeychain(ref: string, provider: MacOsKeychainProvider = defaultKeychainProvider): Promise<GithubCredentialResolution> {
  const entry = findApiCredential(ref);
  if (!entry) {
    return { ok: false, reason: `credential_ref "${ref}" has no registered entry in credentials/registry/api-credential-registry.ts — register it via credentials/macos-keychain/'s registerOwnerApiCredential first (Owner-only)` };
  }
  if (entry.status !== "ACTIVE") {
    return { ok: false, reason: `credential_ref "${ref}" is registered but not ACTIVE (status: ${entry.status})` };
  }
  if (entry.resolver_kind !== "macos_keychain") {
    return { ok: false, reason: `credential_ref "${ref}" names an unsupported resolver_kind "${entry.resolver_kind}" — only macos_keychain is understood today` };
  }

  if (secretResolutionBackend("CORE_NODE") === "process_environment") {
    const envResolution = resolveProcessEnvironmentSecret(ref);
    if (!envResolution.ok) {
      return { ok: false, reason: `CORE_NODE secret resolution failed for credential_ref "${ref}" (${envResolution.code}): ${envResolution.reason}` };
    }
    return { ok: true, token: envResolution.secret, credential_source: envResolution.credential_source };
  }

  const resolution = await provider.resolve({ service: entry.resolver_service, account: entry.resolver_account, kind: "api_key" });
  if (!resolution.ok) {
    return { ok: false, reason: `Keychain resolution failed for credential_ref "${ref}" (${resolution.code}): ${resolution.reason}` };
  }
  return { ok: true, token: resolution.secret, credential_source: resolution.credential_source };
}

/**
 * TEST/LEGACY fallback only — never the canonical production path. Same
 * single-channel enforcement as before: only
 * `EXPECTED_GITHUB_CREDENTIAL_ENV_VAR_NAME` is ever read, regardless of
 * what `credential_ref.name` claims.
 */
function resolveViaEnvVar(connection: ConnectionRegistration, envVarName: string): GithubCredentialResolution {
  const trimmedName = envVarName.trim();
  if (trimmedName.length === 0) {
    return { ok: false, reason: `connection "${connection.connection_id}" has credential_ref.kind="env_var" but an empty credential_ref.name — nothing to read` };
  }
  if (trimmedName !== EXPECTED_GITHUB_CREDENTIAL_ENV_VAR_NAME) {
    return {
      ok: false,
      reason: `connection "${connection.connection_id}" has credential_ref.name="${trimmedName}", but this legacy fallback only accepts "${EXPECTED_GITHUB_CREDENTIAL_ENV_VAR_NAME}" as its channel — refusing rather than reading an unintended variable`,
    };
  }
  const rawValue = readEnvVar(trimmedName);
  if (rawValue === undefined) {
    return { ok: false, reason: `environment variable "${trimmedName}" is not set in this process — this is the TEST/LEGACY fallback path only; the canonical path is a Keychain-backed connection via connections/connection-registry/` };
  }
  const token = rawValue.trim();
  if (token.length === 0) {
    return { ok: false, reason: `environment variable "${trimmedName}" is set but empty` };
  }
  return { ok: true, token, credential_source: `env:${trimmedName}` };
}

/**
 * Refuse to run without a resolvable credential — no anonymous fallback.
 * An unauthenticated GitHub request would still "work" against a public
 * repo, which would make a broken connection look healthy; that silent
 * downgrade is exactly the failure this function exists to prevent.
 */
export async function resolveGithubCredential(connection: ConnectionRegistration, provider?: MacOsKeychainProvider): Promise<GithubCredentialResolution> {
  const reference = connection.credential_ref;

  if (reference.kind === "keychain_ref") {
    return resolveViaKeychain(reference.ref, provider);
  }

  if (reference.kind === "env_var") {
    return resolveViaEnvVar(connection, reference.name);
  }

  return {
    ok: false,
    reason: `connection "${connection.connection_id}" has credential_ref.kind="${reference.kind}" — no real credential reference is registered yet, and this adapter refuses to run unauthenticated`,
  };
}

/**
 * The ONLY credential_ref this capability's inbound webhook receiver ever
 * resolves — same canonical Keychain path as `resolveGithubCredential`'s
 * `keychain_ref` branch (`../../credentials/registry/api-credential-registry.ts`
 * -> `MacOsKeychainProvider`), just keyed by a fixed, well-known reference
 * instead of a per-connection one, because a webhook has no
 * `ConnectionRegistration` of its own to carry it — GitHub, not this
 * repo, initiates the request. Registered separately (Owner-only) as
 * `credential://github/<owner>/<repo>/webhook-secret` per repository this
 * receiver is meant to accept pushes for; `repoRef` composes that exact
 * string so callers never hand-format it differently in two places.
 *
 * TEST/LEGACY fallback: `GITHUB_WEBHOOK_SECRET_INFRASTRUCTURE`, same
 * single-channel discipline as `EXPECTED_GITHUB_CREDENTIAL_ENV_VAR_NAME`
 * above — read only when no Keychain entry is registered yet.
 */
export function githubWebhookSecretCredentialRef(owner: string, repo: string): string {
  return `credential://github/${owner}/${repo}/webhook-secret`;
}

const WEBHOOK_SECRET_ENV_VAR_FALLBACK = "GITHUB_WEBHOOK_SECRET_INFRASTRUCTURE";

export async function resolveGithubWebhookSecret(owner: string, repo: string, provider?: MacOsKeychainProvider): Promise<GithubCredentialResolution> {
  const ref = githubWebhookSecretCredentialRef(owner, repo);
  const viaKeychain = await resolveViaKeychain(ref, provider);
  if (viaKeychain.ok) return viaKeychain;

  const fallback = readEnvVar(WEBHOOK_SECRET_ENV_VAR_FALLBACK);
  if (fallback !== undefined && fallback.trim().length > 0) {
    return { ok: true, token: fallback.trim(), credential_source: `env:${WEBHOOK_SECRET_ENV_VAR_FALLBACK}` };
  }

  return { ok: false, reason: `no webhook secret resolvable for "${ref}" — Keychain resolution failed (${viaKeychain.reason}) and TEST/LEGACY fallback env var "${WEBHOOK_SECRET_ENV_VAR_FALLBACK}" is not set` };
}
