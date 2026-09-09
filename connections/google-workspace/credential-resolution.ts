/**
 * Resolve credential://google/workspace/oauth for runtime reads.
 * Keychain may hold a refresh token — exchange via admitted OAuth client when needed.
 * Never log or return secret values outside the in-memory access_token field.
 */

import { findApiCredential } from "../../credentials/registry/api-credential-registry";
import { MacOsKeychainProvider } from "../../credentials/macos-keychain/index";
import { GOOGLE_CREDENTIAL_REF } from "./contract";
import { exchangeRefreshTokenForAccessToken, readGoogleOauthConfig } from "./oauth/google-oauth";
import type { GoogleOauthConfig } from "./oauth/google-oauth";

export type GoogleTokenMaterialKind = "access_token" | "refresh_token" | "unknown";

export type GoogleWorkspaceCredentialResolution =
  | {
      ok: true;
      access_token: string;
      credential_source: string;
      account_identity_non_secret: string | null;
      refreshed: boolean;
      material_kind: GoogleTokenMaterialKind;
    }
  | { ok: false; reason: string; outcome: "AUTH_REQUIRED" | "PROVIDER_ERROR" | "TRANSPORT_ERROR" };

export interface GoogleWorkspaceCredentialResolver {
  resolveAccessToken(): Promise<GoogleWorkspaceCredentialResolution>;
}

function classifyTokenMaterial(secret: string): GoogleTokenMaterialKind {
  if (secret.startsWith("ya29.")) return "access_token";
  if (secret.startsWith("1/") || secret.startsWith("1//")) return "refresh_token";
  return "unknown";
}

function grantedScopesFromEntry(entry: NonNullable<ReturnType<typeof findApiCredential>>): readonly string[] {
  const raw = entry as { scope?: readonly string[]; granted_scopes?: readonly string[] };
  if (Array.isArray(raw.granted_scopes) && raw.granted_scopes.length > 0) return raw.granted_scopes;
  if (Array.isArray(raw.scope)) return raw.scope;
  return [];
}

/** Metadata-only: never touches Keychain. */
export function readGoogleCredentialMetadata(): {
  present: boolean;
  status: string | null;
  account: string | null;
  granted_scopes: readonly string[];
} {
  const entry = findApiCredential(GOOGLE_CREDENTIAL_REF);
  if (!entry) return { present: false, status: null, account: null, granted_scopes: [] };
  return {
    present: true,
    status: entry.status,
    account: entry.account ?? null,
    granted_scopes: grantedScopesFromEntry(entry),
  };
}

export function hasRequiredScopes(granted: readonly string[], required: readonly string[]): boolean {
  if (required.length === 0) return false;
  const set = new Set(granted);
  return required.every((s) => set.has(s));
}

export interface ProductionCredentialResolverDeps {
  keychainProvider?: MacOsKeychainProvider;
  readOauthConfig?: () => GoogleOauthConfig | { missing: string[] };
  refreshToken?: typeof exchangeRefreshTokenForAccessToken;
}

/**
 * Production resolver: registry metadata → Keychain secret → refresh when needed.
 */
export function createProductionCredentialResolver(
  deps: ProductionCredentialResolverDeps = {},
): GoogleWorkspaceCredentialResolver {
  const provider = deps.keychainProvider ?? new MacOsKeychainProvider();
  const readConfig = deps.readOauthConfig ?? readGoogleOauthConfig;
  const refresh = deps.refreshToken ?? exchangeRefreshTokenForAccessToken;

  return {
    async resolveAccessToken(): Promise<GoogleWorkspaceCredentialResolution> {
      const entry = findApiCredential(GOOGLE_CREDENTIAL_REF);
      if (!entry) {
        return { ok: false, reason: `credential_ref "${GOOGLE_CREDENTIAL_REF}" is not registered`, outcome: "AUTH_REQUIRED" };
      }
      if (entry.status !== "ACTIVE") {
        return { ok: false, reason: `credential_ref "${GOOGLE_CREDENTIAL_REF}" status=${entry.status}`, outcome: "AUTH_REQUIRED" };
      }
      if (entry.resolver_kind !== "macos_keychain") {
        return {
          ok: false,
          reason: `unsupported resolver_kind "${entry.resolver_kind}"`,
          outcome: "AUTH_REQUIRED",
        };
      }

      const resolution = await provider.resolve({
        service: entry.resolver_service,
        account: entry.resolver_account,
        kind: "oauth_token",
      });
      if (!resolution.ok) {
        return {
          ok: false,
          reason: `Keychain resolution failed (${resolution.code})`,
          outcome: "AUTH_REQUIRED",
        };
      }

      const secret = resolution.secret;
      const kind = classifyTokenMaterial(secret);
      const credential_source = resolution.credential_source;
      const account = entry.account ?? null;

      if (kind === "access_token") {
        return {
          ok: true,
          access_token: secret,
          credential_source,
          account_identity_non_secret: account,
          refreshed: false,
          material_kind: kind,
        };
      }

      // refresh_token or unknown material — attempt refresh via admitted OAuth client
      const config = readConfig();
      if ("missing" in config) {
        return {
          ok: false,
          reason: `OAuth client configuration required to refresh token (missing: ${config.missing.join(",")})`,
          outcome: "AUTH_REQUIRED",
        };
      }

      const exchanged = await refresh(config, secret);
      if (!exchanged.ok) {
        return {
          ok: false,
          reason: `refresh_token exchange failed: ${exchanged.reason_code}`,
          outcome: exchanged.reason_code === "TRANSPORT_ERROR" ? "TRANSPORT_ERROR" : "PROVIDER_ERROR",
        };
      }

      return {
        ok: true,
        access_token: exchanged.access_token,
        credential_source,
        account_identity_non_secret: account,
        refreshed: true,
        material_kind: kind === "unknown" ? "refresh_token" : kind,
      };
    },
  };
}
