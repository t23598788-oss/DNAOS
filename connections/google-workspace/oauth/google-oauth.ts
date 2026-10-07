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

import { execFileSync } from "node:child_process";
import {
  GOOGLE_OAUTH_AUTHORIZE_URL,
  GOOGLE_OAUTH_CLIENT_SECRET_REF,
  GOOGLE_OAUTH_TOKEN_URL,
  GOOGLE_USERINFO_URL,
} from "../contract";
import { getGoogleOauthClientConfigurationView } from "./client-admission";
import { findLatestClientConfig } from "./client-config-store";
import { base64UrlEncode, hostFetchGet, hostFetchPost, readEnvVar, sha256Raw } from "./host-runtime";
import { findApiCredential } from "../../../credentials/registry/api-credential-registry";

export const GOOGLE_OAUTH_ENDPOINTS = {
  AUTHORIZE_URL: GOOGLE_OAUTH_AUTHORIZE_URL,
  TOKEN_URL: GOOGLE_OAUTH_TOKEN_URL,
  USERINFO_URL: GOOGLE_USERINFO_URL,
} as const;

export interface GoogleOauthConfig {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
  environment?: "TESTING" | "PRODUCTION";
}

export interface GoogleOauthConfigResolveDeps {
  findLatestClientConfig: typeof findLatestClientConfig;
  findApiCredential: typeof findApiCredential;
  /** Returns client secret once for exchange; never log. Env fallback for hermetic/dev. */
  resolveClientSecret: () => string | undefined;
  readEnvVar: typeof readEnvVar;
}

const defaultResolveDeps: GoogleOauthConfigResolveDeps = {
  findLatestClientConfig,
  findApiCredential,
  resolveClientSecret: () => {
    const fromEnv = readEnvVar("GOOGLE_WORKSPACE_OAUTH_CLIENT_SECRET");
    if (fromEnv) return fromEnv;
    const entry = findApiCredential(GOOGLE_OAUTH_CLIENT_SECRET_REF);
    if (!entry || entry.status !== "ACTIVE") return undefined;
    // Resolve through macOS Keychain only — never log the value.
    try {
      const secret = String(
        execFileSync(
          "/usr/bin/security",
          ["find-generic-password", "-s", entry.resolver_service, "-a", entry.resolver_account, "-w"],
          { encoding: "utf8" },
        ),
      ).replace(/\n$/, "");
      return secret.length > 0 ? secret : undefined;
    } catch {
      return undefined;
    }
  },
  readEnvVar,
};

/**
 * Resolve admitted OAuth client for token exchange / authorize URL.
 * Prefers Owner-admitted public config store; secret from approved secret authority
 * (env mirror or injected Keychain resolver). Source alone ⇒ CONFIGURATION_REQUIRED.
 *
 * Never log/return client_secret from this module's public status helpers.
 */
export function readGoogleOauthConfig(
  deps: GoogleOauthConfigResolveDeps = defaultResolveDeps,
): GoogleOauthConfig | { missing: string[] } {
  const admitted = deps.findLatestClientConfig();
  const envClientId = deps.readEnvVar("GOOGLE_WORKSPACE_OAUTH_CLIENT_ID");
  const envRedirect = deps.readEnvVar("GOOGLE_WORKSPACE_OAUTH_REDIRECT_URI");
  const client_id = admitted?.oauth_client_id ?? envClientId;
  const redirect_uri = admitted?.redirect_uri ?? envRedirect;
  const client_secret = deps.resolveClientSecret();

  const missing: string[] = [];
  if (!client_id) missing.push("GOOGLE_OAUTH_CLIENT_ID");
  if (!client_secret) missing.push("GOOGLE_OAUTH_CLIENT_SECRET");
  if (!redirect_uri) missing.push("GOOGLE_REDIRECT_URI");

  // Secret must also be represented by canonical Keychain ref when admitted via Owner path,
  // OR be present via env mirror for hermetic/dev — either satisfies resolution.
  if (admitted && !deps.findApiCredential(GOOGLE_OAUTH_CLIENT_SECRET_REF) && !deps.readEnvVar("GOOGLE_WORKSPACE_OAUTH_CLIENT_SECRET")) {
    if (!missing.includes("GOOGLE_OAUTH_CLIENT_SECRET")) missing.push("GOOGLE_OAUTH_CLIENT_SECRET");
  }

  if (missing.length > 0) return { missing };
  return {
    client_id: client_id!,
    client_secret: client_secret!,
    redirect_uri: redirect_uri!,
    environment: admitted?.environment,
  };
}

/** Public status only — never includes resolved secret. */
export function readGoogleOauthConfigStatus(): ReturnType<typeof getGoogleOauthClientConfigurationView> {
  return getGoogleOauthClientConfigurationView();
}

/** Google PKCE S256: SHA-256 bytes → base64url without padding. */
export function deriveCodeChallenge(codeVerifier: string): string {
  return base64UrlEncode(sha256Raw(codeVerifier));
}

export function buildAuthorizeUrl(
  config: GoogleOauthConfig,
  params: {
    scope: readonly string[];
    state: string;
    codeVerifier: string;
    /** Optional Google login_hint — transaction input only, never a global constant. */
    login_hint?: string;
  },
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
  const hint = typeof params.login_hint === "string" ? params.login_hint.trim() : "";
  if (hint.length > 0) query.set("login_hint", hint);
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

/**
 * Exchange a stored refresh token for a short-lived access token.
 * Uses the admitted Google OAuth client. Never logs token material.
 */
export async function exchangeRefreshTokenForAccessToken(
  config: GoogleOauthConfig,
  refreshToken: string,
): Promise<TokenExchangeResult> {
  const body = new URLSearchParams({
    client_id: config.client_id,
    client_secret: config.client_secret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
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
  if (typeof access_token !== "string" || typeof expires_in !== "number") {
    return {
      ok: false,
      reason_code: "MALFORMED_TOKEN_RESPONSE",
      detail: "refresh response missing required fields",
    };
  }
  return {
    ok: true,
    access_token,
    refresh_token: typeof refresh_token === "string" ? refresh_token : null,
    scope: typeof scope === "string" ? scope : "",
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
