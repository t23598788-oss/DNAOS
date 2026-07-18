import type { HandlerContext, LineMessageEvent } from "../events/types.ts"
import { saveEvent } from "../events/store.ts"
import { fetchAndStoreLineMedia } from "../engines/media.ts"

// Human Reality Timeline / TASK-001 Restore Original Human Data (owner,
// 2026-07-17): "Voice → เล่นไฟล์เสียงต้นฉบับ" — previously fell through to
// fallback.ts, no original audio kept anywhere.
export async function handleAudio(ctx: HandlerContext): Promise<void> {
  const msgEvent = ctx.event as LineMessageEvent
  const messageId = (msgEvent.message as any).id ?? ""

  const saved = await saveEvent(ctx.supabase, {
    event:   ctx.event,
    userId:  ctx.userId,
    groupId: ctx.groupId,
    rawType: "audio",
    rawText: messageId,
    status:  "new",
  })

  if (saved && !saved.duplicate && messageId) {
    const mediaPath = await fetchAndStoreLineMedia(ctx.supabase, messageId, "audio/m4a")
    if (mediaPath) {
      await ctx.supabase.from("line_events").update({ media_path: mediaPath }).eq("id", saved.id)
    }
  }
}
