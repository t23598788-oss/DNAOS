/**
 * POST /api/gateway/observe/line — inbound LINE webhook ingress for the
 * Integration Gateway's Observe Channel. Same pattern as
 * /api/gateway/observe/{github,vercel,railway}: no requireAuth, authenticity
 * via the provider's own signature (`x-line-signature`, HMAC-SHA256 base64 of
 * the raw body) instead. Never runs anything — each translated event is
 * published to the event bus (channel "observe" only).
 *
 * Multi-storefront (capability C, 2026-09-23): the payload's `destination`
 * identifies which account the event arrived through, and that account's own
 * signature secret is resolved through the canonical Connect accessor
 * (engines/connect/accounts.ts → public.connect_external_account_credentials).
 * LINE_CHANNEL_SECRET stays the MAIN account's configuration — it is no longer
 * the authority for every channel. The body is parsed before verification
 * (only to learn the destination) and nothing is read from it or written to the
 * database until the signature has been verified.
 *
 * Fail-closed on every path: no usable secret -> 401 (or 503 when the main
 * account secret is also unset), bad signature -> 401, unparseable JSON -> 400,
 * bus rejection -> 500.
 */
import { NextRequest, NextResponse } from "next/server";
import { normalizeLineWebhook, verifyLineSignature } from "@/engines/integration-gateway/adapters/line";
import { publish } from "@/engines/integration-gateway/event-bus/bus";
import { resolveExternalAccountCredential } from "@/engines/connect/accounts";
import { supabaseAdmin } from "@/services/supabase/queries";

/** The provider this ingress serves. */
const PROVIDER = "line";

export async function POST(req: NextRequest) {
  const mainSecret = process.env.LINE_CHANNEL_SECRET;

  const rawBody = await req.text();
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "unparseable JSON body" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const destination = (payload as { destination?: unknown })?.destination;
  let channelSecret = mainSecret ?? "";
  if (typeof destination === "string" && destination.length > 0) {
    const account = await resolveExternalAccountCredential(db, { provider: PROVIDER, externalAccountId: destination });
    if (account?.credentialResolved && account.credential?.channel_secret) {
      channelSecret = account.credential.channel_secret;
    }
  }

  if (!channelSecret) {
    return NextResponse.json({ error: "no LINE channel secret configured for this account" }, { status: 503 });
  }

  const signature = req.headers.get("x-line-signature");
  if (!verifyLineSignature(rawBody, signature, channelSecret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const { events, skipped } = normalizeLineWebhook(payload);
  for (const event of events) {
    const result = await publish(db, event);
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 500 });
  }

  return NextResponse.json({ ok: true, accepted: events.length, skipped });
}

