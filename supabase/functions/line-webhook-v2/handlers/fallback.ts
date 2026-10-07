import type { HandlerContext } from "../events/types.ts"
import { saveEvent } from "../events/store.ts"

export async function handleFallback(ctx: HandlerContext): Promise<void> {
  await saveEvent(ctx.supabase, {
    event:   ctx.event,
    userId:  ctx.userId,
    groupId: ctx.groupId,
    channelDestination: ctx.channelDestination,
    rawType: ctx.event.type ?? "unknown",
    rawText: "",
    status:  "new",
  })

  // Unknown event type — stored for audit, no reply
}
