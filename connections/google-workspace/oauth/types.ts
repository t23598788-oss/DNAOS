/**
 * Google Workspace OAuth record shapes — TikTok lifecycle discipline, Google semantics.
 * Never store access_token / refresh_token / client_secret.
 */

export type GoogleAuthorizationState =
  | "NOT_CONNECTED"
  | "CONFIGURATION_REQUIRED"
  | "AUTHORIZATION_PENDING"
  | "CONNECTED"
  | "AUTHORIZATION_FAILED"
  | "REVOKED";

export interface GoogleAuthorizationRecord {
  connection_id: string;
  provider: "google_workspace";
  /** Proven Google subject / email after userinfo — null until CONNECTED. */
  google_account_id: string | null;
  account_email: string | null;
  state: GoogleAuthorizationState;
  credential_ref: string | null;
  granted_scope: readonly string[] | null;
  code_verifier: string | null;
  state_nonce: string | null;
  redirect_uri: string | null;
  authorize_expires_at: string | null;
  failure_reason: string | null;
  /**
   * Transaction-scoped expected account email (login_hint companion).
   * Not a global Google constant — set per begin input / connection instance.
   */
  expected_account_email: string | null;
  /** Snapshot of prior CONNECTED binding for replace-after-success restore. */
  prior_google_account_id: string | null;
  prior_account_email: string | null;
  prior_credential_ref: string | null;
  prior_granted_scope: readonly string[] | null;
  created_at: string;
  updated_at: string;
}

export interface BeginGoogleAuthorizationInput {
  /** Exact redirect URI registered in Google Cloud Console. */
  redirect_uri: string;
  /** Scopes to request; defaults to GOOGLE_AUTHORIZE_SCOPES when omitted by caller. */
  scope?: readonly string[];
  /**
   * Optional Google OAuth login_hint (account suggestion only — not proof).
   * Transaction/config input; never a hardcoded provider constant.
   */
  login_hint?: string;
  /**
   * When set, callback must prove this exact account email or fail ACCOUNT_MISMATCH
   * without replacing the prior CONNECTED binding.
   */
  expected_account_email?: string;
}

export type BeginGoogleAuthorizationResult =
  | {
      ok: true;
      connection_id: string;
      authorize_url: string;
      state_nonce: string;
      expires_in_seconds: number;
    }
  | { ok: false; reason_code: string; detail: string; owner_action: string | null };

export interface CompleteGoogleAuthorizationInput {
  connection_id: string;
  code: string;
  state: string;
}

export type CompleteGoogleAuthorizationResult =
  | {
      ok: true;
      record: GoogleAuthorizationRecord;
      account_verification: { google_account_id: string; email: string | null };
    }
  | { ok: false; reason_code: string; detail: string; record: GoogleAuthorizationRecord | null };

export type GoogleAuthorizationStatusResult =
  | { ok: true; record: GoogleAuthorizationRecord }
  | { ok: false; reason_code: "AUTHORIZATION_NOT_FOUND" };

export type RevokeGoogleAuthorizationResult =
  | { ok: true; record: GoogleAuthorizationRecord }
  | { ok: false; reason_code: string; detail: string; record: GoogleAuthorizationRecord | null };
