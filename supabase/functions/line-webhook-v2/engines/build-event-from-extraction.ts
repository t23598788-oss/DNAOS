// Local-AI pipeline (owner, 2026-07-25): the business-event-building logic
// from auto-build-event.ts, extracted so it can run from the ai-callback
// path too — extraction itself (reading a message cluster, pulling out
// material/quantity/destination) now happens on the owner's Mac via Ollama
// (ai-task-watcher.mjs), matching the same JSON schema auto-build-event.ts
// used to ask Claude for. This function is the one place the resulting
// business_events insert + awaiting_info handoff happens, not duplicated.
import { tryCompleteAwaitingEvent, type FollowupReply } from "./event-followup.ts"
import { sendConnectEventCommand, CONNECT_PROVIDER } from "../../_shared/connect-event.ts"

export interface ExtractedEvent {
  event_type: string
  material_text: string | null
  quantity: number | null
  quantity_unit: string | null
  destination: string | null
  schedule_text: string | null
  contact_name: string | null
  contact_phone: string | null
  status: string | null
  confidence: number | null
}

export async function buildEventFromExtraction(
  supabase: any,
  params: { userId: string; extracted: ExtractedEvent; sourceMessageIds: string[] },
): Promise<FollowupReply | null> {
  const { userId, extracted, sourceMessageIds } = params
  if (!extracted?.event_type) return null
  if (extracted.event_type === "อื่นๆ" && !extracted.material_text) return null

  const { data: link } = await supabase
    .from("company_line_links").select("company_id").eq("line_user_id", userId).maybeSingle()
  const partnerId = link?.company_id ?? null

  const { count } = await supabase
    .from("business_events").select("id", { count: "exact", head: true })
    .gte("created_at", new Date().toISOString().slice(0, 10))
  const yy = new Date().getFullYear().toString().slice(-2)
  const mm = String(new Date().getMonth() + 1).padStart(2, "0")
  const dd = String(new Date().getDate()).padStart(2, "0")
  const eventCode = `EV${yy}${mm}${dd}-${String((count ?? 0) + 1).padStart(4, "0")}`

  const title = [extracted.material_text, extracted.quantity ? `${extracted.quantity} ${extracted.quantity_unit ?? ""}`.trim() : null]
    .filter(Boolean).join(" ") || extracted.event_type || "เหตุการณ์จาก LINE"

  // Capability D: created through the Connect transport → canonical event writer.
  const created = await sendConnectEventCommand("business_event.create", {
    event_code: eventCode,
    event_type: extracted.event_type,
    event_date: new Date().toISOString().slice(0, 10),
    title,
    source_provider: CONNECT_PROVIDER,
    source_external_subject_id: userId,
    source_message_ids: sourceMessageIds,
    partner_id: partnerId,
    material_text: extracted.material_text,
    quantity: extracted.quantity,
    quantity_unit: extracted.quantity_unit,
    destination: extracted.destination,
    schedule_text: extracted.schedule_text,
    contact_name: extracted.contact_name,
    contact_phone: extracted.contact_phone,
    status: extracted.status ?? "new",
    confidence: extracted.confidence ?? 0,
  }, `system:${CONNECT_PROVIDER}:build-event`)
  if (!created.ok) {
    console.error("[build-event-from-extraction] create failed:", created.error)
    return null
  }

  if (extracted.status !== "quotation_pending") return null

  // Proven transition (the guard above proves the from-state is quotation_pending).
  await sendConnectEventCommand("business_event.transition", {
    event_code: eventCode,
    from_status: "quotation_pending",
    status: "awaiting_info",
  }, `system:${CONNECT_PROVIDER}:build-event`)
  return await tryCompleteAwaitingEvent(supabase, userId, "")
}
