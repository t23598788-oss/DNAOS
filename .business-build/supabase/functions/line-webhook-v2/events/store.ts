// Single save point — every handler calls saveEvent(), never writes to line_events directly

import type { LineEvent } from "./types.ts"
import { fetchLineProfile } from "../engines/profile.ts"
import { bufferEvent, flushBufferedEvents } from "../engines/local-event-buffer.ts"

export interface SaveEventInput {
  event: LineEvent
  userId: string | null
  groupId: string | null
  rawType: string
  rawText: string
  extracted?: Record<string, unknown>
  status?: string
  // Which LINE account received this event (webhook payload.destination) —
  // persisted under extracted.channel_destination (additive jsonb key, no
  // schema change) so line_events can separate accounts retrospectively.
  // See HandlerContext.channelDestination in types.ts.
  channelDestination?: string | null
}

export interface SavedEvent {
  id: string
  duplicate?: boolean
  buffered?: boolean
}

export async function saveEvent(
  supabase: any,
  input: SaveEventInput
): Promise<SavedEvent | null> {
  // Local Event Buffer — Auto-Sync (owner, 2026-07-30): opportunistic flush
  // at the start of every real request, so recovery doesn't require a
  // human to notice and trigger it manually. Cheap no-op when nothing is
  // buffered. Never allowed to block/fail this request — a flush attempt
  // failing (DB still down) is expected, not an error worth surfacing here.
  await flushBufferedEvents(supabase).catch(() => {})

  // LINE redelivers webhooks on any timeout/network hiccup — webhookEventId
  // is LINE's own idempotency key, present on every event type (unlike
  // message.id, which only exists on "message" events). Owner-reported bug
  // 2026-07-10: bot repeated the same reply to a customer ("แผ่นเสียงตกร่อง")
  // because a redelivered webhook was processed as if it were new.
  //
  // Non-Blocking Execution (owner, 2026-07-30): if the DB itself is
  // unreachable, this dup-check can't run either — that's fine, treat it as
  // "not a known duplicate" and continue rather than failing the whole
  // request over a nice-to-have check.
  const webhookEventId = (input.event as any).webhookEventId ?? null
  if (webhookEventId) {
    const { data: existing } = await supabase
      .from("line_events")
      .select("id")
      .eq("line_webhook_event_id", webhookEventId)
      .limit(1)
      .maybeSingle()
      .then((r: any) => r, () => ({ data: null }))
    if (existing) {
      return { id: existing.id, duplicate: true }
    }
  }

  let lineName: string | null = null
  let linePicture: string | null = null
  let profileError: string | null = null

  if (input.userId) {
    // Do we already know this contact's identity (name AND picture) from a
    // previous event? Name-only isn't "fully known" — LINE occasionally
    // returns a profile with displayName but no pictureUrl yet (propagation
    // lag), and we don't want that partial result to permanently block future
    // retries for the picture.
    const { data: known } = await supabase
      .from("line_events")
      .select("line_name, line_picture")
      .eq("line_user_id", input.userId)
      .not("line_name", "is", null)
      .not("line_picture", "is", null)
      .limit(1)
      .maybeSingle()

    if (known) {
      lineName = known.line_name
      linePicture = known.line_picture
    } else {
      // Either never seen this user, or seen them but still missing a
      // picture — fetch their real profile again.
      const profile = await fetchLineProfile(input.userId)
      if (profile) {
        lineName = profile.displayName
        linePicture = profile.pictureUrl
        profileError = profile.error ?? null
      }
    }
  }

  // Channel audit (owner, 2026-10-07): merge the receiving account's id into
  // extracted as channel_destination — additive jsonb key, existing readers of
  // extracted (latitude/address/flex) are unaffected. When neither the
  // handler's extraction nor a destination exists, extracted stays null exactly
  // as before (no shape change for the old path).
  const channelDestination = input.channelDestination ?? null
  const extracted =
    input.extracted || channelDestination
      ? { ...(input.extracted ?? {}), ...(channelDestination ? { channel_destination: channelDestination } : {}) }
      : null

  const insertRow = {
    line_user_id:     input.userId,
    group_id:         input.groupId,
    raw_type:         input.rawType,
    raw_text:         input.rawText,
    reply_token:      (input.event as any).replyToken ?? null,
    line_message_id:  (input.event as any).message?.id ?? null,
    line_webhook_event_id: webhookEventId,
    event_timestamp:  new Date(input.event.timestamp).toISOString(),
    status:           input.status ?? "new",
    extracted,
    raw_json:         input.event as unknown as Record<string, unknown>,
    line_name:        lineName,
    line_picture:     linePicture,
    admin_note:       profileError ? `[profile fetch failed] ${profileError}` : null,
  }

  let data: { id: string } | null = null
  let error: { message: string } | null = null
  try {
    const result = await supabase.from("line_events").insert(insertRow).select("id").single()
    data = result.data
    error = result.error
  } catch (e) {
    error = { message: (e as Error).message }
  }

  if (error) {
    // Local Event Buffer (owner, 2026-07-30): DB unreachable — buffer
    // instead of dropping, so the webhook can still reply to the customer
    // immediately and nothing is lost. flushBufferedEvents() (called
    // opportunistically above, and on a schedule) drains this back into
    // the real table once the DB is reachable again.
    console.error("[store] saveEvent failed, buffering locally:", error.message)
    const bufferId = await bufferEvent(insertRow).catch((bufErr) => {
      console.error("[store] buffering itself failed:", (bufErr as Error).message)
      return null
    })
    if (!bufferId) return null
    return { id: bufferId, buffered: true }
  }
  return data as SavedEvent
}

export async function markEventProcessed(
  supabase: any,
  eventId: string,
  adminNote?: string
): Promise<void> {
  await supabase
    .from("line_events")
    .update({ status: "processed", admin_note: adminNote ?? null })
    .eq("id", eventId)
}

export async function markEventError(
  supabase: any,
  eventId: string,
  note: string
): Promise<void> {
  await supabase
    .from("line_events")
    .update({ status: "error", admin_note: note })
    .eq("id", eventId)
}
