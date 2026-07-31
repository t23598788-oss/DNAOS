// OpenClaw + Pinto webhook — thin bridge into the DNA OS cognitive pipeline.
//
// Flow: phone (Pinto app) -> OpenClaw gateway -> this webhook -> cognitive
// pipeline (via app/api/internal/openclaw/command, since Edge Functions can't
// import the Node pipeline directly) -> reply back out.
//
// Registration: this endpoint is the receiving_path for the DNA OS
// "openclaw-pinto" connector (auth_type: webhook, see gateway/connectors.ts).
// Its signing_secret must match the Pinto channel's `webhookSecret` config
// on the OpenClaw gateway (openclaw-fakduai-pinto repo).
//
// NOTE — outbound reply: this handler answers synchronously with
// `{ "reply": "..." }` in the webhook HTTP response. Confirm this matches
// what the Pinto channel plugin actually expects (some chat webhook
// integrations require an explicit follow-up call to the provider's own
// send-message API instead of a body echoed back). Check
// docs.openclaw.ai / the pinto-openclaw-gateway plugin source before relying
// on this in production — this is the one unverified assumption in this
// integration.

import { verifyOpenClawSignature } from "./middleware/signature.ts"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-openclaw-signature",
}

interface OpenClawWebhookPayload {
  event?: string
  chatId?: string
  userId?: string
  text?: string
  message?: { text?: string }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS })

  const rawBody = await req.text()
  const signature = req.headers.get("x-openclaw-signature")
  const webhookSecret = Deno.env.get("OPENCLAW_WEBHOOK_SECRET") ?? ""

  const valid = await verifyOpenClawSignature(rawBody, signature, webhookSecret)
  if (!valid && webhookSecret) {
    return new Response("Unauthorized", { status: 401, headers: CORS })
  }

  let payload: OpenClawWebhookPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new Response("Bad JSON", { status: 400, headers: CORS })
  }

  const text = payload.text ?? payload.message?.text ?? ""
  if (!text.trim()) {
    return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, "Content-Type": "application/json" } })
  }

  const appUrl = Deno.env.get("DNA_OS_APP_URL") ?? ""
  const internalSecret = Deno.env.get("OPENCLAW_INTERNAL_SECRET") ?? ""

  let reply = "ระบบยังไม่พร้อมรับคำสั่งจากช่องทางนี้ตอนนี้ครับ"
  try {
    const res = await fetch(`${appUrl}/api/internal/openclaw/command`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-openclaw-internal-secret": internalSecret,
      },
      body: JSON.stringify({ userCommand: text, contactContext: payload.userId ?? payload.chatId ?? null }),
    })
    const data = await res.json()
    if (typeof data.reply === "string") reply = data.reply
  } catch {
    // keep default fallback reply
  }

  return new Response(JSON.stringify({ ok: true, reply }), {
    headers: { ...CORS, "Content-Type": "application/json" },
  })
})
