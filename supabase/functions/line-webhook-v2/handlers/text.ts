import type { HandlerContext, LineMessageEvent, LineTextMessage } from "../events/types.ts"
import { saveEvent } from "../events/store.ts"
import { ResponseGateway } from "../engines/response.ts"
import { tryRouteToTool } from "../engines/tool-router.ts"
import { tryCompleteAwaitingEvent } from "../engines/event-followup.ts"
import { tryAutoBuildEvent } from "../engines/auto-build-event.ts"
import { tryFollowUpDebtAck } from "../engines/debt-followup.ts"

export async function handleText(ctx: HandlerContext): Promise<void> {
  const msgEvent = ctx.event as LineMessageEvent
  const msg = msgEvent.message as LineTextMessage
  const text = msg.text ?? ""

  const saved = await saveEvent(ctx.supabase, {
    event:   ctx.event,
    userId:  ctx.userId,
    groupId: ctx.groupId,
    rawType: "text",
    rawText: text,
  })

  // Redelivered webhook (LINE retry after our function was slow/timed out) —
  // already handled this exact event, don't reply again.
  if (saved?.duplicate) return

  if (!ctx.replyToken) return

  // Real business questions get real answers looked up by person, not a
  // generic ack — e.g. "เราเคยเป็นหนี้กันไหม" gets the actual debt_snapshots
  // figure for whichever company this LINE contact is matched to. The router
  // picks WHICH tool (debt / order status / purchase history) fits the
  // message — it never authors the reply text itself, only the tool choice.
  if (ctx.userId) {
    const toolReply = await tryRouteToTool(ctx.supabase, ctx.userId, text)
    if (toolReply) {
      await ResponseGateway.replyText(ctx.replyToken, toolReply)
      return
    }
  }

  // If we already asked this contact something (missing material/quantity/
  // site), this message is very likely the answer — use it for real instead
  // of echoing it back (owner-reported bug 2026-07-10: bot kept saying
  // "รับข้อความแล้ว" to answers it should have acted on).
  if (ctx.userId) {
    const followupReply = await tryCompleteAwaitingEvent(ctx.supabase, ctx.userId, text, saved?.id ?? null)
    if (followupReply) {
      await ResponseGateway.replyText(ctx.replyToken, followupReply)
      return
    }
  }

  // No open question and not a debt inquiry — try to build a real event out
  // of this message right now instead of waiting for an admin to click
  // "สร้าง Event" (owner-reported bug 2026-07-10: a real customer sent 5
  // messages asking for a price and got zero response because nobody had
  // opened the dashboard yet).
  if (ctx.userId) {
    const builtReply = await tryAutoBuildEvent(ctx.supabase, ctx.userId)
    if (builtReply) {
      await ResponseGateway.replyText(ctx.replyToken, builtReply)
      return
    }
  }

  // Owner-reported bug 2026-07-11: a plain "รับทราบครับ" reply to a debt
  // reminder card fell into the generic fallback below ("เดี๋ยวเช็คให้นะครับ"
  // — nonsensical, there's nothing to check). If we're waiting on this
  // contact for a payment date, handle that specifically before falling
  // back to the generic holding reply.
  if (ctx.userId) {
    const debtFollowup = await tryFollowUpDebtAck(ctx.supabase, ctx.userId, text)
    if (debtFollowup) {
      await ResponseGateway.replyText(ctx.replyToken, debtFollowup)
      return
    }
  }

  // Genuinely nothing to build (small talk, or extraction failed) — honest
  // holding reply, not a fabricated answer.
  await ResponseGateway.replyText(ctx.replyToken, "รับทราบครับ เดี๋ยวเช็คให้นะครับ")
}
