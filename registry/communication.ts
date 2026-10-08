/**
 * DNA OS Communication Gateway
 *
 * Rule: Single outbound gateway for all LINE Messaging API calls.
 * This is the ONE place that calls the LINE API. All other modules/services
 * must route through this gateway.
 *
 * Prevents duplicate implementations and ensures consistent error handling
 * and logging for all outbound messages.
 *
 * Credential resolution (canonical path, registry/connector-lifecycle.json —
 * no exceptions): the "line" connector is resolved through the Connector
 * Lifecycle Run gate — core/connector-loader.ts requireConnector(db, "line",
 * caller) — and the token is read ONLY from the connector record's secret
 * (channel_access_token / token / api_key). Callers pass their real Supabase
 * client as the first parameter (Phase 2.3A convention: core functions take
 * the client; callers already allowed to import services/ supply
 * supabaseAdmin() themselves; allowed_imports.registry = ["core"] keeps this
 * file's import inside the dependency graph).
 *
 * There is NO env fallback by design: if the connector is missing, untested
 * or not enabled, the send fails closed with the loader's own owner-facing
 * message (Register/Test/Enable at /admin/connectors) — a send is never
 * silently routed around the lifecycle.
 */
import { requireConnector } from "@/core/connector-loader";
import type { SupabaseClient } from "@supabase/supabase-js";

const LINE_MESSAGING_API = 'https://api.line.me/v2/bot/message/push';

export interface SendMessageResponse {
  success: boolean;
  messageId?: string;
  error?: string;
}

export async function sendLineMessage(
  db: SupabaseClient,
  to: string,
  messages: any[]
): Promise<SendMessageResponse> {
  let accessToken = "";
  try {
    const connector = await requireConnector(db, "line", "registry/communication.sendLineMessage");
    accessToken =
      (connector.secret.channel_access_token as string) ??
      (connector.secret.token as string) ??
      (connector.secret.api_key as string) ??
      "";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[communication] LINE connector Run gate rejected the send:', msg);
    return { success: false, error: `LINE connector ยังไม่พร้อม (Run gate ปฏิเสธ): ${msg}` };
  }

  if (!accessToken) {
    return {
      success: false,
      error: 'connector "line" ไม่มี channel_access_token ใน secret — แก้ที่ /admin/connectors',
    };
  }

  try {
    const response = await fetch(LINE_MESSAGING_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ to, messages }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`Failed to send LINE message: ${response.status} ${response.statusText}`, errorBody);
      // Owner, 2026-09-19: the status code is part of the real failure
      // contract — downstream deterministic classification (businessFailureBridge)
      // needs it to distinguish auth (401/403) from availability (5xx) without AI.
      return { success: false, error: `LINE API Error ${response.status}: ${errorBody}` };
    }

    // Delivery evidence (BATCH 38): the push API answers with {messageId} —
    // capture it so every caller that writes a direction "out" line_events row
    // can record the real provider message id in line_message_id. json parse
    // is best-effort: a success without a body stays a plain success.
    const body = (await response.json().catch(() => ({}))) as { messageId?: unknown };
    return { success: true, messageId: typeof body.messageId === "string" ? body.messageId : undefined };
  } catch (error) {
    console.error('Error sending LINE message:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}
