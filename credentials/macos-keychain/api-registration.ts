/** Owner-only registration boundary for API-token credentials (GitHub PAT
 * today) — the generic sibling of ./registration.ts's
 * registerOwnerDatabaseCredential, reusing the exact same real macOS
 * Keychain write (`security add-generic-password`) and the exact same
 * "secret exists only for this call, never returned/logged/persisted by
 * DNA OS" discipline. No new secret store — the secret's only home is
 * still macOS Keychain; this file only adds the metadata record shape
 * ../registry/api-credential-registry.ts needs.
 *
 * Input: `OwnerApiCredentialInput` (the real secret, passed only by the
 * Owner, never forwarded from an Agent API).
 * Output: `registerOwnerApiCredential` -> `{credential_ref, status}`.
 * Dependency ที่อนุญาต: node:child_process, node:util,
 * ../registry/api-credential-registry.ts.
 * สิ่งที่ห้ามแตะ: never return, log, or persist `input.secret` anywhere in
 * this file beyond the one `security add-generic-password` call it is
 * passed to.
 */
import { randomUUID } from "node:crypto";
import { registerApiCredential } from "../registry/api-credential-registry";

/**
 * 2026-08-24 (Owner, "Single Process Creation Gate — Consolidation"):
 * a real, technical allowlist — NOT an "Owner-only" comment. Every real
 * caller of `registerOwnerApiCredential` today must name itself here.
 */
const ALLOWED_REQUESTERS = [
  "connections/provider-authorization/lifecycle.ts",
  "connections/github/credential-resolution.ts",
] as const;

export interface OwnerApiCredentialInput {
  requester_identity: string;
  credential_ref: string;
  provider: string;
  account: string;
  scope: readonly string[];
  service: string;
  keychainAccount: string;
  secret: string;
}

export interface ApiCredentialRegistrationResult {
  credential_ref: string;
  status: "ACTIVE";
}

/**
 * Real identity/authority check, then routed through the Process Gate.
 * The secret is passed to the OS Keychain command and is never
 * returned, logged, or persisted by DNA OS beyond that one call.
 */
export async function registerOwnerApiCredential(input: OwnerApiCredentialInput): Promise<ApiCredentialRegistrationResult> {
  if (process.platform !== "darwin") throw new Error("KEYCHAIN_UNAVAILABLE");
  if (!ALLOWED_REQUESTERS.includes(input.requester_identity as (typeof ALLOWED_REQUESTERS)[number])) {
    throw new Error(`DENY: requester_identity "${input.requester_identity}" is not an authorized caller of registerOwnerApiCredential`);
  }
  if (!input.secret || input.secret.includes("\n") || input.secret.includes("\r")) throw new Error("INVALID_SECRET_INPUT");
  if (!input.service || !input.keychainAccount || !input.provider || !input.account || !input.credential_ref) throw new Error("INVALID_CREDENTIAL_METADATA");

  const { requestProcessExecution } = await import("../../execution/run/contract");
  const result = await requestProcessExecution({
    request_id: `pg-req-${randomUUID()}`,
    parent_work_order_id: null,
    requester_identity: "credentials/macos-keychain/api-registration.ts",
    executable_id: "keychain.add-generic-password",
    argv: ["add-generic-password", "-U", "-s", input.service, "-a", input.keychainAccount, "-w", input.secret],
    cwd: "/tmp/dna-os-process-gate",
  });
  if (result.status !== "EXECUTED" || result.exit_code !== 0) {
    throw new Error(`KEYCHAIN_WRITE_DENIED: ${result.status}${result.reason ? `: ${result.reason}` : ""}`);
  }

  registerApiCredential({
    credential_ref: input.credential_ref,
    provider: input.provider,
    account: input.account,
    scope: input.scope,
    status: "ACTIVE",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    resolver_kind: "macos_keychain",
    resolver_service: input.service,
    resolver_account: input.keychainAccount,
  });
  return { credential_ref: input.credential_ref, status: "ACTIVE" };
}
