// LINE Webhook v2 — thin router
// Dispatches every event to its single-responsibility handler module.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4"
import { verifyLineSignature } from "./middleware/signature.ts"
import { forwardLineInbound } from "../_shared/connect-forward.ts"
import { resolveAccountCredential } from "../_shared/connect-identity.ts"
import { isCoreEventEnvelope } from "../_shared/core-event.ts"
import { enqueueCoreEvents, normalizeLineEvents } from "../_shared/core-event-transport.ts"

/** The provider id this edge serves — identity/config is otherwise provider-neutral. */
const PROVIDER = "line"
import { handleFollow }   from "./handlers/follow.ts"
import { handleUnfollow } from "./handlers/unfollow.ts"
import { handleText }     from "./handlers/text.ts"
import { handleLocation } from "./handlers/location.ts"
import { handlePostback } from "./handlers/postback.ts"
import { handleImage }    from "./handlers/image.ts"
import { handleFile }     from "./handlers/file.ts"
import { handleAudio }    from "./handlers/audio.ts"
import { handleGroup }    from "./handlers/group.ts"
import { handleFallback } from "./handlers/fallback.ts"
import type { LineWebhookPayload, HandlerContext, LineMessageEvent } from "./events/types.ts"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-line-signature",
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS })

  const rawBody = await req.text()
  const signature = req.headers.get("x-line-signature")
  const dispatchSecret = Deno.env.get("CORE_QUEUE_DISPATCH_SECRET") ?? ""
  const isQueueDispatch = req.headers.has("x-core-queue-dispatch-secret")

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  )

  let payload: LineWebhookPayload
  try {
    if (isQueueDispatch) {
      if (!dispatchSecret || req.headers.get("x-core-queue-dispatch-secret") !== dispatchSecret) {
        return new Response("Unauthorized", { status: 401, headers: CORS })
      }
      const envelope: unknown = JSON.parse(rawBody)
      if (!isCoreEventEnvelope(envelope) || envelope.source !== PROVIDER) {
        return new Response("Invalid core event", { status: 400, headers: CORS })
      }
      const lineEvent = envelope.data.line_event
      if (!lineEvent || typeof lineEvent !== "object") {
        return new Response("Missing normalized LINE event", { status: 400, headers: CORS })
      }
      payload = {
        destination: typeof envelope.data.channel_destination === "string" ? envelope.data.channel_destination : "",
        events: [lineEvent as LineWebhookPayload["events"][number]],
      }
    } else {
      payload = JSON.parse(rawBody)
    }
  } catch {
    return new Response("Bad JSON", { status: 400, headers: CORS })
  }

  // Multi-storefront (owner, 2026-07-25): `destination` identifies which real
  // messaging account this event arrived through. Capability C (2026-09-23):
  // the per-account config/credential now resolves through the canonical
  // Connect accessor (supabase/functions/_shared/connect-identity.ts →
  // public.connect_external_account_credentials) instead of a single
  // LINE_CHANNEL_SECRET env var being the authority for every channel. The env
  // vars stay the MAIN account's own configuration (unchanged fallback) — they
  // are no longer the answer for any other account.
  let channelSecret = Deno.env.get("LINE_CHANNEL_SECRET") ?? ""
  let channelAccessToken: string | null = null
  if (payload.destination) {
    const account = await resolveAccountCredential(supabase, PROVIDER, payload.destination)
    const resolvedSecret = account?.credentialResolved ? account.credential?.channel_secret ?? null : null
    const resolvedToken = account?.credentialResolved ? account.credential?.channel_access_token ?? null : null
    if (resolvedSecret) {
      channelSecret = resolvedSecret
      channelAccessToken = resolvedToken
    }
  }

  if (!isQueueDispatch && !channelSecret) {
    return new Response("LINE channel secret is not configured", { status: 503, headers: CORS })
  }

  const valid = isQueueDispatch || await verifyLineSignature(rawBody, signature, channelSecret)
  if (!valid) {
    return new Response("Unauthorized", { status: 401, headers: CORS })
  }

  async function processEvent(event: LineWebhookPayload["events"][number]) {
    const userId  = event.source?.userId  ?? ""
    const groupId = event.source?.groupId ?? null

    const ctx: HandlerContext = {
      supabase,
      event,
      userId,
      groupId,
      replyToken: (event as any).replyToken ?? null,
      channelAccessToken,
      // Which account this webhook arrived through (payload.destination) —
      // stored per-event for LINE account audit (types.ts channelDestination).
      channelDestination: typeof payload.destination === "string" ? payload.destination : null,
    }

    // Group events — store only, no pipeline
    if (groupId && event.type === "message") {
      await handleGroup(ctx)
      return
    }

    if (!userId) return

    switch (event.type) {
      case "follow":   await handleFollow(ctx);   break
      case "unfollow": await handleUnfollow(ctx); break
      case "postback": await handlePostback(ctx); break
      case "message": {
        const msgType = (event as LineMessageEvent).message?.type
        if (msgType === "text")     await handleText(ctx)
        else if (msgType === "location") await handleLocation(ctx)
        else if (msgType === "image")    await handleImage(ctx)
        else if (msgType === "file")     await handleFile(ctx)
        else if (msgType === "audio")    await handleAudio(ctx)
        else                             await handleFallback(ctx)
        break
      }
      default: await handleFallback(ctx)
    }
  }

  // LINE is acknowledged only after the Main Server confirms queue acceptance.
  const events = payload.events ?? []

  // Only queue deliveries run the existing LINE business handlers. The public
  // provider request is translated to the core envelope and queued below.
  if (isQueueDispatch) {
    await Promise.all(events.map((event) =>
      processEvent(event).catch((err) => console.error("[webhook] event processing failed:", err))
    ))
    return new Response(JSON.stringify({ ok: true, processed: events.length }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    })
  }

  const canonicalEvents = await normalizeLineEvents(payload)
  const accepted = await enqueueCoreEvents(canonicalEvents)
  if (!accepted) {
    return new Response(JSON.stringify({ error: "core event queue unavailable" }), {
      status: 503,
      headers: { ...CORS, "Content-Type": "application/json" },
    })
  }

  // The existing provider-neutral Observe path stays additive while the core
  // queue becomes the execution path. Its failure never changes the webhook ACK.
  const forward = forwardLineInbound(rawBody, signature)

  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
    EdgeRuntime.waitUntil(forward)
  } else {
    await forward
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
  })
})
