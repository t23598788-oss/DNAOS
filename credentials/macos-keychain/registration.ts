import { randomUUID } from "node:crypto";
import { buildDatabaseCredentialRef, registerDatabaseCredential } from "../registry/database-credential-registry";

const SECURITY = "/usr/bin/security";

/**
 * 2026-08-24 (Owner, "Single Process Creation Gate — Consolidation"):
 * a real, technical allowlist — NOT a "Owner-only" comment. Every real
 * caller of `registerOwnerDatabaseCredential` today (see
 * scripts/register-supabase-postgres-credential.ts,
 * scripts/register-local-postgres-credential.ts) must name itself here;
 * an unnamed `requester_identity` is DENIED before any Keychain write is
 * even attempted.
 */
const ALLOWED_REQUESTERS = [
  "scripts/register-supabase-postgres-credential.ts",
  "scripts/register-local-postgres-credential.ts",
] as const;

export interface OwnerDatabaseCredentialInput {
  requester_identity: string;
  owner: string;
  target: { host: string; port: number; database: string; role: string; schema: string };
  scope: readonly string[];
  service: string;
  account: string;
  secret: string;
}

export interface CredentialRegistrationResult {
  credential_ref: string;
  credential_type: "postgres_database";
  status: "ACTIVE";
}

/**
 * Real identity/authority check, then routed through the Process Gate.
 * The secret exists only for this call, is passed to the OS Keychain
 * command, and is never returned, logged, or persisted by DNA OS.
 */
export async function registerOwnerDatabaseCredential(input: OwnerDatabaseCredentialInput): Promise<CredentialRegistrationResult> {
  if (process.platform !== "darwin") throw new Error("KEYCHAIN_UNAVAILABLE");
  if (!ALLOWED_REQUESTERS.includes(input.requester_identity as (typeof ALLOWED_REQUESTERS)[number])) {
    throw new Error(`DENY: requester_identity "${input.requester_identity}" is not an authorized caller of registerOwnerDatabaseCredential`);
  }
  if (!input.secret || input.secret.includes("\n") || input.secret.includes("\r")) throw new Error("INVALID_SECRET_INPUT");
  if (!input.service || !input.account || !input.owner) throw new Error("INVALID_CREDENTIAL_METADATA");

  const { requestProcessExecution } = await import("../../execution/run/contract");
  const result = await requestProcessExecution({
    request_id: `pg-req-${randomUUID()}`,
    parent_work_order_id: null,
    requester_identity: "credentials/macos-keychain/registration.ts",
    executable_id: "keychain.add-generic-password",
    argv: ["add-generic-password", "-U", "-s", input.service, "-a", input.account, "-w", input.secret],
    cwd: "/tmp/dna-os-process-gate",
  });
  if (result.status !== "EXECUTED" || result.exit_code !== 0) {
    throw new Error(`KEYCHAIN_WRITE_DENIED: ${result.status}${result.reason ? `: ${result.reason}` : ""}`);
  }

  const credential_ref = buildDatabaseCredentialRef({
    owner: input.owner,
    host: input.target.host,
    port: input.target.port,
    database: input.target.database,
    role: input.target.role,
  });
  registerDatabaseCredential({
    credential_ref,
    credential_type: "postgres_database",
    owner: input.owner,
    target: input.target,
    scope: input.scope,
    status: "ACTIVE",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    resolver_kind: "macos_keychain",
    resolver_service: input.service,
    resolver_account: input.account,
  });
  return { credential_ref, credential_type: "postgres_database", status: "ACTIVE" };
}
