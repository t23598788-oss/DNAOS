import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { buildEventFromMessages, generateEventCode } from "@/engines/events/event-builder"
import { tryAutoCreateJob, composeMissingInfoMessage, type AutoCreateEventInput } from "@/engines/jobs/auto-create"
import {
  BUSINESS_EVENT_STATES,
  createBusinessEvent,
  enrichBusinessEvent,
  transitionBusinessEvent,
} from "@/engines/canonical/event-write"
import { gateResponse, httpStatusForCode, preWriteCheck } from "@/services/ai/traceContract"
type Params = { params: Promise<{ lineUserId: string }> }

/** The provider this admin screen acts on — a value, never a branch. */
const PROVIDER = "line"

// Turns a LINE contact's not-yet-eventized messages into one business_events
// row — the Event Builder step of the message-centric → event-centric bridge
// (owner's direction 2026-07-10). Confirmed write (admin-triggered click),
// not automatic — matches Rule 72.
//
// Immediately after, tries to auto-open a real Job from that event — no
// admin has to fill in a form (owner instruction 2026-07-10: "ไม่ต้องให้คน
// มานั่งสร้างงานเอง"). If something real is missing, this used to push a
// LINE message to the customer automatically — real incident 2026-07-24:
// an ambiguous debt-conversation cluster got misclassified as a material
// order, and the auto-sent "ส่งชนิดวัสดุ..." question went out 3 times (the
// awaiting_info status is deliberately excluded from "already linked" below
// so a reply can merge into the same event — which also means every repeat
// click on an unresolved event re-fires the same auto-send). Fixed: this
// route no longer sends anything itself. It returns pendingReply — the
// admin reviews/edits it in the existing reply box and sends it themselves
// via /reply, same real preview-before-send principle as send-debt.
//
// If this contact already has an event sitting in "awaiting_info" (we asked
// them something and they haven't answered yet), new messages are treated
// as the ANSWER and merged into that same event instead of spawning a
// disconnected new one — owner-reported bug 2026-07-10: a reply like
// "ทรายหยาบ" was creating a brand new unrelated event instead of completing
// the one that asked "ทราย ชนิดไหนครับ".

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

  // Trace starts here, at the request boundary, and follows the call to the
  // gateway, the adapter, the canonical write and this response (2026-10-20).
  const result = await buildEventFromMessages(messagesForBuilder, {
    origin: "api/admin/line-customers/build-event",
    ownerId: auth.email,
    sessionId: lineUserId,
    traceId: crypto.randomUUID(),
  })
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

  // Capability D — field census result: the AI extraction result is NOT passed
  // as a row patch. Every field is mapped explicitly into the canonical writer's
  // typed input; `updated_at` is owned by the writer.
  //   OMITTED + REPORTED: `metadata` (rowData set it to the SAME value as
  //   `context`, i.e. redundant; metadata now carries canonical provenance
  //   written_by/source_provider, which a blind copy would erase).
  const eventDate = new Date().toISOString().slice(0, 10)
  const enrichFields = {
    event_type: event.event_type ?? "line_chat",
    title,
    description,
    partner_id: partnerId,
    material_id: materialId,
    material_text: event.material_text ?? null,
    quantity: event.quantity ?? null,
    quantity_unit: event.quantity_unit ?? null,
    destination: event.destination ?? null,
    schedule_text: event.schedule_text ?? null,
    contact_name: event.contact_name ?? null,
    contact_phone: event.contact_phone ?? null,
    context: event.context ?? null,
    confidence: event.confidence ?? null,
    source_message_ids: combinedMessageIds,
  }

  // Pre-write safety gate (2026-10-20): every check runs BEFORE any canonical writer.
  // A block returns here, so the writer is never called and nothing is written.
  const traceId = String(event.context.trace_id ?? "")
  const preWrite = preWriteCheck({
    traceId,
    authenticatedOwner: auth.email ?? null,
    requestOwner: auth.email,
    schemaValid: true,
    sourceRefs: combinedMessageIds,
    alreadyLinkedRefs: Array.from(linkedIds),
    status: event.status,
    allowedStatuses: BUSINESS_EVENT_STATES,
  })
  if (!preWrite.ok) {
    return NextResponse.json(
      { error: preWrite.reason, code: preWrite.code, traceId },
      { status: httpStatusForCode(preWrite.code) },
    )
  }

  let inserted: AutoCreateEventInput | null = null
  let insertedStatus: string | null = null
  let insertError: { message: string } | null = null
  // Id of the row the writer reported as written (create or enrich target).
  let writtenId: string | null = null
  // Enrich succeeded but the state transition failed: fields changed, state did not.
  let partialWrite = false
  const actor = auth.email ?? auth.id ?? "admin"

  if (awaitingEvent) {
    // Merge path — same business effect as the pre-cutover single UPDATE, split
    // into its real meanings: ENRICH (allow-listed fields) then TRANSITION to
    // the extracted target state (target-only; no FROM→TO rule is invented here).
    const enriched = await enrichBusinessEvent(db, { eventId: awaitingEvent.id, fields: enrichFields, actor })
    if (!enriched.ok) {
      insertError = { message: enriched.error ?? "event enrich failed" }
    } else {
      writtenId = awaitingEvent.id
      if (event.status) {
        const moved = await transitionBusinessEvent(db, { eventId: awaitingEvent.id, to: event.status, actor })
        if (!moved.ok) {
          insertError = { message: moved.error ?? "event transition failed" }
          partialWrite = true
        }
      }
    }
    if (!insertError) {
      const { data: readBack } = await db.from("business_events").select("*").eq("id", awaitingEvent.id).single()
      inserted = (readBack ?? null) as AutoCreateEventInput | null
      insertedStatus = (readBack as { status?: string | null } | null)?.status ?? null
    }
  } else {
    const { count } = await db
      .from("business_events")
      .select("id", { count: "exact", head: true })
      .gte("created_at", eventDate)
    const eventCode = generateEventCode((count ?? 0) + 1)
    const created = await createBusinessEvent(db, {
      eventCode,
      eventDate,
      eventType: event.event_type ?? "line_chat",
      title,
      description,
      source: { provider: PROVIDER, externalSubjectId: lineUserId, messageIds: combinedMessageIds },
      partnerId,
      materialId,
      materialText: event.material_text ?? null,
      quantity: event.quantity ?? null,
      quantityUnit: event.quantity_unit ?? null,
      destination: event.destination ?? null,
      scheduleText: event.schedule_text ?? null,
      contactName: event.contact_name ?? null,
      contactPhone: event.contact_phone ?? null,
      status: event.status,
      context: event.context ?? null,
      confidence: event.confidence ?? null,
      actor: auth.email ?? auth.id ?? "admin",
    })
    if (!created.ok) {
      insertError = { message: created.error ?? "event create failed" }
    } else {
      writtenId = created.data?.id ?? null
      const { data: readBack } = await db.from("business_events").select("*").eq("id", created.data!.id).single()
      inserted = (readBack ?? null) as AutoCreateEventInput | null
      insertedStatus = created.data?.status ?? null
    }
  }

  // Post-write outcome, stated truthfully. Nothing here is rolled back or retried.
  //   partial write  -> UNCONFIRMED (409): fields changed, state not moved
  //   writer failed  -> FAILED (500): nothing claimed
  //   readback gone  -> UNCONFIRMED (409): the writer said ok, readback cannot prove it
  if (partialWrite) {
    return NextResponse.json(
      { error: insertError?.message ?? "partial write", code: "CANONICAL_PARTIAL_WRITE", status: "UNCONFIRMED", recordId: writtenId, traceId },
      { status: 409 },
    )
  }
  if (insertError) {
    return NextResponse.json(
      { error: insertError.message, code: "CANONICAL_WRITE_FAILED", status: "FAILED", traceId },
      { status: 500 },
    )
  }
  if (!inserted) {
    return NextResponse.json(
      { error: "canonical readback failed", code: "CANONICAL_UNCONFIRMED", status: "UNCONFIRMED", recordId: writtenId, traceId },
      { status: 409 },
    )
  }

  // Response gate (2026-10-20): the canonical row is read back and must carry this
  // request's trace id and owner. The AI never asserts success itself — only the
  // canonical readback decides. A mismatch blocks the response with the trace id.
  // readBack is the canonical row (select *), so its context column is present at runtime.
  const writtenContext = ((inserted as unknown as { context?: Record<string, unknown> | null }).context ?? {}) as Record<string, unknown>
  const writtenProvenance = (writtenContext.provenance ?? {}) as { ownerId?: string }
  const gate = gateResponse({
    traceId,
    ownerId: auth.email,
    schemaValid: true,
    evidenceRecorded: Boolean(traceId),
    claimsOutcome: true,
    canonical: {
      ok: true,
      recordId: String(inserted.id),
      ownerId: writtenProvenance.ownerId ?? null,
      traceId: (writtenContext.trace_id as string | undefined) ?? null,
    },
  })
  if (!gate.allowed) {
    return NextResponse.json({ error: gate.reason, code: gate.code, traceId: gate.traceId }, { status: 409 })
  }

  // Only requests that actually need a Job get the auto-create attempt —
  // general questions ("สอบถามทั่วไป") don't need one.
  let autoJob: Awaited<ReturnType<typeof tryAutoCreateJob>> | null = null
  let pendingReply: string | null = null
  if (insertedStatus === "quotation_pending") {
    autoJob = await tryAutoCreateJob(db, inserted)
    if (autoJob.status === "needs_info") {
      // Not sent automatically (2026-07-24 fix) — the caller shows this in
      // the existing reply box for the admin to review/edit/send, or ignore
      // entirely if the classification itself was wrong (e.g. this cluster
      // wasn't actually a material request).
      pendingReply = composeMissingInfoMessage(autoJob)
      await transitionBusinessEvent(db, { eventId: String(inserted.id), from: "quotation_pending", to: "awaiting_info", actor })
    } else if (autoJob.status === "ready_to_quote") {
      await transitionBusinessEvent(db, { eventId: String(inserted.id), from: "quotation_pending", to: "ready_to_quote", actor })
    }
  }

  return NextResponse.json({ event: inserted, autoJob, pendingReply })
}
