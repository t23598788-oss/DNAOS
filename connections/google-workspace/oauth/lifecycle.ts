/**
 * Google Workspace OAuth lifecycle — TikTok begin/complete/revoke discipline.
 * One Workspace-family connection_id + one user credential_ref.
 * Never return/log/persist raw tokens or client_secret on the record.
 */

import {
  GOOGLE_AUTHORIZE_SCOPES,
  GOOGLE_CONNECTION_ID,
  GOOGLE_CREDENTIAL_REF,
  GOOGLE_OAUTH_CLIENT_ID_REF,
  GOOGLE_OAUTH_CLIENT_SECRET_REF,
} from "../contract";
import type {
  BeginGoogleAuthorizationInput,
  BeginGoogleAuthorizationResult,
  CompleteGoogleAuthorizationInput,
  CompleteGoogleAuthorizationResult,
  GoogleAuthorizationRecord,
  GoogleAuthorizationStatusResult,
  RevokeGoogleAuthorizationResult,
} from "./types";
import { findRecord, upsertRecord } from "./store";
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  getUserInfo,
  readGoogleOauthConfig,
} from "./google-oauth";
import { randomHex } from "./host-runtime";
import { registerOwnerApiCredential } from "../../../credentials/macos-keychain/index";
import {
  findApiCredential,
  replaceApiCredential,
  setApiCredentialStatus,
} from "../../../credentials/registry/api-credential-registry";

const PROVIDER = "google_workspace" as const;
const AUTHORIZE_LIFETIME_SECONDS = 10 * 60;
export const REQUESTER_IDENTITY = "connections/google-workspace/oauth/lifecycle.ts" as const;

export interface GoogleLifecycleDeps {
  readConfig: typeof readGoogleOauthConfig;
  buildAuthorizeUrl: typeof buildAuthorizeUrl;
  exchangeCodeForToken: typeof exchangeCodeForToken;
  getUserInfo: typeof getUserInfo;
  registerOwnerApiCredential: typeof registerOwnerApiCredential;
  findApiCredential: typeof findApiCredential;
  replaceApiCredential: typeof replaceApiCredential;
  setApiCredentialStatus: typeof setApiCredentialStatus;
  findRecord: typeof findRecord;
  upsertRecord: typeof upsertRecord;
  randomHex: typeof randomHex;
  now: () => Date;
}

const defaultDeps: GoogleLifecycleDeps = {
  readConfig: readGoogleOauthConfig,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  getUserInfo,
  registerOwnerApiCredential,
  findApiCredential,
  replaceApiCredential,
  setApiCredentialStatus,
  findRecord,
  upsertRecord,
  randomHex,
  now: () => new Date(),
};

function keychainNamesFor(googleAccountId: string): { service: string; account: string } {
  return { service: "dna-os-google-workspace-oauth", account: googleAccountId };
}

function emptyRecord(connection_id: string, nowIso: string): GoogleAuthorizationRecord {
  return {
    connection_id,
    provider: PROVIDER,
    google_account_id: null,
    account_email: null,
    state: "NOT_CONNECTED",
    credential_ref: null,
    granted_scope: null,
    code_verifier: null,
    state_nonce: null,
    redirect_uri: null,
    authorize_expires_at: null,
    failure_reason: null,
    expected_account_email: null,
    prior_google_account_id: null,
    prior_account_email: null,
    prior_credential_ref: null,
    prior_granted_scope: null,
    created_at: nowIso,
    updated_at: nowIso,
  };
}

function parseGrantedScopes(scope: string): string[] {
  return scope
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function normalizeEmail(email: string | null | undefined): string {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function clearPendingFields(record: GoogleAuthorizationRecord): Partial<GoogleAuthorizationRecord> {
  return {
    code_verifier: null,
    state_nonce: null,
    redirect_uri: null,
    authorize_expires_at: null,
    expected_account_email: null,
  };
}

/** Restore prior CONNECTED binding when replace-after-success must abort. */
function restorePriorBinding(
  record: GoogleAuthorizationRecord,
  nowIso: string,
  failure_reason: string,
): GoogleAuthorizationRecord {
  const hasPrior =
    record.prior_credential_ref !== null
    && record.prior_google_account_id !== null
    && Array.isArray(record.prior_granted_scope);
  if (!hasPrior) {
    return {
      ...record,
      ...clearPendingFields(record),
      state: "AUTHORIZATION_FAILED",
      failure_reason,
      prior_google_account_id: null,
      prior_account_email: null,
      prior_credential_ref: null,
      prior_granted_scope: null,
      updated_at: nowIso,
    };
  }
  return {
    ...record,
    ...clearPendingFields(record),
    state: "CONNECTED",
    google_account_id: record.prior_google_account_id,
    account_email: record.prior_account_email,
    credential_ref: record.prior_credential_ref,
    granted_scope: record.prior_granted_scope,
    failure_reason,
    prior_google_account_id: null,
    prior_account_email: null,
    prior_credential_ref: null,
    prior_granted_scope: null,
    updated_at: nowIso,
  };
}

/**
 * Begin: require Owner-admitted OAuth client; store pending PKCE + state;
 * return authorize_url only (never code_verifier / client_secret).
 * Optional login_hint / expected_account_email are transaction inputs only.
 */
export function beginAuthorization(
  input: BeginGoogleAuthorizationInput,
  deps: GoogleLifecycleDeps = defaultDeps,
): BeginGoogleAuthorizationResult {
  const nowIso = deps.now().toISOString();
  const connectionId = GOOGLE_CONNECTION_ID;
  const base = deps.findRecord(connectionId) ?? emptyRecord(connectionId, nowIso);
  const scope = input.scope && input.scope.length > 0 ? input.scope : GOOGLE_AUTHORIZE_SCOPES;

  if (!input.redirect_uri || input.redirect_uri.trim().length === 0) {
    return {
      ok: false,
      reason_code: "REDIRECT_URI_REQUIRED",
      detail: "redirect_uri must be the exact Owner-registered Google OAuth redirect URI",
      owner_action: null,
    };
  }

  const config = deps.readConfig();
  if ("missing" in config) {
    deps.upsertRecord({
      ...base,
      state: "CONFIGURATION_REQUIRED",
      code_verifier: null,
      state_nonce: null,
      redirect_uri: null,
      authorize_expires_at: null,
      failure_reason: `GOOGLE_OAUTH_CLIENT_NOT_CONFIGURED: ${config.missing.join(", ")}`,
      expected_account_email: null,
      updated_at: nowIso,
    });
    return {
      ok: false,
      reason_code: "CONFIGURATION_REQUIRED",
      detail: `Google OAuth client not admitted: ${config.missing.join(", ")}`,
      owner_action:
        `Owner must admit client id (${GOOGLE_OAUTH_CLIENT_ID_REF}), client secret (${GOOGLE_OAUTH_CLIENT_SECRET_REF}), ` +
        "and exact redirect URI before login. Next: GOOGLE_WORKSPACE_OAUTH_CLIENT_OWNER_ADMISSION_V1",
    };
  }

  if (input.redirect_uri !== config.redirect_uri) {
    return {
      ok: false,
      reason_code: "REDIRECT_URI_MISMATCH",
      detail: "redirect_uri must match the Owner-admitted Google OAuth client redirect URI",
      owner_action: null,
    };
  }

  const loginHint = typeof input.login_hint === "string" ? input.login_hint.trim() : "";
  const expectedRaw =
    typeof input.expected_account_email === "string" ? input.expected_account_email.trim() : "";
  const expectedAccountEmail = expectedRaw.length > 0 ? expectedRaw : null;

  // Preserve prior CONNECTED binding until replacement succeeds (replace-after-success).
  const preservingPrior = base.state === "CONNECTED" && base.credential_ref !== null;
  const prior_google_account_id = preservingPrior ? base.google_account_id : null;
  const prior_account_email = preservingPrior ? base.account_email : null;
  const prior_credential_ref = preservingPrior ? base.credential_ref : null;
  const prior_granted_scope = preservingPrior ? base.granted_scope : null;

  const codeVerifier = deps.randomHex(48);
  const stateNonce = deps.randomHex(16);
  const expiresAt = new Date(deps.now().getTime() + AUTHORIZE_LIFETIME_SECONDS * 1000).toISOString();

  deps.upsertRecord({
    ...base,
    state: "AUTHORIZATION_PENDING",
    code_verifier: codeVerifier,
    state_nonce: stateNonce,
    redirect_uri: input.redirect_uri,
    authorize_expires_at: expiresAt,
    // Keep identity/credential fields visible during reauth; do not clear prior snapshot.
    granted_scope: preservingPrior ? base.granted_scope : null,
    failure_reason: null,
    expected_account_email: expectedAccountEmail,
    prior_google_account_id,
    prior_account_email,
    prior_credential_ref,
    prior_granted_scope,
    updated_at: nowIso,
  });

  const authorizeUrl = deps.buildAuthorizeUrl(config, {
    scope,
    state: stateNonce,
    codeVerifier,
    login_hint: loginHint.length > 0 ? loginHint : undefined,
  });

  return {
    ok: true,
    connection_id: connectionId,
    authorize_url: authorizeUrl,
    state_nonce: stateNonce,
    expires_in_seconds: AUTHORIZE_LIFETIME_SECONDS,
  };
}

export function getAuthorizationStatus(
  connection_id: string,
  deps: GoogleLifecycleDeps = defaultDeps,
): GoogleAuthorizationStatusResult {
  const record = deps.findRecord(connection_id);
  if (!record) return { ok: false, reason_code: "AUTHORIZATION_NOT_FOUND" };
  return { ok: true, record };
}

export async function completeAuthorization(
  input: CompleteGoogleAuthorizationInput,
  deps: GoogleLifecycleDeps = defaultDeps,
): Promise<CompleteGoogleAuthorizationResult> {
  const nowIso = deps.now().toISOString();
  const record = deps.findRecord(input.connection_id);
  if (!record) {
    return {
      ok: false,
      reason_code: "AUTHORIZATION_NOT_FOUND",
      detail: `no record for ${input.connection_id}`,
      record: null,
    };
  }

  if (!input.code || input.code.trim().length === 0) {
    return { ok: false, reason_code: "CODE_REQUIRED", detail: "authorization code missing", record };
  }
  if (!input.state || input.state.trim().length === 0) {
    return { ok: false, reason_code: "STATE_REQUIRED", detail: "state missing", record };
  }

  if (record.state !== "AUTHORIZATION_PENDING" || !record.code_verifier || !record.state_nonce || !record.redirect_uri) {
    return {
      ok: false,
      reason_code: "NO_PENDING_AUTHORIZATION",
      detail: `state is "${record.state}"; expected AUTHORIZATION_PENDING with single-use PKCE material`,
      record,
    };
  }

  if (input.state !== record.state_nonce) {
    const failed = restorePriorBinding(record, nowIso, "STATE_MISMATCH");
    deps.upsertRecord(failed);
    return { ok: false, reason_code: "STATE_MISMATCH", detail: "state does not match pending transaction", record: failed };
  }

  if (record.authorize_expires_at && deps.now().getTime() > new Date(record.authorize_expires_at).getTime()) {
    const expired = restorePriorBinding(record, nowIso, "AUTHORIZE_EXPIRED");
    deps.upsertRecord(expired);
    return { ok: false, reason_code: "AUTHORIZE_EXPIRED", detail: "pending authorization expired", record: expired };
  }

  const config = deps.readConfig();
  if ("missing" in config) {
    return {
      ok: false,
      reason_code: "CONFIGURATION_REQUIRED",
      detail: `client config missing between begin and complete: ${config.missing.join(", ")}`,
      record,
    };
  }

  if (record.redirect_uri !== config.redirect_uri) {
    const failed = restorePriorBinding(record, nowIso, "REDIRECT_URI_MISMATCH");
    deps.upsertRecord(failed);
    return {
      ok: false,
      reason_code: "REDIRECT_URI_MISMATCH",
      detail: "stored redirect_uri does not match admitted client redirect URI",
      record: failed,
    };
  }

  const exchange = await deps.exchangeCodeForToken(config, {
    code: input.code,
    codeVerifier: record.code_verifier,
    redirect_uri: record.redirect_uri,
  });
  if (!exchange.ok) {
    const failed = restorePriorBinding(record, nowIso, `TOKEN_EXCHANGE_FAILED: ${exchange.reason_code}`);
    deps.upsertRecord(failed);
    return { ok: false, reason_code: exchange.reason_code, detail: exchange.detail, record: failed };
  }

  const grantedScope = parseGrantedScopes(exchange.scope);
  let accessToken: string | null = exchange.access_token;
  const refreshToken = exchange.refresh_token;

  const secretMaterial = refreshToken ?? accessToken;
  if (!secretMaterial) {
    const failed = restorePriorBinding(record, nowIso, "TOKEN_MATERIAL_MISSING");
    deps.upsertRecord(failed);
    return { ok: false, reason_code: "TOKEN_MATERIAL_MISSING", detail: "no token material to store", record: failed };
  }

  const userInfo = await deps.getUserInfo(accessToken!);
  if (userInfo.kind !== "found") {
    accessToken = null;
    const failed = restorePriorBinding(record, nowIso, `ACCOUNT_VERIFICATION_FAILED: ${userInfo.reason}`);
    deps.upsertRecord(failed);
    return { ok: false, reason_code: "ACCOUNT_VERIFICATION_FAILED", detail: userInfo.reason, record: failed };
  }

  const actualEmail = userInfo.email;
  const expected = normalizeEmail(record.expected_account_email);
  if (expected.length > 0 && normalizeEmail(actualEmail) !== expected) {
    accessToken = null;
    // Fail closed BEFORE credential replace — prior CONNECTED binding preserved.
    const failed = restorePriorBinding(
      record,
      nowIso,
      `ACCOUNT_MISMATCH: expected ${record.expected_account_email}; provider returned ${actualEmail ?? "null"}`,
    );
    deps.upsertRecord(failed);
    return {
      ok: false,
      reason_code: "ACCOUNT_MISMATCH",
      detail: `provider account ${actualEmail ?? "null"} does not match expected ${record.expected_account_email}`,
      record: failed,
    };
  }

  const googleAccountId = userInfo.sub;
  const { service, account } = keychainNamesFor(googleAccountId);
  try {
    await deps.registerOwnerApiCredential({
      requester_identity: REQUESTER_IDENTITY,
      credential_ref: GOOGLE_CREDENTIAL_REF,
      provider: PROVIDER,
      account: googleAccountId,
      scope: grantedScope,
      service,
      keychainAccount: account,
      secret: secretMaterial,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "DUPLICATE_CREDENTIAL_REF") {
      // Same canonical identity — replace metadata + Keychain already updated via -U.
      deps.replaceApiCredential({
        credential_ref: GOOGLE_CREDENTIAL_REF,
        provider: PROVIDER,
        account: googleAccountId,
        scope: grantedScope,
        status: "ACTIVE",
        updated_at: nowIso,
        resolver_kind: "macos_keychain",
        resolver_service: service,
        resolver_account: account,
      });
    } else {
      accessToken = null;
      const failed = restorePriorBinding(
        record,
        nowIso,
        `KEYCHAIN_REGISTRATION_FAILED: ${error instanceof Error ? error.message : String(error)}`,
      );
      deps.upsertRecord(failed);
      return {
        ok: false,
        reason_code: "KEYCHAIN_REGISTRATION_FAILED",
        detail: error instanceof Error ? error.message : String(error),
        record: failed,
      };
    }
  }

  accessToken = null;

  const connected: GoogleAuthorizationRecord = {
    ...record,
    state: "CONNECTED",
    google_account_id: googleAccountId,
    account_email: userInfo.email,
    credential_ref: GOOGLE_CREDENTIAL_REF,
    granted_scope: grantedScope,
    code_verifier: null,
    state_nonce: null,
    redirect_uri: null,
    authorize_expires_at: null,
    failure_reason: null,
    expected_account_email: null,
    prior_google_account_id: null,
    prior_account_email: null,
    prior_credential_ref: null,
    prior_granted_scope: null,
    updated_at: nowIso,
  };
  deps.upsertRecord(connected);
  return {
    ok: true,
    record: connected,
    account_verification: { google_account_id: googleAccountId, email: userInfo.email },
  };
}

export async function revokeAuthorization(
  connection_id: string,
  deps: GoogleLifecycleDeps = defaultDeps,
): Promise<RevokeGoogleAuthorizationResult> {
  const record = deps.findRecord(connection_id);
  if (!record) {
    return { ok: false, reason_code: "AUTHORIZATION_NOT_FOUND", detail: `no record for ${connection_id}`, record: null };
  }
  if (record.credential_ref) deps.setApiCredentialStatus(record.credential_ref, "REVOKED");
  const revoked: GoogleAuthorizationRecord = {
    ...record,
    state: "REVOKED",
    code_verifier: null,
    state_nonce: null,
    updated_at: deps.now().toISOString(),
  };
  deps.upsertRecord(revoked);
  return { ok: true, record: revoked };
}

export { GOOGLE_CONNECTION_ID as PRIMARY_CONNECTION_ID };
