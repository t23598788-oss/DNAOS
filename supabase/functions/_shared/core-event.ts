/** Provider-neutral event envelope for the DNA OS core queue (schema 1.0.0).
 *
 * Public messages may arrive before their sender is mapped to a tenant, so
 * tenant_id is explicitly nullable. `data` contains normalized, actionable
 * fields only; provider raw bodies, signatures, and credentials never enter
 * the queue.
 */
export interface CoreEventEnvelope {
  event_id: string;
  idempotency_key: string;
  schema_version: "1.0.0";
  event_type: string;
  source: string;
  source_event_id: string | null;
  tenant_id: string | null;
  actor: { type: "provider" | "user" | "system" | "driver"; id: string | null };
  correlation: {
    parent_event_id?: string | null;
    order_id?: string | null;
    reservation_id?: string | null;
    trip_id?: string | null;
    financial_command_id?: string | null;
  };
  occurred_at: string;
  recorded_at: string;
  data: Record<string, unknown>;
}

export function isCoreEventEnvelope(value: unknown): value is CoreEventEnvelope {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  const actor = event.actor;
  const correlation = event.correlation;
  const actorValid = !!actor && typeof actor === "object" &&
    ["provider", "user", "system", "driver"].includes((actor as Record<string, unknown>).type as string) &&
    (typeof (actor as Record<string, unknown>).id === "string" || (actor as Record<string, unknown>).id === null);
  return event.schema_version === "1.0.0" &&
    typeof event.event_id === "string" &&
    typeof event.idempotency_key === "string" &&
    typeof event.event_type === "string" &&
    typeof event.source === "string" &&
    (typeof event.source_event_id === "string" || event.source_event_id === null) &&
    (typeof event.tenant_id === "string" || event.tenant_id === null) &&
    actorValid &&
    !!correlation && typeof correlation === "object" && !Array.isArray(correlation) &&
    typeof event.occurred_at === "string" &&
    typeof event.recorded_at === "string" &&
    !!event.data && typeof event.data === "object" && !Array.isArray(event.data);
}
