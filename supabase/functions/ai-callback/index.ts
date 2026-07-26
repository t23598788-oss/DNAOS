// Local-AI pipeline callback (owner, 2026-07-25): the owner's Mac
// (ai-task-watcher.mjs, outside this repo's Deno runtime) does the actual
// AI work locally via Ollama — this endpoint is deliberately "dumb wiring
// only": no LLM calls here, just take the already-computed result and run
// the same real business logic/DB writes/LINE push that used to happen
// synchronously inside the webhook when ANTHROPIC_API_KEY was assumed to
// work (confirmed dead in production — see handlers/text.ts, handlers/
// image.ts). Auth via a shared secret, same pattern as the existing cron
// endpoints (DEBT_REMINDER_CRON_SECRET etc.) — this is called by a script
// on the owner's own machine, not by LINE.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4"
import { processClassifiedImage } from "../line-webhook-v2/engines/process-classified-image.ts"
import { ResponseGateway } from "../line-webhook-v2/engines/response.ts"
import { buildEventFromExtraction } from "../line-webhook-v2/engines/build-event-from-extraction.ts"
import { completeAfterMaterialResolved } from "../line-webhook-v2/engines/event-followup.ts"

// Owner instruction (2026-07-26): "จัดระเบียบเป็นการ์ดที่ LINE มีไว้ให้" —
// send each Flex card (real price quote) as its own message when present;
// falls back to plain text when there's nothing structured to show (a
// clarifying question, an error, etc.).
async function pushReply(userId: string, reply: { text: string; flex?: object[] } | null) {
  if (!reply) return
  if (reply.flex?.length) {
    for (const card of reply.flex) {
      await ResponseGateway.pushFlex(userId, reply.text.slice(0, 100) || "ใบเสนอราคา", card)
    }
    return
  }
  await ResponseGateway.pushMessage(userId, reply.text)
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-callback-secret",
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS })

  const expectedSecret = Deno.env.get("AI_CALLBACK_SECRET")
  const providedSecret = req.headers.get("x-callback-secret")
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return new Response("Unauthorized", { status: 401, headers: CORS })
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  )

  let body: any
  try {
    body = await req.json()
  } catch {
    return new Response("Bad JSON", { status: 400, headers: CORS })
  }

  const { taskId } = body
  const { data: task } = await supabase.from("ai_tasks").select("*").eq("id", taskId).maybeSingle()
  if (!task) return new Response("Task not found", { status: 404, headers: CORS })
  if (task.status !== "pending") {
    return new Response(JSON.stringify({ ok: true, note: "already processed" }), { status: 200, headers: CORS })
  }

  try {
    if (task.kind === "classify_image") {
      await processClassifiedImage(supabase, {
        classified: body.classified ?? null,
        mediaPath: task.media_path,
        lineEventId: task.line_event_id,
        userId: task.line_user_id,
      })
    } else if (task.kind === "resolve_material") {
      // Owner instruction (2026-07-26): deterministic substring matching
      // couldn't resolve a material name — local Ollama picked the closest
      // real match from the actual material_types list (closed-set, never
      // invented). body.resolvedMaterialName is null if even the LLM found
      // no real match, in which case we ask honestly instead of guessing.
      const reply = body.resolvedMaterialName
        ? await completeAfterMaterialResolved(supabase, task.line_user_id, task.business_event_id, body.resolvedMaterialName)
        : { text: "ขอโทษครับ ไม่แน่ใจว่าหมายถึงวัสดุอะไร รบกวนพิมพ์ชื่อวัสดุที่ต้องการอีกครั้งได้ไหมครับ" }
      await pushReply(task.line_user_id, reply)
    } else if (task.kind === "handle_text") {
      // Structured extraction (owner, 2026-07-25) — local Ollama tried to
      // pull a real business event (material/quantity/destination/schedule)
      // out of this message cluster, same schema auto-build-event.ts used
      // to ask Claude for. A real extraction takes priority: it creates the
      // actual business_events row a quote gets built from, which a purely
      // conversational reply never did.
      let handledByExtraction = false
      if (body.extractedEvent && Array.isArray(body.sourceMessageIds)) {
        const eventReply = await buildEventFromExtraction(supabase, {
          userId: task.line_user_id,
          extracted: body.extractedEvent,
          sourceMessageIds: body.sourceMessageIds,
        })
        if (eventReply) {
          await pushReply(task.line_user_id, eventReply)
          handledByExtraction = true
        }
      }

      const replyText: string | undefined = body.replyText
      if (!handledByExtraction && replyText) {
        await ResponseGateway.pushMessage(task.line_user_id, replyText)
      }
      if (body.updatedMemoryNotes) {
        // Two different kinds of "knowing a customer" (owner, 2026-07-25):
        // `notes` is AI-written impression, message_count/avg_response_gap_
        // minutes/last_message_at are real computed facts from real
        // timestamps (see ai-task-watcher.mjs's computeRealSignals) — never
        // conflated, both stored, only the computed columns are trusted as
        // fact.
        await supabase.from("line_customer_memory").upsert({
          line_user_id: task.line_user_id,
          notes: body.updatedMemoryNotes,
          message_count: body.messageCount ?? 0,
          avg_response_gap_minutes: body.avgResponseGapMinutes ?? null,
          last_message_at: body.lastMessageAt ?? null,
          updated_at: new Date().toISOString(),
        })
      }
    }

    await supabase.from("ai_tasks")
      .update({ status: "done", result: body, processed_at: new Date().toISOString() })
      .eq("id", taskId)

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS })
  } catch (err) {
    await supabase.from("ai_tasks")
      .update({ status: "failed", error: String(err), processed_at: new Date().toISOString() })
      .eq("id", taskId)
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500, headers: CORS })
  }
})
