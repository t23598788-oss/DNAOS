// KBank Webhook Receiver Skeleton.
// MOCK-MODE BUILD while KBank sandbox approval is pending.
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
// TODO: signature_header config comes from the connector record
// (the gate reads it from connector.config.signature_header + connector.secret
// after KBank's webhook secret is provisioned). Until then the gate rejects
// 503.
import { NextRequest, NextResponse } from "next/server";
import { getConnectedConnector } from "@/core/connector-loader";
import { supabaseAdmin } from "@/services/supabase/queries";
import {
  MAX_WEBHOOK_BODY_BYTES,
  evaluateWebhookRequest,
} from "../[slug]/_lib/webhookGate";

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

  // Gate accepted: KBank webhook body verified, signature OK.
  // TODO: when KBank's webhook secret is provisioned, map the event to the
  // internal event bus here (payment_confirmed, payout_completed, etc.).
  console.log("[KBank Webhook] received verified payload:", JSON.stringify(decision.payload));
  return NextResponse.json({ received: true });
}
