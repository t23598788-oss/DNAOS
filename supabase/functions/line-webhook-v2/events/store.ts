// Single save point — every handler calls saveEvent(), never writes to line_events directly

import type { LineEvent } from "./types.ts"
import { fetchLineProfile } from "../engines/profile.ts"

export interface SaveEventInput {
  event: LineEvent
  userId: string | null
  groupId: string | null
  rawType: string
  rawText: string
  extracted?: Record<string, unknown>
  status?: string
}

export interface SavedEvent {
  id: string
  duplicate?: boolean
}

export async function saveEvent(
  supabase: any,
  input: SaveEventInput
): Promise<SavedEvent | null> {
  // LINE redelivers webhooks on any timeout/network hiccup — webhookEventId
  // is LINE's own idempotency key, present on every event type (unlike
  // message.id, which only exists on "message" events). Owner-reported bug
  // 2026-07-10: bot repeated the same reply to a customer ("แผ่นเสียงตกร่อง")
  // because a redelivered webhook was processed as if it were new.
  const webhookEventId = (input.event as any).webhookEventId ?? null
  if (webhookEventId) {
    const { data: existing } = await supabase
      .from("line_events")
      .select("id")
      .eq("line_webhook_event_id", webhookEventId)
      .limit(1)
      .maybeSingle()
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

  const { data, error } = await supabase
    .from("line_events")
    .insert({
      line_user_id:     input.userId,
      group_id:         input.groupId,
      raw_type:         input.rawType,
      raw_text:         input.rawText,
      reply_token:      (input.event as any).replyToken ?? null,
      line_message_id:  (input.event as any).message?.id ?? null,
      line_webhook_event_id: webhookEventId,
      event_timestamp:  new Date(input.event.timestamp).toISOString(),
      status:           input.status ?? "new",
      extracted:        input.extracted ?? null,
      raw_json:         input.event as unknown as Record<string, unknown>,
      line_name:        lineName,
      line_picture:     linePicture,
      admin_note:       profileError ? `[profile fetch failed] ${profileError}` : null,
    })
    .select("id")
    .single()

  if (error) {
    console.error("[store] saveEvent failed:", error.message)
    return null
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
