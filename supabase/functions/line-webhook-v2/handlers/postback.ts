import type { HandlerContext, LinePostbackEvent } from "../events/types.ts"
import { saveEvent } from "../events/store.ts"
import { ResponseGateway } from "../engines/response.ts"

export async function handlePostback(ctx: HandlerContext): Promise<void> {
  const pb = (ctx.event as LinePostbackEvent).postback
  const data = pb?.data ?? ""

  const saved = await saveEvent(ctx.supabase, {
    event:     ctx.event,
    userId:    ctx.userId,
    groupId:   ctx.groupId,
    rawType:   "postback",
    rawText:   data,
    extracted: pb.params ? { params: pb.params } : undefined,
  })

  // Redelivered webhook — CONFIRM_JOB/CANCEL_JOB actually change job state,
  // so replaying them isn't just a noisy duplicate reply, it's a real risk.
  if (saved?.duplicate) return

  // Route postback data string to the correct action
  const [action, ...rest] = data.split(":")
  const payload = rest.join(":")

  if (action === "CONFIRM_JOB" && ctx.replyToken) {
    await ResponseGateway.replyText(ctx.replyToken, `ยืนยันงาน ${payload} เรียบร้อยครับ`)
    return
  }

  if (action === "CANCEL_JOB" && ctx.replyToken) {
    await ResponseGateway.replyText(ctx.replyToken, `ยกเลิกงาน ${payload} เรียบร้อยครับ`)
    return
  }

  if (ctx.replyToken) {
    await ResponseGateway.replyText(ctx.replyToken, "รับทราบครับ")
  }
}
