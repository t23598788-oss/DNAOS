import type { HandlerContext, LineMessageEvent } from "../events/types.ts"
import { saveEvent } from "../events/store.ts"

export async function handleGroup(ctx: HandlerContext): Promise<void> {
  const msgEvent = ctx.event as LineMessageEvent
  const msg = msgEvent.message as any
  const text = msg.text ?? msg.type ?? ""

  await saveEvent(ctx.supabase, {
    event:   ctx.event,
    userId:  ctx.userId,
    groupId: ctx.groupId,
    channelDestination: ctx.channelDestination,
    rawType: `group_${msg.type ?? "message"}`,
    rawText: text,
    status:  "new",
  })

  // Group events are stored only — no auto-reply to avoid business risk
}
