import type { CoreEventEnvelope } from "../../supabase/functions/_shared/core-event";

/** Enqueue normalized inbound events through the Cloudflare thin-edge ingress.
 * Only this request carries transient user message text; no credentials or raw
 * provider signature/body are included. */
export async function enqueueCoreEvents(events: CoreEventEnvelope[]): Promise<boolean> {
  if (!events.length) return true;
  const url = process.env.CORE_EVENTS_INGEST_URL;
  const secret = process.env.CORE_EVENTS_INGEST_SECRET;
  if (!url || !secret) return false;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-core-events-secret": secret },
      body: JSON.stringify({ events }),
      signal: AbortSignal.timeout(2500),
    });
    return response.ok;
  } catch {
    return false;
  }
}
