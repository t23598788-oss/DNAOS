import type { HandlerContext, LineMessageEvent } from "../events/types.ts"
import { saveEvent } from "../events/store.ts"
import { fetchAndStoreLineMedia } from "../engines/media.ts"
import { ResponseGateway } from "../engines/response.ts"
import { classifyReceiptImage } from "../engines/ocr-classify.ts"
import { processClassifiedImage } from "../engines/process-classified-image.ts"
import { matchOwnerSlipToPartnerPayable } from "../engines/owner-dispatcher.ts"

function guessMediaType(path: string): string {
  if (path.endsWith(".png")) return "image/png"
  if (path.endsWith(".gif")) return "image/gif"
  return "image/jpeg"
}

// Real base64 encode without blowing the call stack on a real photo's byte
// count (String.fromCharCode(...bytes) on a multi-MB array throws
// "Maximum call stack size exceeded" — chunked to stay real-world safe).
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

export async function handleImage(ctx: HandlerContext): Promise<void> {
  const msgEvent = ctx.event as LineMessageEvent
  const messageId = (msgEvent.message as any).id ?? ""

  const saved = await saveEvent(ctx.supabase, {
    event:   ctx.event,
    userId:  ctx.userId,
    groupId: ctx.groupId,
    rawType: "image",
    rawText: messageId,
    status:  "new",
  })

  // Human Reality Timeline (owner, 2026-07-16/17): "รูปภาพ → เห็นรูปเดิม" —
  // fetch and store the real original image so it can actually be shown
  // later, not just a "(ส่งรูปภาพ)" placeholder. Runs after saveEvent so a
  // slow/failed LINE Content API call never blocks recording that the
  // message happened at all.
  if (!saved || saved.duplicate || !messageId) return

  const mediaPath = await fetchAndStoreLineMedia(ctx.supabase, messageId, "image/jpeg")
  if (!mediaPath) return
  await ctx.supabase.from("line_events").update({ media_path: mediaPath }).eq("id", saved.id)

  if (!ctx.userId) return

  // Document reading via Claude, real ANTHROPIC_API_KEY set 2026-07-27
  // (owner instruction: "ใช้เฉพาะในกรณีอ่านบิลในแชท...ใช้เรื่องเดียวนี่" —
  // scoped to document/receipt reading only, every other AI touchpoint
  // — text fallback, material-name resolution — stays on local Ollama).
  // Synchronous now: no ai_tasks queue wait for this task, since Claude's
  // API is directly reachable from this cloud function (unlike the
  // OTP/bank-portal automation, nothing here needs the owner's own Mac).
  const { data: profile } = await ctx.supabase
    .from("line_profiles").select("role").eq("line_user_id", ctx.userId).maybeSingle()

  const { data: fileData } = await ctx.supabase.storage.from("attachments").download(mediaPath)
  const classified = fileData
    ? await classifyReceiptImage(
        { base64: bytesToBase64(new Uint8Array(await fileData.arrayBuffer())), mediaType: guessMediaType(mediaPath) },
        profile?.role ?? null,
      ).catch((e: Error) => { console.error("[handleImage] Claude classify failed:", e.message); return null })
    : null

  if (classified) {
    // Owner Dispatcher — Owner Surface routing (owner, 2026-07-27): a slip
    // FROM the owner's own chat is never a customer payment claim (the
    // owner is never the customer) — it is the real Trigger for stage 2 of
    // the partner-payable cascade (see engines/owner-dispatcher.ts). Route
    // it there first; only fall through to the normal customer-payment
    // path if no matching partner-payable request is actually open.
    if (
      profile?.role === "owner" &&
      (classified.document_type === "transfer_slip" || classified.document_type === "payment_advice") &&
      classified.amount
    ) {
      const matched = await matchOwnerSlipToPartnerPayable(ctx.supabase, {
        amount: Number(classified.amount),
        referenceNumber: classified.reference_number ?? null,
        lineEventId: saved.id,
      })
      if (matched) {
        await ResponseGateway.pushMessage(
          ctx.userId,
          `รับทราบครับ ยืนยันโอนให้ ${matched.partnerName} เรียบร้อยแล้ว`,
        )
        return
      }
    }

    await processClassifiedImage(ctx.supabase, {
      classified, mediaPath, lineEventId: saved.id, userId: ctx.userId,
    })
    return
  }

  // Real fallback (owner, 2026-07-25 pipeline, kept intentionally): if
  // Claude fails for any real reason (rate limit, no credit left, network),
  // this must not just drop the document silently — same local-AI queue as
  // before still catches it via ai-task-watcher.mjs + Ollama on the Mac.
  await ctx.supabase.from("ai_tasks").insert({
    kind: "classify_image",
    line_user_id: ctx.userId,
    line_event_id: saved.id,
    media_path: mediaPath,
    status: "pending",
  })
  await ResponseGateway.showLoading(ctx.userId, 60)
}
