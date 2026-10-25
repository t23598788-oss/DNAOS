// Connect price-offer transport (WAVE 2, 2026-10-25) — the provider tier's ONLY
// way to record what a seller answered.
//
// It knows ONE canonical command and nothing else. It deliberately knows
// nothing about: public.pit_materials (the central price), public.pit_price_requests
// columns, money math, or authority. A seller's message is an OFFER — the
// central price only changes through the Next-side authority (owner/grant).
//
// Fail-closed by contract: a missing app URL/secret, a non-2xx response or a
// writer rejection all come back as { ok: false } — the caller must NOT write
// anything locally and must not claim success to the seller.
export interface ConnectSellerOfferResult {
  ok: boolean;
  error?: string;
  data?: {
    request_id: string;
    status: "answered";
    price: number;
    price_changed: false;
    already_recorded: boolean;
    audit_id: string | null;
  };
}

export async function sendConnectSellerOffer(params: {
  requestId: string;
  price: number;
  sourceMessageId?: string | null;
  replyText?: string | null;
  actor: string;
  idempotencyKey?: string | null;
}): Promise<ConnectSellerOfferResult> {
  const appUrl = Deno.env.get("DNA_OS_APP_URL");
  const secret = Deno.env.get("MATERIAL_PRICE_INTERNAL_SECRET");
  if (!appUrl || !secret) {
    return { ok: false, error: "MATERIAL_PRICE_TRANSPORT_NOT_CONFIGURED" };
  }

  try {
    const res = await fetch(`${appUrl.replace(/\/+$/, "")}/api/internal/connect/material-price`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-material-price-internal-secret": secret },
      body: JSON.stringify({
        command: "price.offer.record",
        actor: params.actor,
        payload: {
          request_id: params.requestId,
          price: params.price,
          source_message_id: params.sourceMessageId ?? null,
          reply_text: params.replyText ?? null,
          idempotency_key: params.idempotencyKey ?? null,
        },
      }),
      signal: AbortSignal.timeout(8000),
    });
    const body = (await res.json().catch(() => ({}))) as ConnectSellerOfferResult;
    if (!res.ok || body.ok === false) {
      return { ok: false, error: body.error ?? `MATERIAL_PRICE_TRANSPORT_HTTP_${res.status}` };
    }
    return { ok: true, data: body.data };
  } catch (err) {
    return { ok: false, error: `MATERIAL_PRICE_TRANSPORT_FAILED:${err instanceof Error ? err.message : String(err)}` };
  }
}
