// LINE Webhook v2 — thin router
// Dispatches every event to its single-responsibility handler module.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4"
import { verifyLineSignature } from "./middleware/signature.ts"
import { forwardLineInbound } from "../_shared/connect-forward.ts"
import { resolveAccountCredential } from "../_shared/connect-identity.ts"

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

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  )

  let payload: LineWebhookPayload
  try {
    payload = JSON.parse(rawBody)
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

  const valid = await verifyLineSignature(rawBody, signature, channelSecret)
  if (!valid && channelSecret) {
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

  // LINE requires the webhook to respond within a few seconds or it marks
  // delivery as failed/timed out. Previously every event was processed
  // sequentially (one `await` after another) INSIDE the request before
  // responding — with a burst of events, or any slow handler, this could
  // easily exceed that window. Fix: process all events concurrently, hand
  // the whole batch to EdgeRuntime.waitUntil() so it keeps running in the
  // background, and return the 200 ACK immediately. Business logic inside
  // each handler is unchanged — this only changes when the response is sent.
  const events = payload.events ?? []
  const processAll = Promise.all(events.map((event) =>
    processEvent(event).catch((err) => console.error("[webhook] event processing failed:", err))
  ))

  // DNA OS main path (capability A, 2026-09-23): the SAME verified raw body
  // also enters the canonical gateway observe ingress, where it is translated
  // into the provider-neutral contract (engines/integration-gateway/adapters/line.ts)
  // and published to the event bus. Additive only — the handling below is
  // untouched, and a forward failure never affects the provider's ACK.
  const forward = forwardLineInbound(rawBody, signature)

  // @ts-ignore — EdgeRuntime is a Supabase-specific global, not in standard Deno types
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(processAll)
    // @ts-ignore
    EdgeRuntime.waitUntil(forward)
  } else {
    // Fallback for local `supabase functions serve` (no EdgeRuntime global) —
    // still await it directly so events aren't silently dropped in dev.
    await processAll
    await forward
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
  })
})
