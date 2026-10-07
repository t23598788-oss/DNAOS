/**
 * หน้าที่: the shape of one external-provider authorization lifecycle
 * record and its public API inputs/outputs. Provider-agnostic by design —
 * GitHub is the first (and today, only) provider, but nothing here names
 * "github" except as a runtime string value.
 *
 * Input: none (types only).
 * Output: `AuthorizationState`, `ProviderAuthorizationRecord`,
 * `BeginAuthorizationResult`, `AuthorizationStatusResult`,
 * `CompleteAuthorizationResult`, `PluginStatusReadModel`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never add a field here that could hold a raw secret —
 * only `credential_ref` (a reference string), never a token value.
 */

export type AuthorizationState =
  | "NOT_CONNECTED"
  | "AUTHORIZATION_REQUIRED"
  | "AUTHORIZATION_PENDING"
  | "CONNECTED"
  | "AUTHORIZATION_FAILED"
  | "REVOKED";

/**
 * Persisted record — everything here is safe to appear in logs, the
 * registry, or an HTTP response. `device_code` is a short-lived (default
 * 15-minute) session token the GitHub Device Flow itself defines as
 * non-sensitive (it authorizes nothing by itself; only the Owner's browser
 * approval does) — kept here only long enough for `completeAuthorization`
 * to poll with, never treated as a credential.
 */
export interface ProviderAuthorizationRecord {
  connection_id: string;
  provider: string;
  account: string | null;
  state: AuthorizationState;
  credential_ref: string | null;
  granted_scope: readonly string[] | null;
  device_code: string | null;
  device_code_expires_at: string | null;
  poll_interval_seconds: number | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface BeginAuthorizationInput {
  provider: string;
  cwd: string;
}

export type BeginAuthorizationResult =
  | {
      ok: true;
      connection_id: string;
      user_code: string;
      verification_uri: string;
      expires_in: number;
      interval: number;
    }
  | { ok: false; reason_code: string; detail: string };

export type AuthorizationStatusResult =
  | { ok: true; record: ProviderAuthorizationRecord }
  | { ok: false; reason_code: "AUTHORIZATION_NOT_FOUND" };

export type CompleteAuthorizationResult =
  | {
      ok: true;
      record: ProviderAuthorizationRecord;
      account_verification: { login: string };
      repository_verification: { owner: string; repository: string; branch: string };
    }
  | { ok: false; reason_code: string; detail: string; record: ProviderAuthorizationRecord | null };

export type RevokeAuthorizationResult =
  | { ok: true; record: ProviderAuthorizationRecord }
  | { ok: false; reason_code: "AUTHORIZATION_NOT_FOUND" };

/** UI-facing read model — never includes a token, device_code, or any other secret-adjacent field. */
export interface PluginStatusReadModel {
  provider: string;
  display_name: string;
  logo_key: string;
  login_status: "LOGGED_IN" | "NOT_LOGGED_IN" | "PENDING";
  plugin_status: "READY" | "NOT_READY" | "PENDING" | "ERROR";
  account: string | null;
  connection_status: string | null;
  authorization_status: AuthorizationState;
}

export interface BootstrapRequirement {
  requirement: string;
  satisfied: boolean;
  detail: string;
  owner_action: string | null;
}

export interface BootstrapCheckResult {
  ready: boolean;
  requirements: readonly BootstrapRequirement[];
}
