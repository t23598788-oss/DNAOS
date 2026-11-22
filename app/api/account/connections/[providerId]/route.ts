import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireAuth } from "@/core/auth/requireAuth";
import { supabaseAdmin } from "@/services/supabase/queries";
import { vaultDeleteSecret, vaultWriteSecret } from "@/services/ai-connection/vault";
import { isUserOAuthProvider } from "@/services/connectors/userOAuthPolicy";

type Params = { params: Promise<{ providerId: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };
const MAX_BODY_BYTES = 12 * 1024;

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    return parsed.host === host && parsed.protocol === `${proto}:`;
  } catch {
    return false;
  }
}

const API_PROVIDERS: Record<string, { label: string; endpoint: string; headers: (key: string) => HeadersInit }> = {
  "openai-api": {
    label: "OpenAI API",
    endpoint: "https://api.openai.com/v1/models",
    headers: (key) => ({ Authorization: `Bearer ${key}`, Accept: "application/json" }),
  },
  "anthropic-api": {
    label: "Anthropic API",
    endpoint: "https://api.anthropic.com/v1/models?limit=1",
    headers: (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01", Accept: "application/json" }),
  },
  "google-gemini-api": {
    label: "Google Gemini API",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
    headers: (key) => ({ "x-goog-api-key": key, Accept: "application/json" }),
  },
};

/** Save a user's own AI-provider API key after a credential check. */
export async function PUT(req: NextRequest, { params }: Params) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, code: "ORIGIN_REJECTED" }, { status: 403, headers: NO_STORE });

  const { providerId } = await params;
  const provider = API_PROVIDERS[providerId];
  if (!provider) return NextResponse.json({ ok: false, code: "PROVIDER_NOT_SUPPORTED" }, { status: 404, headers: NO_STORE });

  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) return NextResponse.json({ ok: false, code: "BODY_TOO_LARGE" }, { status: 413, headers: NO_STORE });
  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return NextResponse.json({ ok: false, code: "BODY_TOO_LARGE" }, { status: 413, headers: NO_STORE });
  const body = (() => { try { return JSON.parse(raw) as { api_key?: unknown }; } catch { return null; } })();
  const apiKey = typeof body?.api_key === "string" ? body.api_key.trim() : "";
  if (apiKey.length < 8 || apiKey.length > 8192 || /[\r\n\u0000]/.test(apiKey)) {
    return NextResponse.json({ ok: false, code: "INVALID_CREDENTIAL_FORMAT" }, { status: 400, headers: NO_STORE });
  }

  let providerResponse: Response;
  try {
    providerResponse = await fetch(provider.endpoint, {
      method: "GET",
      headers: provider.headers(apiKey),
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    return NextResponse.json({ ok: false, code: "PROVIDER_UNREACHABLE" }, { status: 502, headers: NO_STORE });
  }
  if (!providerResponse.ok) {
    return NextResponse.json({ ok: false, code: "PROVIDER_CREDENTIAL_REJECTED", provider_status: providerResponse.status }, { status: 422, headers: NO_STORE });
  }

  const db = supabaseAdmin();
  const existingResult = await db
    .from("user_provider_connections")
    .select("id, credential_ref")
    .eq("owner_user_id", auth.id)
    .eq("provider_id", providerId)
    .eq("connection_method", "api_key")
    .is("external_account_id", null)
    .maybeSingle();
  if (existingResult.error) {
    const missing = existingResult.error.code === "PGRST205" || /Could not find the table|schema cache|does not exist/i.test(existingResult.error.message);
    return NextResponse.json({ ok: false, code: missing ? "USER_CONNECTIONS_NOT_MIGRATED" : "CONNECTION_LOOKUP_FAILED" }, { status: missing ? 503 : 500, headers: NO_STORE });
  }

  const oldSecretId = existingResult.data?.credential_ref ?? null;
  const newSecretId = await vaultWriteSecret(apiKey, `user-provider-${providerId}-${randomUUID()}`, `User-owned ${provider.label} API credential`)
    .catch(() => null);
  if (!newSecretId) return NextResponse.json({ ok: false, code: "CREDENTIAL_STORE_UNAVAILABLE" }, { status: 503, headers: NO_STORE });

  const now = new Date().toISOString();
  const values = {
    owner_user_id: auth.id,
    provider_id: providerId,
    connection_method: "api_key",
    external_account_id: null,
    account_label: provider.label,
    // API-key providers do not expose a reliable effective-scope list here;
    // keep this empty instead of pretending that the validation endpoint is a granted scope.
    granted_scopes: [],
    credential_ref: newSecretId,
    status: "connected",
    last_verified_at: now,
    last_error_code: null,
    updated_at: now,
  };

  const saved = existingResult.data
    ? await db.from("user_provider_connections").update(values).eq("id", existingResult.data.id).eq("owner_user_id", auth.id)
    : await db.from("user_provider_connections").insert(values);
  if (saved.error) {
    await vaultDeleteSecret(newSecretId).catch(() => {});
    return NextResponse.json({ ok: false, code: "CONNECTION_SAVE_FAILED" }, { status: 500, headers: NO_STORE });
  }

  if (oldSecretId) await vaultDeleteSecret(oldSecretId).catch(() => {});
  return NextResponse.json({ ok: true, provider_id: providerId, status: "connected", verified_at: now }, { headers: NO_STORE });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, code: "ORIGIN_REJECTED" }, { status: 403, headers: NO_STORE });

  const { providerId } = await params;
  const connectionId = req.nextUrl.searchParams.get("connection_id");
  if (connectionId && isUserOAuthProvider(providerId)) {
    const db = supabaseAdmin();
    const current = await db.from("user_provider_connections")
      .select("id, credential_ref")
      .eq("id", connectionId)
      .eq("owner_user_id", auth.id)
      .eq("provider_id", providerId)
      .eq("connection_method", "oauth")
      .maybeSingle();
    if (current.error) return NextResponse.json({ ok: false, code: "CONNECTION_LOOKUP_FAILED" }, { status: 500, headers: NO_STORE });
    if (!current.data) return NextResponse.json({ ok: true, status: "revoked" }, { headers: NO_STORE });
    const { error } = await db.from("user_provider_connections")
      .update({ credential_ref: null, granted_scopes: [], status: "revoked", oauth_state_hash: null, oauth_state_expires_at: null, updated_at: new Date().toISOString() })
      .eq("id", current.data.id)
      .eq("owner_user_id", auth.id);
    if (error) return NextResponse.json({ ok: false, code: "CONNECTION_REVOKE_FAILED" }, { status: 500, headers: NO_STORE });
    if (current.data.credential_ref) await vaultDeleteSecret(current.data.credential_ref).catch(() => {});
    return NextResponse.json({ ok: true, provider_id: providerId, status: "revoked" }, { headers: NO_STORE });
  }
  if (!API_PROVIDERS[providerId]) return NextResponse.json({ ok: false, code: "PROVIDER_NOT_SUPPORTED" }, { status: 404, headers: NO_STORE });

  const db = supabaseAdmin();
  const current = await db.from("user_provider_connections")
    .select("id, credential_ref")
    .eq("owner_user_id", auth.id)
    .eq("provider_id", providerId)
    .eq("connection_method", "api_key")
    .is("external_account_id", null)
    .maybeSingle();
  if (current.error) {
    const missing = current.error.code === "PGRST205" || /Could not find the table|schema cache|does not exist/i.test(current.error.message);
    return NextResponse.json({ ok: false, code: missing ? "USER_CONNECTIONS_NOT_MIGRATED" : "CONNECTION_LOOKUP_FAILED" }, { status: missing ? 503 : 500, headers: NO_STORE });
  }
  if (!current.data) return NextResponse.json({ ok: true, status: "revoked" }, { headers: NO_STORE });

  const { error } = await db.from("user_provider_connections")
    .update({ credential_ref: null, granted_scopes: [], status: "revoked", updated_at: new Date().toISOString() })
    .eq("id", current.data.id)
    .eq("owner_user_id", auth.id);
  if (error) return NextResponse.json({ ok: false, code: "CONNECTION_REVOKE_FAILED" }, { status: 500, headers: NO_STORE });

  if (current.data.credential_ref) await vaultDeleteSecret(current.data.credential_ref).catch(() => {});
  return NextResponse.json({ ok: true, provider_id: providerId, status: "revoked" }, { headers: NO_STORE });
}
