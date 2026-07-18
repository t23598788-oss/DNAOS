import type { HandlerContext, LineMessageEvent } from "../events/types.ts"
import { saveEvent } from "../events/store.ts"
import { fetchAndStoreLineMedia } from "../engines/media.ts"

// Human Reality Timeline / TASK-001 Restore Original Human Data (owner,
// 2026-07-17): "PDF → เปิด PDF ต้นฉบับ" — LINE's "file" message type covers
// PDFs and other documents a customer sends; previously fell through to
// fallback.ts (stored nothing beyond the raw event, no original kept).
export async function handleFile(ctx: HandlerContext): Promise<void> {
  const msgEvent = ctx.event as LineMessageEvent
  const message = msgEvent.message as any
  const messageId = message.id ?? ""
  const fileName: string | null = message.fileName ?? null

  const saved = await saveEvent(ctx.supabase, {
    event:   ctx.event,
    userId:  ctx.userId,
    groupId: ctx.groupId,
    rawType: "file",
    rawText: fileName ?? messageId,
    status:  "new",
  })

  if (saved && !saved.duplicate && messageId) {
    const mediaPath = await fetchAndStoreLineMedia(ctx.supabase, messageId, "application/pdf", fileName)
    if (mediaPath) {
      await ctx.supabase.from("line_events").update({ media_path: mediaPath }).eq("id", saved.id)
    }
  }
}
