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
    // Avatar URL dynamic sync (owner request): always re-fetch the real
    // LINE profile on every inbound message so a changed pictureUrl is
    // picked up, instead of freezing the first-seen avatar forever. Fall
    // back to the last known stored identity only if the fetch fails.
    const { data: known } = await supabase
      .from("line_events")
      .select("line_name, line_picture")
      .eq("line_user_id", input.userId)
      .not("line_name", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then((r: any) => r, () => ({ data: null }))

    const profile = await fetchLineProfile(input.userId)
    if (profile && (profile.displayName || profile.pictureUrl)) {
      lineName = profile.displayName ?? known?.line_name ?? null
      linePicture = profile.pictureUrl ?? known?.line_picture ?? null
      profileError = profile.error ?? null
    } else {
      lineName = known?.line_name ?? null
      linePicture = known?.line_picture ?? null
      profileError = profile?.error ?? null
    }
  }

  // Dynamic avatar sync to partner_channel_bindings (LINE identity) — upsert so a
  // changed pictureUrl propagates on every inbound message. Run BEFORE the
  // line_events insert so Supabase Realtime (which fires on the insert) reads
  // the already-updated binding/avatar when refreshing the admin UI.
  // Also resolve/create the Master ID (core_identities) and provider account
  // so Layer 1/2 stay in sync on every inbound event.
  if (input.userId) {
    try {
      const { data: coreIdentityId } = await supabase
        .rpc("resolve_or_create_core_identity", {
          p_provider: "LINE",
          p_provider_user_id: input.userId,
          p_display_name: lineName,
          p_avatar_url: linePicture,
        })
        .then((r: { data: unknown }) => r, () => ({ data: null }))

      let providerAccountId: string | null = null
      if (coreIdentityId) {
        const { data: pa } = await supabase
          .from("identity_provider_accounts")
          .select("id")
          .eq("provider", "LINE")
          .eq("provider_user_id", input.userId)
          .maybeSingle()
          .then((r: { data: { id: string } | null }) => r, () => ({ data: null }))
        providerAccountId = pa?.id ?? null
      }

      const upsertPayload: Record<string, unknown> = {
        channel_type: "LINE",
        channel_user_id: input.userId,
        display_name: lineName,
        avatar_url: linePicture,
        last_seen_at: new Date().toISOString(),
      }
      if (coreIdentityId) upsertPayload.core_identity_id = coreIdentityId
      if (providerAccountId) upsertPayload.provider_account_id = providerAccountId

      await supabase.from("partner_channel_bindings").upsert(
        upsertPayload,
        { onConflict: "channel_type,channel_user_id" },
      )
    } catch (e) {
      console.error("[store] channel binding upsert failed:", (e as Error).message)
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
