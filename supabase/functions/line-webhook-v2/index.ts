// LINE Webhook v2 — thin router
// Dispatches every event to its single-responsibility handler module.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4"
import { verifyLineSignature } from "./middleware/signature.ts"
import { handleFollow }   from "./handlers/follow.ts"
import { handleUnfollow } from "./handlers/unfollow.ts"
import { handleText }     from "./handlers/text.ts"
import { handleLocation } from "./handlers/location.ts"
import { handlePostback } from "./handlers/postback.ts"
import { handleImage }    from "./handlers/image.ts"
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
  const channelSecret = Deno.env.get("LINE_CHANNEL_SECRET") ?? ""

  const valid = await verifyLineSignature(rawBody, signature, channelSecret)
  if (!valid && channelSecret) {
    return new Response("Unauthorized", { status: 401, headers: CORS })
  }

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

  async function processEvent(event: LineWebhookPayload["events"][number]) {
    const userId  = event.source?.userId  ?? ""
    const groupId = event.source?.groupId ?? null

    const ctx: HandlerContext = {
      supabase,
      event,
      userId,
      groupId,
      replyToken: (event as any).replyToken ?? null,
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

  // @ts-ignore — EdgeRuntime is a Supabase-specific global, not in standard Deno types
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(processAll)
  } else {
    // Fallback for local `supabase functions serve` (no EdgeRuntime global) —
    // still await it directly so events aren't silently dropped in dev.
    await processAll
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
  })
})
