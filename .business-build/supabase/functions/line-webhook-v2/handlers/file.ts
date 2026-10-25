import type { HandlerContext, LineMessageEvent } from "../events/types.ts"
import { saveEvent } from "../events/store.ts"
import { fetchAndStoreLineMedia } from "../engines/media.ts"
import { ResponseGateway } from "../engines/response.ts"
import { classifyReceiptImage } from "../engines/ocr-classify.ts"
import { processClassifiedImage } from "../engines/process-classified-image.ts"
import { guessMediaType, bytesToBase64 } from "./image.ts"

// Human Reality Timeline / TASK-001 Restore Original Human Data (owner,
// 2026-07-17): "PDF → เปิด PDF ต้นฉบับ" — LINE's "file" message type covers
// PDFs and other documents a customer sends; previously fell through to
// fallback.ts (stored nothing beyond the raw event, no original kept).
//
// Owner correction (2026-07-31): "ไฟล์ PDF จะให้ทำยังไงก็ให้อ่านสิ" — storing
// the original was only half the job. This handler used to stop there,
// storing the file and never reading or acknowledging it — the owner sent
// 19 real documents through LINE that day and got zero replies for any of
// them. Now mirrors handlers/image.ts's real classify pipeline exactly
// (Rule 103/111 — reuse, don't build a second parallel one): download,
// classify via Claude (now PDF-capable, see engines/claude-client.ts),
// record via the same processClassifiedImage() every image uses, fall back
// to the local-Ollama ai_tasks queue on failure, same as images.
export async function handleFile(ctx: HandlerContext): Promise<void> {
  const msgEvent = ctx.event as LineMessageEvent
  const message = msgEvent.message as any
  const messageId = message.id ?? ""
  const fileName: string | null = message.fileName ?? null

  const saved = await saveEvent(ctx.supabase, {
    event:   ctx.event,
    userId:  ctx.userId,
    groupId: ctx.groupId,
    channelDestination: ctx.channelDestination,
    rawType: "file",
    rawText: fileName ?? messageId,
    status:  "new",
  })

  if (!saved || saved.duplicate || !messageId) return

  // "application/pdf" here is only a fallback hint — fetchAndStoreLineMedia
  // uses LINE's real Content-Type response header first, and the fileName's
  // real extension second, so a non-PDF file sent via LINE's "file" message
  // type (this project has seen this happen with plain .jpg attachments)
  // still gets stored and classified with its true type, not force-read as
  // a PDF that isn't one.
  const mediaPath = await fetchAndStoreLineMedia(ctx.supabase, messageId, "application/pdf", fileName)
  if (!mediaPath) return
  await ctx.supabase.from("line_events").update({ media_path: mediaPath }).eq("id", saved.id)

  if (!ctx.userId) return

  const { data: profile } = await ctx.supabase
    .from("line_profiles").select("role").eq("line_user_id", ctx.userId).maybeSingle()

  const { data: fileData } = await ctx.supabase.storage.from("attachments").download(mediaPath)
  const classified = fileData
    ? await classifyReceiptImage(
        { base64: bytesToBase64(new Uint8Array(await fileData.arrayBuffer())), mediaType: guessMediaType(mediaPath) },
        profile?.role ?? null,
      ).catch((e: Error) => { console.error("[handleFile] Claude classify failed:", e.message); return null })
    : null

  if (classified) {
    await processClassifiedImage(ctx.supabase, {
      classified, mediaPath, lineEventId: saved.id, userId: ctx.userId,
    })
    return
  }

  // Same real fallback as handlers/image.ts: never drop the document
  // silently if Claude fails — the local-AI queue (ai-task-watcher.mjs +
  // Ollama on the owner's Mac) catches it instead.
  await ctx.supabase.from("ai_tasks").insert({
    kind: "classify_image",
    line_user_id: ctx.userId,
    line_event_id: saved.id,
    media_path: mediaPath,
    status: "pending",
  })
  await ResponseGateway.showLoading(ctx.userId, 60)
}
