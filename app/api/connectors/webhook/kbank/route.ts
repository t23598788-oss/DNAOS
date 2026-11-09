// KBank Webhook Receiver Skeleton.
// KBank sandbox integration (pending activation).
//
// KBank status (from KBank portal screenshot, 26/10/2026):
//   - Applied: 26/10/2026
//   - Status: "Waiting for KBank officer to review and contact"
//   - Expected contact: by 9 Nov 2026
//   - Application number: 1792988917
//
// Security (owner audit 2026-10-26, findings C1/C2/C4/C6/C7): this route uses
// the EXACT gate pattern as app/api/connectors/webhook/[slug]/route.ts:
//   - resolve the connector via getConnectedConnector (status=connected AND
//     enabled=true — a disabled or errored connector stops ingesting)
//   - evaluateWebhookRequest() via _lib/webhookGate.ts — fail-closed:
//       404 connector_not_found / connector_not_webhook / connector_not_enabled
//       413 body_too_large
//       503 signature_not_configured
//       401 signature_missing / signature_invalid
//   - only a verified body is parsed and a response is returned
//
// When KBank's webhook secret is provisioned, the verified body is normalized
// by engines/integration-gateway/adapters/kbank.ts and published to the
// Integration Gateway's Observe Channel via the event bus (engines/integration-gateway/event-bus/bus.ts).

import { NextRequest, NextResponse } from "next/server";
import { getConnectedConnector } from "@/core/connector-loader";
import { supabaseAdmin } from "@/services/supabase/queries";
import {
  MAX_WEBHOOK_BODY_BYTES,
  evaluateWebhookRequest,
} from "../[slug]/_lib/webhookGate";
import { normalizeKBankWebhook } from "@/engines/integration-gateway/adapters/kbank";
import { publish } from "@/engines/integration-gateway/event-bus/bus";

type Params = { params: Promise<{ slug: string }> };

const NOT_FOUND = NextResponse.json({ error: "ไม่พบ Webhook Connector นี้" }, { status: 404 });

export async function POST(req: NextRequest, { params }: Params) {
  const { slug } = await params;

  // Only a connector that passed Connect → Register → Test → Enable may ingest.
  const connector = await getConnectedConnector(supabaseAdmin(), slug);
  if (!connector) return NOT_FOUND;

  // Cheap pre-read guard: refuse an oversized body before buffering it.
  const declaredLength = req.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json({ error: "เนื้อหาคำขอใหญ่เกินกำหนด" }, { status: 413 });
  }

  const rawBody = await req.text();

  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const decision = evaluateWebhookRequest({
    connector,
    rawBody,
    headers,
  });

  // Fail-closed: gate rejected → return the gate's status/reason, never 200.
  if (!decision.ok) {
    return NextResponse.json(
      { error: decision.reason, detail: decision.error },
      { status: decision.status },
    );
  }

  // ===== PHASE 1: KBank raw staging =====
  // Persist the exact raw webhook payload (and select headers) to
  // kbank_webhook_events BEFORE normalising. This gives the Reconcile/Payout
  // engines a raw-byte audit trail instead of only the normalised evidence.
  // Fail-closed: a DB write problem must never 200-get a verified KBank body.
  const kbankInsert = await supabaseAdmin()
    .from("kbank_webhook_events")
    .insert({
      event_id: decision.eventKey.replace(/^id:/, ""),
      raw_body: decision.payload,
      headers: decision.storedHeaders ?? null,
      status: "received",
    })
    .select("id, error")
    .single();

  if (kbankInsert.error) {
    console.error(
      `[kbank] failed to persist raw webhook to kbank_webhook_events: ${kbankInsert.error.message}`,
    );
    return NextResponse.json(
      { error: "Failed to persist raw payload for KBank webhook" },
      { status: 500 },
    );
  }

  // ===== End of Phase 1 =====

  // Gate accepted: KBank webhook body verified, signature OK.
  // Normalize the verified payload into the canonical GatewayEvent and publish
  // it to the Integration Gateway's Observe Channel.
  const events = normalizeKBankWebhook(decision.payload);

  // Publish each translated event to the Observe Channel.
  // (Failure here means the gateway is not ready — the connector is not wired
  // into the event bus yet. Fail-closed: do not ack as success if publish
  // fails until the wire is complete.)
  let published = 0;
  for (const event of events) {
    const ok = await publish(supabaseAdmin(), event);
    if (!ok) {
      return NextResponse.json(
        { error: `Failed to publish KBank event: ${event.capability}` },
        { status: 500 },
      );
    }
    published += 1;
  }

  if (published === 0) {
    return NextResponse.json({ error: "No KBank event translated — no capability matched" }, { status: 400 });
  }

  return NextResponse.json({ received: true, published });
}
