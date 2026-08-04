/**
 * Integration Gateway — Event Bus (owner, 2026-08-05).
 * The single door between Provider Adapters and DNA OS Core: every adapter
 * calls publish(event) with an already-normalized GatewayEvent, never
 * anything downstream directly. This does two real things, in order —
 * nothing simulated:
 *   1. in-process dispatch via the existing core/runtime/engine.dispatchEvent
 *      (so anything already listening on the real runtime event log sees it
 *      immediately, same as every other engine in this codebase)
 *   2. durable write to integration_gateway_events (evidence/store.ts)
 *
 * Observe Channel only for now (explicit instruction) — publish() rejects
 * any event whose channel isn't "observe" until Proposal/Execution are
 * built; see engines/integration-gateway/policy/gate.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { dispatchEvent } from "@/core/runtime/engine";
import { isGatewayEvent, type GatewayEvent } from "../contracts/event";
import { recordGatewayEvent } from "../evidence/store";
import { channelIsEnabled } from "../policy/gate";

export interface PublishResult {
  ok: boolean;
  reason?: string;
}

export async function publish(db: SupabaseClient, event: GatewayEvent): Promise<PublishResult> {
  if (!isGatewayEvent(event)) {
    return { ok: false, reason: "malformed event — does not match GatewayEvent contract" };
  }
  if (!channelIsEnabled(event.channel)) {
    return { ok: false, reason: `channel '${event.channel}' is not enabled yet — Observe Channel only until Proposal/Execution are built` };
  }

  dispatchEvent(`gateway.${event.capability}`, `integration-gateway:${event.provider}`, event);

  const write = await recordGatewayEvent(db, event);
  if (!write.ok) return { ok: false, reason: write.error };

  return { ok: true };
}
