import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { AuthedUser } from "@/core/auth/session";
import { requireConnector, type ConnectorRecord } from "@/core/connector-loader";
import { supabaseAdmin } from "@/services/supabase/queries";
import { vaultDeleteSecret, vaultReadSecret, vaultWriteSecret } from "@/services/ai-connection/vault";
import { assertUserOAuthUrl, oauthProviderIdentity, userOAuthCookieName } from "@/services/connectors/userOAuthPolicy";
import { verifyConnectorOAuthState } from "@/core/auth/connector-oauth-state";

type TokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  scope?: unknown;
};

export async function completeUserOAuthCallback(input: {
  req: NextRequest;
  user: AuthedUser;
  connector: ConnectorRecord;
  state: string | null;
  code: string | null;
  oauthError: string | null;
  cookieValue: string;
}): Promise<NextResponse> {
  const { req, user, connector, state, code, oauthError, cookieValue } = input;
  const callbackPath = `/api/connectors/oauth/callback/${connector.slug}`;
  const cookieName = userOAuthCookieName(connector.id);
  const clearCookie = (response: NextResponse) => {
    response.headers.set("Cache-Control", "no-store, max-age=0");
    response.cookies.set(cookieName, "", { httpOnly: true, secure: req.nextUrl.protocol === "https:", sameSite: "lax", path: callbackPath, maxAge: 0 });
    return response;
  };
  const redirectResult = (providerId: string, result: string) => clearCookie(NextResponse.redirect(new URL(`/account/connections?${result}=${encodeURIComponent(providerId)}`, req.url)));
  const db = supabaseAdmin();

  if (!verifyConnectorOAuthState({ userId: user.id, state, cookieValue })) {
    return clearCookie(NextResponse.json({ ok: false, code: "OAUTH_STATE_REJECTED" }, { status: 400 }));
  }
  const stateHash = createHash("sha256").update(state!).digest("hex");
  const pendingResult = await db.from("user_provider_connections")
    .select("id, provider_id, oauth_state_expires_at")
    .eq("owner_user_id", user.id)
    .eq("connection_method", "oauth")
    .eq("status", "pending")
    .eq("oauth_state_hash", stateHash)
    .maybeSingle();
  if (pendingResult.error || !pendingResult.data || !pendingResult.data.oauth_state_expires_at || new Date(pendingResult.data.oauth_state_expires_at).getTime() < Date.now()) {
    return clearCookie(NextResponse.json({ ok: false, code: "OAUTH_STATE_EXPIRED" }, { status: 400 }));
  }
  const pending = pendingResult.data;
  const providerId = String(pending.provider_id);
  const failPending = async (codeValue: string) => {
    await db.from("user_provider_connections").update({ status: "error", last_error_code: codeValue, oauth_state_hash: null, oauth_state_expires_at: null, updated_at: new Date().toISOString() }).eq("id", pending.id).eq("owner_user_id", user.id);
    return redirectResult(providerId, "error");
  };

  if (oauthError) return failPending("OAUTH_USER_DENIED");
  if (!code) return failPending("OAUTH_CODE_MISSING");

  try {
    // The shared provider registration must itself be registered, tested and enabled.
    await requireConnector(db, connector.slug, "account.connections.oauth.callback");
    const config = connector.config as Record<string, unknown>;
    const secret = connector.secret as Record<string, unknown>;
    const provider = oauthProviderIdentity(connector);
    if (!provider) return failPending("OAUTH_PROVIDER_UNSUPPORTED");
    const tokenUrl = assertUserOAuthUrl(provider, config.token_url);
    const profileUrl = assertUserOAuthUrl(provider, config.test_url);
    const redirectUri = typeof config.redirect_uri === "string" ? config.redirect_uri : "";
    const clientId = typeof config.client_id === "string" ? config.client_id : "";
    const clientSecret = typeof secret.client_secret === "string" ? secret.client_secret : "";
    if (!redirectUri || !clientId || !clientSecret || new URL(redirectUri).origin !== req.nextUrl.origin || new URL(redirectUri).pathname !== callbackPath) {
      return failPending("OAUTH_CLIENT_CONFIG_INCOMPLETE");
    }

    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret }),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!tokenResponse.ok) return failPending(`OAUTH_TOKEN_HTTP_${tokenResponse.status}`);
    const token = await tokenResponse.json() as TokenResponse;
    if (typeof token.access_token !== "string" || !token.access_token) return failPending("OAUTH_ACCESS_TOKEN_MISSING");

    // OAuth consent plus a read-only account identity request verifies the human-granted connection.
    const profileResponse = await fetch(profileUrl, {
      headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/json", "User-Agent": "DNA-OS" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!profileResponse.ok) return failPending(`OAUTH_IDENTITY_HTTP_${profileResponse.status}`);
    const profile = await profileResponse.json() as Record<string, unknown>;
    const externalIdValue = profile.id ?? profile.sub;
    if ((typeof externalIdValue !== "string" && typeof externalIdValue !== "number") || String(externalIdValue).length < 1 || String(externalIdValue).length > 240) {
      return failPending("OAUTH_IDENTITY_ID_MISSING");
    }
    const externalAccountId = String(externalIdValue);
    const accountLabel = String(profile.login ?? profile.name ?? profile.email ?? externalAccountId).slice(0, 240);
    const actualScopes = typeof token.scope === "string" ? token.scope : profileResponse.headers.get("x-oauth-scopes") ?? "";
    const grantedScopes = [...new Set(actualScopes.split(/[ ,]+/).map((scope) => scope.trim()).filter(Boolean))];

    const existingResult = await db.from("user_provider_connections")
      .select("id, credential_ref")
      .eq("owner_user_id", user.id)
      .eq("provider_id", providerId)
      .eq("connection_method", "oauth")
      .eq("external_account_id", externalAccountId)
      .maybeSingle();
    if (existingResult.error) return failPending("OAUTH_CONNECTION_LOOKUP_FAILED");

    let previousRefreshToken: string | undefined;
    if (existingResult.data?.credential_ref) {
      const previous = await vaultReadSecret(existingResult.data.credential_ref).catch(() => null);
      if (previous) {
        try {
          const decoded = JSON.parse(previous) as { refresh_token?: unknown };
          if (typeof decoded.refresh_token === "string") previousRefreshToken = decoded.refresh_token;
        } catch { /* old secret format: replace without carrying unknown data */ }
      }
    }
    const expiresIn = typeof token.expires_in === "number" && Number.isFinite(token.expires_in) && token.expires_in > 0 ? token.expires_in : null;
    const secretValue = JSON.stringify({
      access_token: token.access_token,
      refresh_token: typeof token.refresh_token === "string" ? token.refresh_token : previousRefreshToken ?? null,
      token_type: typeof token.token_type === "string" ? token.token_type : "Bearer",
      expires_at: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
    });
    const secretId = await vaultWriteSecret(secretValue, `user-oauth-${providerId}-${user.id}-${externalAccountId}`, `User-owned ${providerId} OAuth grant`).catch(() => null);
    if (!secretId) return failPending("OAUTH_CREDENTIAL_STORE_UNAVAILABLE");

    const now = new Date().toISOString();
    const values = {
      owner_user_id: user.id,
      provider_id: providerId,
      connection_method: "oauth",
      external_account_id: externalAccountId,
      account_label: accountLabel,
      granted_scopes: grantedScopes,
      credential_ref: secretId,
      status: "connected",
      last_verified_at: now,
      last_error_code: null,
      oauth_state_hash: null,
      oauth_state_expires_at: null,
      updated_at: now,
    };
    const saved = existingResult.data
      ? await db.from("user_provider_connections").update(values).eq("id", existingResult.data.id).eq("owner_user_id", user.id)
      : await db.from("user_provider_connections").update(values).eq("id", pending.id).eq("owner_user_id", user.id).eq("oauth_state_hash", stateHash);
    if (saved.error) {
      await vaultDeleteSecret(secretId).catch(() => {});
      return failPending("OAUTH_CONNECTION_SAVE_FAILED");
    }
    if (existingResult.data) {
      await db.from("user_provider_connections").delete().eq("id", pending.id).eq("owner_user_id", user.id);
      if (existingResult.data.credential_ref) await vaultDeleteSecret(existingResult.data.credential_ref).catch(() => {});
    }
    return redirectResult(providerId, "connected");
  } catch {
    return failPending("OAUTH_CALLBACK_FAILED");
  }
}
