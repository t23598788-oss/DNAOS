import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { buildEventFromMessages, generateEventCode } from "@/engines/events/event-builder"
import { tryAutoCreateJob, composeMissingInfoMessage } from "@/engines/jobs/auto-create"
import { sendLineMessage } from "@/registry/communication"

type Params = { params: Promise<{ lineUserId: string }> }

// Turns a LINE contact's not-yet-eventized messages into one business_events
// row — the Event Builder step of the message-centric → event-centric bridge
// (owner's direction 2026-07-10). Confirmed write (admin-triggered click),
// not automatic — matches Rule 72.
//
// Immediately after, tries to auto-open a real Job from that event — no
// admin has to fill in a form (owner instruction 2026-07-10: "ไม่ต้องให้คน
// มานั่งสร้างงานเอง"). If something real is missing, it asks the customer
// directly on LINE for exactly that, never guesses.
//
// If this contact already has an event sitting in "awaiting_info" (we asked
// them something and they haven't answered yet), new messages are treated
// as the ANSWER and merged into that same event instead of spawning a
// disconnected new one — owner-reported bug 2026-07-10: a reply like
// "ทรายหยาบ" was creating a brand new unrelated event instead of completing
// the one that asked "ทราย ชนิดไหนครับ".

async function pushLineText(userId: string, text: string) {
  await sendLineMessage(userId, [{ type: "text", text }]).catch(() => {})
}

export async function POST(_req: Request, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { lineUserId } = await params
  const db = supabase()

  // Is there an unresolved event still waiting on a reply from this contact?
  // If so, new messages are the answer to THAT, not a fresh request.
  const { data: awaitingEvent } = await db
    .from("business_events")
    .select("id, source_message_ids")
    .eq("source_line_user_id", lineUserId)
    .eq("status", "awaiting_info")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: alreadyLinked } = await db
    .from("business_events")
    .select("source_message_ids")
    .eq("source_line_user_id", lineUserId)
    .neq("status", "awaiting_info")

  const linkedIds = new Set((alreadyLinked ?? []).flatMap((e) => e.source_message_ids ?? []))

  const { data: allMessages, error } = await db
    .from("line_events")
    .select("id, raw_text, raw_type, line_name, created_at")
    .eq("line_user_id", lineUserId)
    .order("created_at", { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const unlinked = (allMessages ?? []).filter((m) => !linkedIds.has(m.id))
  if (unlinked.length === 0) {
    return NextResponse.json({ error: "ไม่มีข้อความใหม่ที่ยังไม่ถูกสร้างเป็น Event" }, { status: 400 })
  }

  const lineName = unlinked.find((m) => m.line_name)?.line_name ?? allMessages?.find((m) => m.line_name)?.line_name ?? null

  // If merging into an awaiting event, feed the LLM the ORIGINAL messages
  // plus the new ones together, not just the new reply in isolation — "ทราย
  // หยาบ" on its own means nothing without the original "ทราย" request.
  const messagesForBuilder = awaitingEvent
    ? (allMessages ?? []).filter((m) => (awaitingEvent.source_message_ids ?? []).includes(m.id) || unlinked.some((u) => u.id === m.id))
    : unlinked

  const result = await buildEventFromMessages(messagesForBuilder)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 })

  const { event } = result

  // Direct link first (company_line_links — a person can have more than one
  // LINE account) — only fall back to exact name match if no direct link.
  let partnerId: string | null = null
  const { data: link } = await db.from("company_line_links").select("company_id").eq("line_user_id", lineUserId).maybeSingle()
  if (link) {
    partnerId = link.company_id
  } else if (lineName) {
    const { data: company } = await db.from("companies").select("id").eq("name", lineName).maybeSingle()
    partnerId = company?.id ?? null
  }

  let materialId: string | null = null
  if (event.material_text) {
    const { data: materials } = await db.from("material_types").select("id, name")
    const match = (materials ?? []).find(
      (m) => event.material_text!.includes(m.name) || m.name.includes(event.material_text!)
    )
    materialId = match?.id ?? null
  }

  const title = [event.material_text, event.quantity ? `${event.quantity} ${event.quantity_unit ?? ""}`.trim() : null]
    .filter(Boolean)
    .join(" ") || event.event_type || "เหตุการณ์จาก LINE"
  const description = [event.destination ? `ส่งที่ ${event.destination}` : null, event.schedule_text ? `กำหนด ${event.schedule_text}` : null]
    .filter(Boolean)
    .join(" · ") || null

  const combinedMessageIds = awaitingEvent
    ? [...new Set([...(awaitingEvent.source_message_ids ?? []), ...unlinked.map((m) => m.id)])]
    : unlinked.map((m) => m.id)

  const rowData = {
    event_type: event.event_type ?? "line_chat",
    title,
    description,
    metadata: event.context,
    source_line_user_id: lineUserId,
    source_message_ids: combinedMessageIds,
    partner_id: partnerId,
    material_id: materialId,
    material_text: event.material_text,
    quantity: event.quantity,
    quantity_unit: event.quantity_unit,
    destination: event.destination,
    schedule_text: event.schedule_text,
    contact_name: event.contact_name,
    contact_phone: event.contact_phone,
    status: event.status,
    context: event.context,
    confidence: event.confidence,
    updated_at: new Date().toISOString(),
  }

  let inserted
  let insertError
  if (awaitingEvent) {
    ;({ data: inserted, error: insertError } = await db
      .from("business_events").update(rowData).eq("id", awaitingEvent.id).select().single())
  } else {
    const { count } = await db
      .from("business_events")
      .select("id", { count: "exact", head: true })
      .gte("created_at", new Date().toISOString().slice(0, 10))
    const eventCode = generateEventCode((count ?? 0) + 1)
    ;({ data: inserted, error: insertError } = await db
      .from("business_events")
      .insert({ ...rowData, event_code: eventCode, event_date: new Date().toISOString().slice(0, 10) })
      .select().single())
  }

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })

  // Only requests that actually need a Job get the auto-create attempt —
  // general questions ("สอบถามทั่วไป") don't need one.
  let autoJob: Awaited<ReturnType<typeof tryAutoCreateJob>> | null = null
  if (inserted.status === "quotation_pending") {
    autoJob = await tryAutoCreateJob(db, inserted)
    if (autoJob.status === "needs_info") {
      await pushLineText(lineUserId, composeMissingInfoMessage(autoJob))
      await db.from("business_events").update({ status: "awaiting_info" }).eq("id", inserted.id)
    } else if (autoJob.status === "ready_to_quote") {
      await db.from("business_events").update({ status: "ready_to_quote" }).eq("id", inserted.id)
    }
  }

  return NextResponse.json({ event: inserted, autoJob })
}
