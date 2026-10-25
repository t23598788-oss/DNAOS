/**
 * Integration Gateway — Evidence Store (owner, 2026-08-05).
 * The one place that writes a GatewayEvent to integration_gateway_events.
 * Adapters never write to Supabase directly — they normalize a provider
 * payload into a GatewayEvent and hand it to the event bus, which calls
 * this after in-process dispatch.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GatewayEvent } from "../contracts/event";

export async function recordGatewayEvent(db: SupabaseClient, event: GatewayEvent): Promise<{ ok: boolean; error?: string }> {
  const { error } = await db.from("integration_gateway_events").upsert(
    {
      event_id: event.event_id,
      provider: event.provider,
      capability: event.capability,
      channel: event.channel,
      action: event.action,
      session_id: event.session_id,
      change_id: event.change_id,
      evidence: event.evidence,
      requested_effect: event.requested_effect,
      requires_owner_approval: event.requires_owner_approval,
      occurred_at: event.occurred_at,
    },
    { onConflict: "event_id" }
  );

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function recentGatewayEvents(db: SupabaseClient, limit = 50): Promise<GatewayEvent[]> {
  const { data } = await db
    .from("integration_gateway_events")
    .select("event_id, provider, capability, channel, action, session_id, change_id, evidence, requested_effect, requires_owner_approval, occurred_at")
    .order("occurred_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as GatewayEvent[];
}
