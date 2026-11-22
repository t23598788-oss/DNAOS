/** Register DNA OS's Kod Chat callback URL on a connected/enabled bot. */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getConnectorById } from "@/gateway/connectors";
import { registerKobChatWebhook } from "@/engines/integration-gateway/adapters/kodchat";

type Params = { params: Promise<{ id: string }> };
const API_BASE = "https://kobchat.com/api/bot/v1";

export async function POST(_request: Request, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const connector = await getConnectorById(id);
  if (!connector) return NextResponse.json({ ok: false, error: "connector_not_found" }, { status: 404 });
  if (connector.config?.provider !== "kodchat" || connector.auth_type !== "api_key") {
    return NextResponse.json({ ok: false, error: "not_a_kodchat_connector" }, { status: 400 });
  }
  if (!connector.enabled || connector.status !== "connected") {
    return NextResponse.json({ ok: false, error: "connector_must_pass_test_and_be_enabled" }, { status: 409 });
  }

  const token = typeof connector.secret?.api_key === "string" ? connector.secret.api_key : "";
  const webhookSecret = typeof connector.secret?.webhook_secret === "string" ? connector.secret.webhook_secret : "";
  if (!token || !webhookSecret) {
    return NextResponse.json({ ok: false, error: "missing_api_key_or_webhook_secret" }, { status: 409 });
  }
  if (!/^[\x21-\x7E]{16,200}$/.test(webhookSecret)) {
    return NextResponse.json({ ok: false, error: "webhook_secret_must_be_16_to_200_ascii_chars_without_spaces" }, { status: 400 });
  }

  const configuredBase = String(connector.config?.base_url ?? API_BASE).replace(/\/+$/, "");
  if (configuredBase !== API_BASE) {
    return NextResponse.json({ ok: false, error: "unsupported_kodchat_api_base_url" }, { status: 400 });
  }
  const appOrigin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  if (!appOrigin) return NextResponse.json({ ok: false, error: "app_public_url_not_configured" }, { status: 503 });

  let callbackUrl: URL;
  try {
    callbackUrl = new URL("/api/gateway/observe/kodchat", appOrigin);
  } catch {
    return NextResponse.json({ ok: false, error: "app_public_url_invalid" }, { status: 503 });
  }
  if (callbackUrl.protocol !== "https:") {
    return NextResponse.json({ ok: false, error: "kodchat_webhook_requires_https_callback" }, { status: 503 });
  }

  const result = await registerKobChatWebhook(callbackUrl.toString(), { apiKey: token, webhookSecret }, { apiBaseUrl: configuredBase });
  if (result.status !== "success") {
    const httpStatus = result.error_code === "AUTH_FAILED" ? 502 : result.error_code === "INVALID_PAYLOAD" ? 400 : 502;
    return NextResponse.json({ ok: false, error: result.error_code, provider_status: undefined }, { status: httpStatus });
  }
  return NextResponse.json({ ok: true, callback_url: callbackUrl.toString(), provider_status: result.data?.provider_status });
}
