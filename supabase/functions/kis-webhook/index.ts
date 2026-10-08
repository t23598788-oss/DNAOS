/**
 * KIS webhook — email inbound (Kubota KIS machine events) — BATCH 20
 *
 * Canonical path (ไม่มี direct insert เหลืออยู่ในไฟล์นี้):
 *   KIS email → SendGrid Inbound Parse → this function
 *     → POST {DNA_OS_APP_URL}/api/internal/connect/resource-transaction
 *       (RESOURCE_TRANSACTION_INTERNAL_SECRET header)
 *     → engines/canonical/resource-transaction-write.ts (canonical writer)
 *     → public.resource_transactions + recordCanonicalAudit
 *
 * Auth ชั้นแรก (fail-closed — ไม่มี = 401 เสมอ):
 *   · ?token=KIS_WEBHOOK_TOKEN (timing-safe) — ตั้งใน SendGrid destination URL
 *   · sender ต้องอยู่ใน KIS_SENDER_ALLOWLIST
 * Config authority (fuel-price / machinery_rates) อยู่ใน canonical writer
 * — ไฟล์นี้ไม่คำนวณเงิน ไม่มี fallback ค่า default ใด ๆ อีกต่อไป
 */
import { parseKisEmail, buildKisSourceEventId, buildKisEvidenceRef, verifyKisWebhook, type KisEmailPayload } from "../_shared/kis-inbound-core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    let payload: KisEmailPayload;
    try {
      payload = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "unparseable JSON body" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Layer 1-2: token + sender allowlist — fail-closed 401
    const url = new URL(req.url);
    const verdict = verifyKisWebhook(url, payload, {
      token: Deno.env.get("KIS_WEBHOOK_TOKEN"),
      senderAllowlist: Deno.env.get("KIS_SENDER_ALLOWLIST"),
    });
    if (!verdict.ok) {
      console.warn(`[kis-webhook] rejected: ${verdict.reason}`);
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const facts = parseKisEmail(payload);
    if (!facts.job_id) {
      return new Response(JSON.stringify({ error: "Missing Job ID in email body text" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (facts.duration_hours <= 0) {
      return new Response(JSON.stringify({ status: "skipped", message: "Duration is 0 or event is not a stopping event" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const appUrl = Deno.env.get("DNA_OS_APP_URL");
    const bridgeSecret = Deno.env.get("RESOURCE_TRANSACTION_INTERNAL_SECRET");
    if (!appUrl || !bridgeSecret) {
      // fail-closed — ไม่มี configured bridge = ห้ามเขียนอะไรทั้งสิ้น
      return new Response(JSON.stringify({ error: "bridge not configured" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const receivedAt = new Date().toISOString();
    const body = {
      source: "kis_email",
      source_event_id: buildKisSourceEventId(payload),
      resource_id: null,
      resource_label: facts.machine,
      job_id: facts.job_id,
      started_at: facts.start_time ?? receivedAt,
      duration_hours: facts.duration_hours,
      evidence_ref: buildKisEvidenceRef(payload, facts),
      received_at: receivedAt,
      actor: "supabase:function:kis-webhook",
    };

    let bridgeResponse: Response;
    try {
      bridgeResponse = await fetch(`${appUrl.replace(/\\/+$/, "")}/api/internal/connect/resource-transaction`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-resource-transaction-internal-secret": bridgeSecret },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[kis-webhook] bridge unreachable: ${message}`);
      return new Response(JSON.stringify({ error: `bridge unreachable: ${message}` }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const bridgeBody = await bridgeResponse.json().catch(() => ({} as Record<string, unknown>));
    if (!bridgeResponse.ok || bridgeBody.ok === false) {
      const error = typeof bridgeBody.error === "string" ? bridgeBody.error : `bridge HTTP ${bridgeResponse.status}`;
      console.error(`[kis-webhook] canonical write rejected: ${error}`);
      return new Response(JSON.stringify({ error }), { status: bridgeResponse.status === 200 ? 502 : bridgeResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`[kis-webhook] canonical write ok: ${JSON.stringify(bridgeBody.data ?? {})}`);
    return new Response(JSON.stringify({ status: "success", transaction: bridgeBody.data ?? null }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[kis-webhook] error:", message);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
