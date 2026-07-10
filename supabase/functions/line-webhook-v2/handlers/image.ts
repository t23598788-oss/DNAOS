import type { HandlerContext, LineMessageEvent } from "../events/types.ts"
import { saveEvent } from "../events/store.ts"

export async function handleImage(ctx: HandlerContext): Promise<void> {
  const msgEvent = ctx.event as LineMessageEvent

  await saveEvent(ctx.supabase, {
    event:   ctx.event,
    userId:  ctx.userId,
    groupId: ctx.groupId,
    rawType: "image",
    rawText: (msgEvent.message as any).id ?? "",
    status:  "new",
  })

  // Image processing (OCR, document scan) — queued for async worker
}
