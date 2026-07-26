import type { HandlerContext, LineMessageEvent } from "../events/types.ts"
import { saveEvent } from "../events/store.ts"
import { fetchAndStoreLineMedia } from "../engines/media.ts"
import { ResponseGateway } from "../engines/response.ts"

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

  // Local-AI pipeline (owner, 2026-07-25): classification used to call
  // Claude directly here — confirmed dead in production (`supabase secrets
  // list` has no ANTHROPIC_API_KEY, never did). Owner has no cloud AI
  // budget and wants everything processed locally via Ollama on his own
  // Mac instead. Enqueue the work; a local watcher script
  // (ai-task-watcher.mjs) polls ai_tasks, classifies with Ollama, and posts
  // the result to functions/ai-callback, which runs the real downstream
  // logic (engines/process-classified-image.ts) — unchanged from before,
  // just no longer reachable synchronously from this handler.
  if (ctx.userId) {
    await ctx.supabase.from("ai_tasks").insert({
      kind: "classify_image",
      line_user_id: ctx.userId,
      line_event_id: saved.id,
      media_path: mediaPath,
      status: "pending",
    })
    // Owner-reported bug (2026-07-26): real "..." typing indicator while
    // the local-AI queue processes, instead of silence.
    await ResponseGateway.showLoading(ctx.userId, 60)
  }
}
