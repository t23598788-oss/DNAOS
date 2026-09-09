/**
 * Owner admission of Google Workspace OAuth *client* configuration.
 * Biometric session gate + exact approval scope + Keychain secret write.
 * Never logs/returns/persists raw client_secret outside registerOwnerApiCredential.
 */

import {
  GOOGLE_CONNECTION_ID,
  GOOGLE_OAUTH_CALLBACK_PATH,
  GOOGLE_OAUTH_CLIENT_ID_REF,
  GOOGLE_OAUTH_CLIENT_SECRET_REF,
} from "../contract";
import { validateOwnerSession } from "../../../control/owner-authentication/contract";
import { registerOwnerApiCredential } from "../../../credentials/macos-keychain/index";
import { findApiCredential } from "../../../credentials/registry/api-credential-registry";
import {
  CANONICAL_CALLBACK_PATH,
  GOOGLE_OAUTH_APPLICATION_TYPE,
  GOOGLE_OAUTH_ENVIRONMENTS,
  REGISTER_GOOGLE_WORKSPACE_OAUTH_CLIENT_ACTION,
  type GoogleOauthAppEnvironment,
  type GoogleOauthClientAdmissionApproval,
  type GoogleOauthClientAdmissionInput,
  type GoogleOauthClientAdmissionResult,
  type GoogleOauthClientConfigRecord,
  type GoogleOauthClientConfigurationView,
} from "./client-config-types";
import { findLatestClientConfig, upsertClientConfig } from "./client-config-store";

export const CLIENT_ADMISSION_REQUESTER =
  "connections/google-workspace/oauth/client-admission.ts" as const;

const CLIENT_SECRET_KEYCHAIN = {
  service: "dna-os-google-workspace-oauth-client",
  keychainAccount: "client-secret",
} as const;

const MAX_BOUNDED = 256;
const MAX_SECRET = 512;

export interface GoogleOauthClientAdmissionDeps {
  validateOwnerSession: typeof validateOwnerSession;
  registerOwnerApiCredential: typeof registerOwnerApiCredential;
  findApiCredential: typeof findApiCredential;
  findLatestClientConfig: typeof findLatestClientConfig;
  upsertClientConfig: typeof upsertClientConfig;
  now: () => Date;
}

const defaultDeps: GoogleOauthClientAdmissionDeps = {
  validateOwnerSession,
  registerOwnerApiCredential,
  findApiCredential,
  findLatestClientConfig,
  upsertClientConfig,
  now: () => new Date(),
};

function fail(reason_code: string, detail: string): GoogleOauthClientAdmissionResult {
  return { ok: false, reason_code, detail, client_configuration_state: "CONFIGURATION_REQUIRED" };
}

function isEnvironment(value: unknown): value is GoogleOauthAppEnvironment {
  return typeof value === "string" && (GOOGLE_OAUTH_ENVIRONMENTS as readonly string[]).includes(value);
}

/** Exact redirect path match; hostname not guessed — Owner supplies full URI. */
export function validateRedirectUri(
  redirectUri: string,
  environment: GoogleOauthAppEnvironment,
): { ok: true } | { ok: false; reason_code: string; detail: string } {
  if (!redirectUri || redirectUri.trim().length === 0) {
    return { ok: false, reason_code: "REDIRECT_URI_REQUIRED", detail: "GOOGLE_REDIRECT_URI required" };
  }
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return { ok: false, reason_code: "REDIRECT_URI_INVALID", detail: "GOOGLE_REDIRECT_URI must be an absolute URI" };
  }
  if (url.pathname !== CANONICAL_CALLBACK_PATH && !redirectUri.endsWith(GOOGLE_OAUTH_CALLBACK_PATH)) {
    return {
      ok: false,
      reason_code: "REDIRECT_CALLBACK_PATH_MISMATCH",
      detail: `redirect URI must end with ${GOOGLE_OAUTH_CALLBACK_PATH}`,
    };
  }
  // Exact path segment check (preserve exact string for Google match later)
  if (!redirectUri.endsWith(GOOGLE_OAUTH_CALLBACK_PATH)) {
    return {
      ok: false,
      reason_code: "REDIRECT_CALLBACK_PATH_MISMATCH",
      detail: `redirect URI must end with ${GOOGLE_OAUTH_CALLBACK_PATH}`,
    };
  }
  if (environment === "PRODUCTION") {
    if (url.protocol !== "https:") {
      return { ok: false, reason_code: "PRODUCTION_HTTPS_REQUIRED", detail: "PRODUCTION redirect URI must use HTTPS" };
    }
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]") {
      return {
        ok: false,
        reason_code: "PRODUCTION_LOOPBACK_FORBIDDEN",
        detail: "PRODUCTION must not use localhost/loopback redirect URI",
      };
    }
  }
  if (environment === "TESTING") {
    const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if (!loopback && url.protocol !== "https:") {
      return {
        ok: false,
        reason_code: "TESTING_REDIRECT_POLICY",
        detail: "TESTING redirect must be loopback (http/https) or HTTPS non-loopback",
      };
    }
  }
  return { ok: true };
}

export function validateClientIdShape(clientId: string): { ok: true } | { ok: false; reason_code: string; detail: string } {
  if (!clientId || clientId.trim().length === 0) {
    return { ok: false, reason_code: "CLIENT_ID_REQUIRED", detail: "GOOGLE_OAUTH_CLIENT_ID required" };
  }
  if (clientId.length > MAX_BOUNDED || /\s/.test(clientId)) {
    return { ok: false, reason_code: "CLIENT_ID_INVALID", detail: "GOOGLE_OAUTH_CLIENT_ID must be a bounded non-whitespace string" };
  }
  // Public Google OAuth web client IDs end with this suffix; do not treat as secret.
  if (!clientId.endsWith(".apps.googleusercontent.com")) {
    return {
      ok: false,
      reason_code: "CLIENT_ID_SHAPE_INVALID",
      detail: "GOOGLE_OAUTH_CLIENT_ID must look like a Google OAuth client id (*.apps.googleusercontent.com)",
    };
  }
  return { ok: true };
}

function approvalMatchesPayload(
  approval: GoogleOauthClientAdmissionApproval,
  input: GoogleOauthClientAdmissionInput,
): { ok: true } | { ok: false; reason_code: string; detail: string } {
  if (!approval || typeof approval !== "object") {
    return { ok: false, reason_code: "APPROVAL_REQUIRED", detail: "exact Owner approval scope required" };
  }
  if (approval.action !== REGISTER_GOOGLE_WORKSPACE_OAUTH_CLIENT_ACTION) {
    return { ok: false, reason_code: "GENERIC_APPROVAL_REJECTED", detail: "approval.action must be REGISTER_GOOGLE_WORKSPACE_OAUTH_CLIENT" };
  }
  if (approval.connection_id !== GOOGLE_CONNECTION_ID) {
    return { ok: false, reason_code: "CONNECTION_ID_MISMATCH", detail: "approval connection_id must be connection.google.workspace.v1" };
  }
  if (approval.environment !== input.google_app_environment) {
    return { ok: false, reason_code: "APPROVAL_ENVIRONMENT_MISMATCH", detail: "approval.environment must match GOOGLE_APP_ENVIRONMENT" };
  }
  if (approval.google_cloud_project_id !== input.google_cloud_project_id) {
    return { ok: false, reason_code: "APPROVAL_PROJECT_MISMATCH", detail: "approval.google_cloud_project_id must match payload" };
  }
  if (approval.google_oauth_client_id !== input.google_oauth_client_id) {
    return { ok: false, reason_code: "APPROVAL_CLIENT_ID_MISMATCH", detail: "approval.google_oauth_client_id must match payload" };
  }
  if (approval.redirect_uri !== input.google_redirect_uri) {
    return { ok: false, reason_code: "APPROVAL_REDIRECT_MISMATCH", detail: "approval.redirect_uri must match payload exactly" };
  }
  if (approval.client_secret_ref !== GOOGLE_OAUTH_CLIENT_SECRET_REF) {
    return { ok: false, reason_code: "APPROVAL_SECRET_REF_MISMATCH", detail: "approval.client_secret_ref must be canonical secret ref" };
  }
  if (approval.application_type !== GOOGLE_OAUTH_APPLICATION_TYPE) {
    return { ok: false, reason_code: "APPROVAL_APPLICATION_TYPE_MISMATCH", detail: "application_type must be WEB_APPLICATION" };
  }
  return { ok: true };
}

/**
 * Admit Owner-provided OAuth client config. Does not begin Google login.
 */
export async function admitGoogleOauthClient(
  input: GoogleOauthClientAdmissionInput,
  deps: GoogleOauthClientAdmissionDeps = defaultDeps,
): Promise<GoogleOauthClientAdmissionResult> {
  if (!input.owner_session_id || input.owner_session_id.trim().length === 0) {
    return fail("OWNER_SESSION_REQUIRED", "active Owner session required");
  }
  const session = deps.validateOwnerSession(input.owner_session_id);
  if (!session.ok) {
    return fail(session.reason_code, "Owner session not ACTIVE");
  }

  if (!isEnvironment(input.google_app_environment)) {
    return fail("UNSUPPORTED_ENVIRONMENT", "GOOGLE_APP_ENVIRONMENT must be TESTING or PRODUCTION");
  }

  const approvalCheck = approvalMatchesPayload(input.approval, input);
  if (!approvalCheck.ok) return fail(approvalCheck.reason_code, approvalCheck.detail);

  const projectId = input.google_cloud_project_id?.trim() ?? "";
  if (!projectId) return fail("PROJECT_ID_REQUIRED", "GOOGLE_CLOUD_PROJECT_ID required");
  if (projectId.length > MAX_BOUNDED || /\s/.test(projectId)) {
    return fail("PROJECT_ID_INVALID", "GOOGLE_CLOUD_PROJECT_ID must be a bounded non-whitespace string");
  }

  const clientIdCheck = validateClientIdShape(input.google_oauth_client_id?.trim() ?? "");
  if (!clientIdCheck.ok) return fail(clientIdCheck.reason_code, clientIdCheck.detail);

  const secret = typeof input.google_oauth_client_secret === "string" ? input.google_oauth_client_secret : "";
  if (!secret || secret.trim().length === 0) return fail("CLIENT_SECRET_REQUIRED", "GOOGLE_OAUTH_CLIENT_SECRET required");
  if (secret.length > MAX_SECRET || secret.includes("\n") || secret.includes("\r")) {
    return fail("CLIENT_SECRET_INVALID", "GOOGLE_OAUTH_CLIENT_SECRET invalid");
  }

  const redirectCheck = validateRedirectUri(input.google_redirect_uri?.trim() ?? "", input.google_app_environment);
  if (!redirectCheck.ok) return fail(redirectCheck.reason_code, redirectCheck.detail);

  // Persist secret first — never place secret on the public config record.
  try {
    await deps.registerOwnerApiCredential({
      requester_identity: CLIENT_ADMISSION_REQUESTER,
      credential_ref: GOOGLE_OAUTH_CLIENT_SECRET_REF,
      provider: "google_workspace_oauth_client",
      account: "oauth-client",
      scope: ["OAUTH_CLIENT_SECRET"],
      service: CLIENT_SECRET_KEYCHAIN.service,
      keychainAccount: CLIENT_SECRET_KEYCHAIN.keychainAccount,
      secret,
    });
  } catch (error) {
    if (!(error instanceof Error && error.message === "DUPLICATE_CREDENTIAL_REF")) {
      return fail(
        "KEYCHAIN_REGISTRATION_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const nowIso = deps.now().toISOString();
  const record: GoogleOauthClientConfigRecord = {
    connection_id: GOOGLE_CONNECTION_ID,
    environment: input.google_app_environment,
    google_cloud_project_id: projectId,
    oauth_client_id: input.google_oauth_client_id.trim(),
    oauth_client_id_ref: GOOGLE_OAUTH_CLIENT_ID_REF,
    oauth_client_secret_ref: GOOGLE_OAUTH_CLIENT_SECRET_REF,
    redirect_uri: input.google_redirect_uri.trim(),
    application_type: GOOGLE_OAUTH_APPLICATION_TYPE,
    status: "CONFIGURED",
    admitted_at: nowIso,
    updated_at: nowIso,
  };
  deps.upsertClientConfig(record);

  return {
    ok: true,
    client_configuration_state: "CONFIGURED",
    connection_id: GOOGLE_CONNECTION_ID,
    environment: record.environment,
    google_cloud_project_id: record.google_cloud_project_id,
    oauth_client_id: record.oauth_client_id,
    oauth_client_id_ref: GOOGLE_OAUTH_CLIENT_ID_REF,
    oauth_client_secret_ref: GOOGLE_OAUTH_CLIENT_SECRET_REF,
    redirect_uri: record.redirect_uri,
    application_type: GOOGLE_OAUTH_APPLICATION_TYPE,
    authorization_transaction_created: false,
    login_started: false,
  };
}

/**
 * External configuration view — never includes resolved client_secret.
 */
export function getGoogleOauthClientConfigurationView(
  deps: Pick<GoogleOauthClientAdmissionDeps, "findLatestClientConfig" | "findApiCredential"> = defaultDeps,
): GoogleOauthClientConfigurationView {
  const record = deps.findLatestClientConfig();
  const secretEntry = deps.findApiCredential(GOOGLE_OAUTH_CLIENT_SECRET_REF);
  const secretPresent = secretEntry?.status === "ACTIVE";
  const missing: string[] = [];
  if (!record) {
    missing.push(
      "GOOGLE_APP_ENVIRONMENT",
      "GOOGLE_CLOUD_PROJECT_ID",
      "GOOGLE_OAUTH_CLIENT_ID",
      "GOOGLE_OAUTH_CLIENT_SECRET",
      "GOOGLE_REDIRECT_URI",
    );
  } else {
    if (!record.google_cloud_project_id) missing.push("GOOGLE_CLOUD_PROJECT_ID");
    if (!record.oauth_client_id) missing.push("GOOGLE_OAUTH_CLIENT_ID");
    if (!record.redirect_uri) missing.push("GOOGLE_REDIRECT_URI");
    if (!record.environment) missing.push("GOOGLE_APP_ENVIRONMENT");
  }
  if (!secretPresent) missing.push("GOOGLE_OAUTH_CLIENT_SECRET");

  const configured = missing.length === 0 && record?.status === "CONFIGURED";
  return {
    client_configuration_state: configured ? "CONFIGURED" : "CONFIGURATION_REQUIRED",
    connection_id: GOOGLE_CONNECTION_ID,
    environment: record?.environment ?? null,
    google_cloud_project_id: record?.google_cloud_project_id ?? null,
    oauth_client_id: record?.oauth_client_id ?? null,
    oauth_client_id_ref: GOOGLE_OAUTH_CLIENT_ID_REF,
    oauth_client_secret_ref: GOOGLE_OAUTH_CLIENT_SECRET_REF,
    redirect_uri: record?.redirect_uri ?? null,
    application_type: GOOGLE_OAUTH_APPLICATION_TYPE,
    configured,
    missing,
  };
}

export { CLIENT_SECRET_KEYCHAIN };
