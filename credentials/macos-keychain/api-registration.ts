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
  // Owner-approved 2026-08-26: the Supabase Edge secret installer. Added
  // explicitly rather than by widening the check, so this list stays the
  // complete, readable answer to "who may write a credential".
  "credentials/supabase-edge-secret/installer.ts",
  // Owner-approved 2026-09-05: the MCP internal-transport machine identity.
  // Added by name for the same reason as the line above — this list stays the
  // complete, readable answer to "who may write a credential". The secret it
  // writes proves possession of a transport key only; it can never satisfy
  // VERIFIED_OWNER_SESSION or mint Owner authority.
  "connections/dna-os-mcp/internal-identity.ts",
  // Owner-approved 2026-09-01: the TikTok Login Kit OAuth lifecycle. Same
  // discipline as GitHub's — turns an Owner's real browser approval into a
  // Keychain-backed credential_ref; never accepts an Agent-forwarded secret.
  "connections/tiktok-authorization/lifecycle.ts",
  // Google Workspace OAuth lifecycle — exact requester only (no google/* wildcard).
  // Token completion writes credential://google/workspace/oauth; never Agent-forwarded.
  "connections/google-workspace/oauth/lifecycle.ts",
  // Google Workspace OAuth *client* admission — writes client-secret ref only.
  "connections/google-workspace/oauth/client-admission.ts",
  // Owner-approved 2026-09-02: ช่องตั้งค่า credential ใน Owner Settings ของ :5181
  // เส้นทางคือ Owner Settings UI -> owner-authentication (ต้องมี session ที่ยัง
  // ACTIVE) -> route นี้ -> registerOwnerApiCredential -> Keychain
  // เพิ่มชื่อผู้เรียกเท่านั้น ไม่ได้ผ่อนการตรวจ และไม่ได้เปิดให้ Agent เรียกได้
  // Agent ไม่มีทางถึง transport นี้: มันไม่มี network และไม่รู้ owner session
  "transport/owner-command-http/owner-credential-routes.ts",
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
