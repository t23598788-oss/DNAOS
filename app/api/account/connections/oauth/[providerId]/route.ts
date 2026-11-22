import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { loadConnectors, requireConnector } from "@/core/connector-loader";
import { createConnectorOAuthState } from "@/core/auth/connector-oauth-state";
import { supabaseAdmin } from "@/services/supabase/queries";
import { assertUserOAuthUrl, isUserOAuthProvider, oauthProviderIdentity, userOAuthCookieName } from "@/services/connectors/userOAuthPolicy";

type Params = { params: Promise<{ providerId: string }> };
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };
const OAUTH_PROVIDER_ALIAS: Record<string, string> = { "google-gemini-api": "google", gmail: "google", "google-maps": "google" };

/** One-click entry: user consent happens at the provider; state is owner-bound and one-use. */
export async function GET(req: NextRequest, { params }: Params) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { providerId } = await params;
  const expectedProvider = OAUTH_PROVIDER_ALIAS[providerId] ?? providerId;
  if (!isUserOAuthProvider(expectedProvider)) {
    return NextResponse.json({ ok: false, code: "USER_OAUTH_PROVIDER_UNSUPPORTED" }, { status: 404, headers: NO_STORE });
  }

  const db = supabaseAdmin();
  let connector;
  try {
    const all = await loadConnectors(db);
    const candidates = all.filter((item) => item.auth_type === "oauth" && oauthProviderIdentity(item) === expectedProvider);
    if (candidates.length !== 1) {
      return NextResponse.json({ ok: false, code: candidates.length > 1 ? "OAUTH_CONNECTOR_AMBIGUOUS" : "OAUTH_CONNECTOR_NOT_REGISTERED" }, { status: 409, headers: NO_STORE });
    }
    connector = await requireConnector(db, candidates[0].slug, "account.connections.oauth");
  } catch {
    return NextResponse.json({ ok: false, code: "OAUTH_CONNECTOR_NOT_ENABLED" }, { status: 409, headers: NO_STORE });
  }

  const config = connector.config as Record<string, unknown>;
  const secret = connector.secret as Record<string, unknown>;
  let authorizeUrl: URL;
  try {
    authorizeUrl = assertUserOAuthUrl(expectedProvider, config.authorize_url);
    assertUserOAuthUrl(expectedProvider, config.token_url);
    assertUserOAuthUrl(expectedProvider, config.test_url);
  } catch (error) {
    return NextResponse.json({ ok: false, code: error instanceof Error ? error.message : "OAUTH_CONFIG_INVALID" }, { status: 409, headers: NO_STORE });
  }

  const clientId = typeof config.client_id === "string" ? config.client_id : "";
  const clientSecret = typeof secret.client_secret === "string" ? secret.client_secret : "";
  const redirectUri = typeof config.redirect_uri === "string" ? config.redirect_uri : "";
  const scope = typeof config.scope === "string" ? config.scope : "";
  let callback: URL;
  try { callback = new URL(redirectUri); } catch { callback = new URL("https://invalid.local"); }
  const expectedPath = `/api/connectors/oauth/callback/${connector.slug}`;
  if (!clientId || !clientSecret || callback.origin !== req.nextUrl.origin || callback.pathname !== expectedPath) {
    return NextResponse.json({ ok: false, code: "OAUTH_CLIENT_CONFIG_INCOMPLETE" }, { status: 409, headers: NO_STORE });
  }

  const { state, cookieValue } = createConnectorOAuthState(auth.id);
  const stateHash = createHash("sha256").update(state).digest("hex");
  const now = new Date();
  const cleanup = await db.from("user_provider_connections")
    .delete()
    .eq("owner_user_id", auth.id)
    .eq("provider_id", providerId)
    .eq("connection_method", "oauth")
    .eq("status", "pending");
  if (cleanup.error) return NextResponse.json({ ok: false, code: "USER_CONNECTIONS_NOT_MIGRATED" }, { status: 503, headers: NO_STORE });

  const registered = await db.from("user_provider_connections").insert({
    owner_user_id: auth.id,
    provider_id: providerId,
    connection_method: "oauth",
    status: "pending",
    oauth_state_hash: stateHash,
    oauth_state_expires_at: new Date(now.getTime() + 10 * 60_000).toISOString(),
  }).select("id").single();
  if (registered.error) return NextResponse.json({ ok: false, code: "USER_CONNECTION_REGISTER_FAILED" }, { status: 503, headers: NO_STORE });

  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("state", state);
  if (scope) authorizeUrl.searchParams.set("scope", scope);
  if (authorizeUrl.hostname === "accounts.google.com") {
    authorizeUrl.searchParams.set("access_type", "offline");
    authorizeUrl.searchParams.set("prompt", "consent");
  }

  const response = NextResponse.redirect(authorizeUrl.toString());
  response.headers.set("Cache-Control", NO_STORE["Cache-Control"]);
  response.cookies.set(userOAuthCookieName(connector.id), cookieValue, {
    httpOnly: true,
    secure: req.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: expectedPath,
    maxAge: 10 * 60,
  });
  return response;
}
