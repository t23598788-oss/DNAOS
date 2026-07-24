import type { HandlerContext, LineMessageEvent, LineTextMessage } from "../events/types.ts"
import { saveEvent } from "../events/store.ts"
import { ResponseGateway } from "../engines/response.ts"
import { tryRouteToTool } from "../engines/tool-router.ts"
import { tryCompleteAwaitingEvent } from "../engines/event-followup.ts"
import { tryAutoBuildEvent } from "../engines/auto-build-event.ts"
import { tryFollowUpDebtAck } from "../engines/debt-followup.ts"
import { tryRecordPaymentClaim } from "../engines/payment-claim.ts"
import { isPaymentInfoRequest, tryBuildPaymentInstructionsReply } from "../engines/payment-instructions.ts"
import { activateHumanTakeover, getConversationMode, isHumanTakeoverMessage } from "../engines/human-takeover.ts"
import { trySupplierQuoteReply } from "../engines/supplier-quote-reply.ts"

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

  // Human Takeover is a hard gate. It runs before every AI/tool/event engine;
  // once active, later messages are still stored in the timeline but no bot
  // engine is allowed to answer over the human operator.
  if (ctx.userId) {
    const mode = await getConversationMode(ctx.supabase, ctx.userId)
    if (mode === "human_takeover") return
    if (isHumanTakeoverMessage(text)) {
      await activateHumanTakeover(ctx.supabase, ctx.userId, saved?.id ?? null, text)
      if (ctx.replyToken) {
        await ResponseGateway.replyText(ctx.replyToken, "รับเรื่องแล้วครับ เจ้าหน้าที่จะเข้ามาตรวจสอบและตอบกลับโดยตรงครับ")
      }
      return
    }
  }

  if (!ctx.replyToken) return

  // Outbound Supplier RFQ reply (owner, 2026-07-24) — checked before every
  // customer-side engine below, since a supplier's line_user_id is never a
  // matched company_line_links row anyway; this is just the cleanest place
  // to give a real, specific confirmation instead of falling through to a
  // generic reply. Narrow match only (known pit + a real pending request +
  // a parseable number) — anything else returns null and falls through.
  if (ctx.userId) {
    const supplierReply = await trySupplierQuoteReply(ctx.supabase, ctx.userId, text)
    if (supplierReply) {
      await ResponseGateway.replyText(ctx.replyToken, supplierReply)
      return
    }
  }

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

  // Owner-reported bug 2026-07-18: a customer asking "ส่งเลขบัญชีมาด้วยตงครับ"
  // (please send the account number) was being swallowed by
  // tryFollowUpDebtAck below — that function treats ANY non-acknowledgment
  // reply while awaiting a payment date as the customer's scheduling answer.
  // Must run BEFORE that check so a genuine request for bank details is
  // recognized and answered for real, not silently misfiled.
  if (ctx.userId && isPaymentInfoRequest(text)) {
    const paymentInfoReply = await tryBuildPaymentInstructionsReply(ctx.supabase, ctx.userId)
    if (paymentInfoReply) {
      await ResponseGateway.replyText(ctx.replyToken, paymentInfoReply)
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

  // Payment Verification Engine — Waiting Bank Confirmation (owner,
  // 2026-07-18): "โอนแล้วครับ" with no slip attached previously vanished into
  // the generic fallback below. Checked late/narrow (same reasoning as
  // tryFollowUpDebtAck above) since it's a specific pattern match, not a
  // catch-all.
  if (ctx.userId) {
    const claimReply = await tryRecordPaymentClaim(ctx.supabase, ctx.userId, text, saved?.id ?? null)
    if (claimReply) {
      await ResponseGateway.replyText(ctx.replyToken, claimReply)
      return
    }
  }

  // Genuinely nothing to build (small talk, or extraction failed) — honest
  // holding reply, not a fabricated answer.
  await ResponseGateway.replyText(ctx.replyToken, "รับทราบครับ เดี๋ยวเช็คให้นะครับ")
}
