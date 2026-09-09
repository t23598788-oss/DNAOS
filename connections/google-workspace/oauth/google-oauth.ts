/**
 * Google Workspace OAuth 2.0 client — authorize URL, token exchange, userinfo.
 * Architecture shape mirrors connections/tiktok-authorization/tiktok-oauth.ts.
 * Provider semantics are Google-only (S256 base64url PKCE; Google endpoints).
 *
 * Endpoints (canonical Google OAuth):
 *   authorize  https://accounts.google.com/o/oauth2/v2/auth
 *   token      https://oauth2.googleapis.com/token
 *   userinfo   https://openidconnect.googleapis.com/v1/userinfo
 *
 * PKCE (RFC 7636 / Google):
 *   code_challenge = BASE64URL(SHA256(ASCII(code_verifier)))
 *   code_challenge_method = S256
 * TikTok hex digest must not be used here.
 *
 * Never log/persist client_secret, authorization_code, access_token, refresh_token
 * beyond returning them once to lifecycle.
 */

import {
  GOOGLE_OAUTH_AUTHORIZE_URL,
  GOOGLE_OAUTH_TOKEN_URL,
  GOOGLE_USERINFO_URL,
} from "../contract";
import { base64UrlEncode, hostFetchGet, hostFetchPost, readEnvVar, sha256Raw } from "./host-runtime";

export const GOOGLE_OAUTH_ENDPOINTS = {
  AUTHORIZE_URL: GOOGLE_OAUTH_AUTHORIZE_URL,
  TOKEN_URL: GOOGLE_OAUTH_TOKEN_URL,
  USERINFO_URL: GOOGLE_USERINFO_URL,
} as const;

export interface GoogleOauthConfig {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
}

/**
 * Owner-supplied OAuth client. DNA OS does not invent Google Cloud projects.
 * Until Owner admits values, beginAuthorization returns CONFIGURATION_REQUIRED.
 *
 * Env mirrors (staging / Owner admission; never commit real secrets):
 *   GOOGLE_WORKSPACE_OAUTH_CLIENT_ID
 *   GOOGLE_WORKSPACE_OAUTH_CLIENT_SECRET
 *   GOOGLE_WORKSPACE_OAUTH_REDIRECT_URI
 *
 * Canonical refs:
 *   credential://google/workspace/oauth-client/client-id
 *   credential://google/workspace/oauth-client/client-secret
 */
export function readGoogleOauthConfig(): GoogleOauthConfig | { missing: string[] } {
  const client_id = readEnvVar("GOOGLE_WORKSPACE_OAUTH_CLIENT_ID");
  const client_secret = readEnvVar("GOOGLE_WORKSPACE_OAUTH_CLIENT_SECRET");
  const redirect_uri = readEnvVar("GOOGLE_WORKSPACE_OAUTH_REDIRECT_URI");
  const missing: string[] = [];
  if (!client_id) missing.push("GOOGLE_WORKSPACE_OAUTH_CLIENT_ID");
  if (!client_secret) missing.push("GOOGLE_WORKSPACE_OAUTH_CLIENT_SECRET");
  if (!redirect_uri) missing.push("GOOGLE_WORKSPACE_OAUTH_REDIRECT_URI");
  if (missing.length > 0) return { missing };
  return { client_id: client_id!, client_secret: client_secret!, redirect_uri: redirect_uri! };
}

/** Google PKCE S256: SHA-256 bytes → base64url without padding. */
export function deriveCodeChallenge(codeVerifier: string): string {
  return base64UrlEncode(sha256Raw(codeVerifier));
}

export function buildAuthorizeUrl(
  config: GoogleOauthConfig,
  params: { scope: readonly string[]; state: string; codeVerifier: string },
): string {
  const query = new URLSearchParams({
    client_id: config.client_id,
    redirect_uri: config.redirect_uri,
    response_type: "code",
    scope: params.scope.join(" "),
    state: params.state,
    code_challenge: deriveCodeChallenge(params.codeVerifier),
    code_challenge_method: "S256",
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
  });
  return `${GOOGLE_OAUTH_AUTHORIZE_URL}?${query.toString()}`;
}

export type TokenExchangeResult =
  | {
      ok: true;
      access_token: string;
      refresh_token: string | null;
      scope: string;
      expires_in: number;
      token_type: string;
    }
  | { ok: false; reason_code: string; detail: string };

export async function exchangeCodeForToken(
  config: GoogleOauthConfig,
  params: { code: string; codeVerifier: string; redirect_uri: string },
): Promise<TokenExchangeResult> {
  if (params.redirect_uri !== config.redirect_uri) {
    return {
      ok: false,
      reason_code: "REDIRECT_URI_MISMATCH",
      detail: "redirect_uri must match the prepared authorization transaction",
    };
  }
  const body = new URLSearchParams({
    client_id: config.client_id,
    client_secret: config.client_secret,
    code: params.code,
    code_verifier: params.codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: params.redirect_uri,
  }).toString();
  const outcome = await hostFetchPost(
    GOOGLE_OAUTH_TOKEN_URL,
    { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
    10_000,
  );
  if (outcome.kind === "transport_error") {
    return { ok: false, reason_code: "TRANSPORT_ERROR", detail: outcome.reason };
  }
  const parsed = (await outcome.response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!parsed) {
    return { ok: false, reason_code: "MALFORMED_TOKEN_RESPONSE", detail: `HTTP ${outcome.response.status}` };
  }
  if (typeof parsed.error === "string" && parsed.error.length > 0) {
    return {
      ok: false,
      reason_code: String(parsed.error),
      detail: typeof parsed.error_description === "string" ? parsed.error_description : String(parsed.error),
    };
  }
  const { access_token, refresh_token, scope, expires_in, token_type } = parsed;
  if (typeof access_token !== "string" || typeof scope !== "string" || typeof expires_in !== "number") {
    return {
      ok: false,
      reason_code: "MALFORMED_TOKEN_RESPONSE",
      detail: "token response missing required fields",
    };
  }
  return {
    ok: true,
    access_token,
    refresh_token: typeof refresh_token === "string" ? refresh_token : null,
    scope,
    expires_in,
    token_type: typeof token_type === "string" ? token_type : "Bearer",
  };
}

export type UserInfoResult =
  | { kind: "found"; sub: string; email: string | null }
  | { kind: "failed"; reason: string };

/**
 * Resolve GOOGLE_ACCOUNT_ID from provider userinfo (openid/email scopes).
 * Never infer identity from Owner-typed email input.
 */
export async function getUserInfo(accessToken: string): Promise<UserInfoResult> {
  const outcome = await hostFetchGet(
    GOOGLE_USERINFO_URL,
    { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    10_000,
  );
  if (outcome.kind === "transport_error") {
    return { kind: "failed", reason: `TRANSPORT_ERROR: ${outcome.reason}` };
  }
  const parsed = (await outcome.response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!parsed) {
    return { kind: "failed", reason: `MALFORMED_USER_INFO_RESPONSE: HTTP ${outcome.response.status}` };
  }
  if (typeof parsed.error === "string" || (parsed.error && typeof parsed.error === "object")) {
    return { kind: "failed", reason: "USERINFO_ERROR" };
  }
  if (typeof parsed.sub !== "string" || parsed.sub.length === 0) {
    return { kind: "failed", reason: "USER_INFO_MISSING_SUB" };
  }
  return {
    kind: "found",
    sub: parsed.sub,
    email: typeof parsed.email === "string" ? parsed.email : null,
  };
}
