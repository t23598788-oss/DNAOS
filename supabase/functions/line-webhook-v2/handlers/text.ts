import type { HandlerContext, LineMessageEvent, LineTextMessage } from "../events/types.ts"
import { saveEvent } from "../events/store.ts"
import { ResponseGateway } from "../engines/response.ts"
import { tryRouteToTool } from "../engines/tool-router.ts"
import { tryCompleteAwaitingEvent } from "../engines/event-followup.ts"
import { tryFollowUpDebtAck } from "../engines/debt-followup.ts"
import { tryRecordPaymentClaim } from "../engines/payment-claim.ts"
import { isPaymentInfoRequest, tryBuildPaymentInstructionsReply } from "../engines/payment-instructions.ts"
import { activateHumanTakeover, getConversationMode, isHumanTakeoverMessage } from "../engines/human-takeover.ts"
import { trySupplierQuoteReply } from "../engines/supplier-quote-reply.ts"
import { answerExternalFact, isExternalFactQuestion } from "../engines/external-facts.ts"

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

  // Owner's own LINE chat as a remote control for the admin dashboard
  // (owner, 2026-07-31: "กูสั่งจาก LINE โน้ตบุ๊กนี้ขยับตามได้เลยแหละ").
  // Checked first/exclusively for the owner's line_user_id — everything
  // below this (tool-router, follow-ups, human-takeover ack, etc.) is
  // customer-facing deterministic logic that doesn't apply here. Routes
  // through the exact same cognitive/pipeline.ts the admin dashboard's own
  // SecretaryChat uses, via the Node bridge (Deno can't import it
  // directly) — same bridge pattern as document-artifact/openclaw-webhook.
  // Rule 72 still applies: this only proposes/plans, real mutations still
  // need an explicit follow-up "ส่งเลย" from the owner, same as every
  // other channel.
  const ownerLineUserId = Deno.env.get("OWNER_LINE_USER_ID")
  if (ctx.userId && ownerLineUserId && ctx.userId === ownerLineUserId) {
    const appUrl = Deno.env.get("DNA_OS_APP_URL") ?? ""
    const internalSecret = Deno.env.get("LINE_COMMAND_INTERNAL_SECRET") ?? ""
    try {
      const res = await fetch(`${appUrl}/api/internal/line/command`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-line-command-internal-secret": internalSecret,
        },
        body: JSON.stringify({ lineUserId: ctx.userId, commandText: text }),
      })
      const data = await res.json()
      await ResponseGateway.replyText(ctx.replyToken, typeof data.reply === "string" ? data.reply : "รับคำสั่งแล้วครับ")
    } catch {
      await ResponseGateway.replyText(ctx.replyToken, "ขออภัยครับ ระบบประมวลผลคำสั่งไม่สำเร็จตอนนี้ ลองใหม่อีกครั้งครับ")
    }
    return
  }

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

  // Real Ground-Truth Layer (owner, 2026-07-30): "รวบสมองเข้าด้วยกัน...ให้
  // เหตุการณ์มันเป็นเรื่องเดียวกัน" — same real-data-first check
  // cognitive/pipeline.ts's answerExternalFact() runs on the admin side,
  // ported here so the LINE side never guesses fuel price/weather/date
  // either. Checked early/unconditionally (not gated on ctx.userId, since
  // these facts have nothing to do with which company this contact is) —
  // deliberately before tryCompleteAwaitingEvent so a real question about
  // fuel/weather/date is never misread as an answer to an unrelated open
  // quote's missing fields (same class of bug as KM-008).
  if (isExternalFactQuestion(text)) {
    const factReply = await answerExternalFact(text)
    if (factReply) {
      await ResponseGateway.replyText(ctx.replyToken, factReply)
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

  // Owner-reported bug 2026-07-18, widened 2026-07-30: a customer asking
  // "ส่งเลขบัญชีมาด้วยตงครับ" (please send the account number) was being
  // swallowed by tryFollowUpDebtAck further below. Moved from its original
  // spot (right before tryFollowUpDebtAck) to run here — BEFORE
  // tryCompleteAwaitingEvent too — because the same swallowing happens when
  // this contact has an open awaiting_info business event (e.g. a quote in
  // progress): tryCompleteAwaitingEvent treats any non-matching reply as an
  // attempt to answer whatever's still missing and returns its own canned
  // "ส่งชนิดวัสดุ.../ส่ง GPS..." nag, so a real bank-account question never
  // reached this check at all (real customer report: "พี่หนุ่ม" asked for the
  // account number mid-quote and got the material/GPS nag instead). A
  // request for payment info is never a legitimate answer to a
  // material/quantity/destination question, so it must be checked first.
  if (ctx.userId && isPaymentInfoRequest(text)) {
    const paymentInfoReply = await tryBuildPaymentInstructionsReply(ctx.supabase, ctx.userId)
    if (paymentInfoReply) {
      await ResponseGateway.replyText(ctx.replyToken, paymentInfoReply)
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
      // A reply token is single-use — can't send text then a flex card
      // separately. Owner instruction (2026-07-26): show the real price as
      // a Flex card when there is one; multi-material replies with several
      // cards still go out fine via the async/push path (ai-callback),
      // this synchronous path sends the first card if there's exactly one.
      if (followupReply.flex?.length === 1) {
        await ResponseGateway.replyFlex(ctx.replyToken, followupReply.text.slice(0, 100) || "ใบเสนอราคา", followupReply.flex[0])
      } else {
        await ResponseGateway.replyText(ctx.replyToken, followupReply.text)
      }
      return
    }
  }

  // Real fix, 2026-07-31 (roadmap #1): tryAutoBuildEvent() used to sit here
  // as a synchronous, Claude-dependent attempt to build a business event
  // from this message right away — but it always returned null in
  // production (ANTHROPIC_API_KEY missing/blocked, same dead-path bug as
  // tool-router.ts). The exact same event-building job is ALREADY done for
  // real by the async local-AI pipeline this file already falls through to
  // below (ai_tasks kind="handle_text" → ai-task-watcher.mjs on the owner's
  // Mac runs local Ollama extraction → ai-callback's buildEventFromExtraction,
  // engines/build-event-from-extraction.ts — verified live, real code path,
  // not assumed). Keeping the dead synchronous call here just added latency
  // for a check that could never succeed; removed rather than "fixed" since
  // the working version already exists elsewhere (Rule 101/103 — no second
  // parallel implementation). See existence.json KM-011 and
  // capability-roadmap.json #1 for the full removal record.

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

  // Genuinely nothing to build (small talk, or extraction failed). Owner
  // correction (2026-07-25, four steps, same conversation): canned line
  // "เดี๋ยวเช็คให้นะครับ" removed (fabricated promise) -> total silence tried
  // and rejected ("เงียบแบบนี้ไม่ได้") -> a static warm line also rejected
  // ("ให้ระบบมันคิดมากๆ หน่อย") -> root cause found live: ANTHROPIC_API_KEY
  // was never actually set in production (`supabase secrets list` has no
  // such key — every AI call in this whole handler, including tool-router
  // and auto-build-event above, has been silently returning null this
  // whole time). Owner: "ย้ายทุกอย่างมาประมวลผลในเครื่อง Mac" — no cloud AI
  // budget, process locally with Ollama instead. Enqueue for the local
  // watcher (ai-task-watcher.mjs) to think about and push a reply for —
  // can't reply synchronously here since Ollama-on-a-home-Mac + a polling
  // delay won't finish inside this request.
  if (ctx.userId) {
    await ctx.supabase.from("ai_tasks").insert({
      kind: "handle_text",
      line_user_id: ctx.userId,
      line_event_id: saved?.id ?? null,
      input_text: text,
      status: "pending",
    })
    // Owner-reported bug (2026-07-26): "ไม่มีแจ้งเตือนว่าอ่านแล้วหรือยัง...
    // ไม่รู้เลยว่ารอคำตอบจากใครวะ" — real "..." typing indicator while the
    // local-AI queue actually works, not silence.
    await ResponseGateway.showLoading(ctx.userId, 60)
  }
}
