import type { HandlerContext } from "../events/types.ts"
import { saveEvent } from "../events/store.ts"

export async function handleUnfollow(ctx: HandlerContext): Promise<void> {
  await saveEvent(ctx.supabase, {
    event:   ctx.event,
    userId:  ctx.userId,
    groupId: ctx.groupId,
    rawType: "unfollow",
    rawText: "unfollow",
  })
}
