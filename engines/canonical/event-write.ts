/**
 * DNA OS — canonical Business Event writer (capability D, owner decision D5, 2026-09-23).
 *
 * THE single authority for every mutation of public.business_events. Nothing
 * else — no provider function, no Next route, no business engine — writes that
 * table directly after the cutover; the census test proves it.
 *
 * What this file refuses to be (the owner's explicit warning):
 *   - not a wrapper that lets a provider keep controlling DB semantics:
 *     callers pass a CANONICAL COMMAND (typed input below), never a row shape
 *   - no caller-supplied object is spread into the insert/update
 *   - no caller picks which columns change: the allow-list lives here
 *
 * Commands:
 *   createBusinessEvent            — CREATE EVENT (+ canonical source reference)
 *   transitionBusinessEvent        — UPDATE EVENT STATE (validated target state)
 *   enrichBusinessEvent            — BUSINESS METADATA (allow-listed fields only)
 *   linkBusinessEventTransaction   — ASSIGN CANONICAL IDENTITY (event → transaction)
 *
 * Legacy provider-shaped columns (source_line_user_id / source_message_ids) are
 * a temporary compatibility mapping INSIDE this writer: the canonical input is a
 * provider-neutral source reference, and those column names never appear in a
 * caller's contract. Physical generalization is P7.
 *
 * NOT a financial authority: quoted_amount is event business data only, exactly
 * as the pre-cutover behaviour was. This writer never touches allocations,
 * payments, debt, ledger or reconciliation (that stays B-04's authority).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Every state the pre-cutover code actually writes (source-verified vocabulary). */
export const BUSINESS_EVENT_STATES: readonly string[] = [
  "created",
  "awaiting_info",
  "ready_to_quote",
  "quotation_pending",
  "quoted",
  "confirmed",
  "awaiting_payment_date",
  "awaiting_payment",
  "payment_confirmed",
  "job_created",
  "cancelled",
  "processed",
  // Added from source evidence (not invented): payment-instructions.ts:126
  // inserts a payment-instruction event with status "sent".
  "sent",
  // Added from source evidence: build-event-from-extraction.ts:58 writes
  // `status: extracted.status ?? "new"` when the extraction has no status yet.
  "new",
];

/**
 * Only transitions the source PROVES — the reader filtered on the from-state and
 * then wrote the to-state. Absence of an entry means the from-state is not
 * provable from source: behaviour is preserved rather than a rule invented,
 * exactly as the owner instructed.
 */
const PROVEN_TRANSITIONS: Record<string, readonly string[]> = {
  awaiting_payment: ["payment_confirmed"],
  awaiting_payment_date: ["confirmed"],
  // Proven by build-event/route.ts: the post-create branch is only entered when
  // the just-written event's status is exactly "quotation_pending", so both
  // writes below are genuinely from quotation_pending.
  quotation_pending: ["awaiting_info", "ready_to_quote"],
};

/** Fields a caller may set (enrichment) — nothing else can reach the table. */
const ENRICHABLE_FIELDS: readonly string[] = [
  "material_text",
  "destination",
  "schedule_text",
  "contact_name",
  "contact_phone",
  "quantity",
  "quantity_unit",
  "confidence",
  "context",
  "quoted_amount",
  "material_id",
  "partner_id",
  "title",
  "description",
  "event_date",
  "event_type_code",
  "source_message_ids",
  // Added from source evidence: build-event/route.ts's merge path writes these
  // when new messages complete an awaiting_info event.
  "event_type",
  "metadata",
];

export interface BusinessEventSource {
  /** Provider id this event came from (e.g. "line") — a value, never a branch. */
  provider: string;
  /** The provider subject id (external identity), resolved via Connect identity. */
  externalSubjectId: string | null;
  /** Canonical references to inbound evidence, not provider payloads. */
  messageIds?: string[];
}

export interface WriteResult<T = Record<string, unknown>> {
  ok: boolean;
  error?: string;
  data?: T;
}

const num = (v: unknown): number | null => (v === undefined || v === null || v === "" ? null : Number(v));

export interface CreateBusinessEventInput {
  eventCode: string;
  eventType: string | null;
  eventDate: string;
  title: string;
  description?: string | null;
  source: BusinessEventSource;
  partnerId?: string | null;
  materialId?: string | null;
  materialText?: string | null;
  quantity?: number | null;
  quantityUnit?: string | null;
  destination?: string | null;
  scheduleText?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  status?: string;
  context?: Record<string, unknown> | null;
  confidence?: number | null;
  metadata?: Record<string, unknown>;
  actor: string;
}

/**
 * THE one canonical created-event row shape. Exported PURE so every adjacent
 * recorder (e.g. transport driver-workflow, which must record through this
 * authority instead of inserting directly) hands the EXACT same row shape
 * through the writer — never rebuilds a shadow of it (no second row-semantics).
 */
export function buildBusinessEventRow(input: CreateBusinessEventInput): Record<string, unknown> {
  const status = input.status ?? "created";
  return {
    event_code: input.eventCode,
    event_type: input.eventType ?? null,
    event_date: input.eventDate,
    title: input.title,
    description: input.description ?? null,
    status,
    // canonical source reference → legacy provider-shaped columns (compatibility mapping)
    source_line_user_id: input.source.externalSubjectId,
    source_message_ids: input.source.messageIds ?? null,
    partner_id: input.partnerId ?? null,
    material_id: input.materialId ?? null,
    material_text: input.materialText ?? null,
    quantity: num(input.quantity),
    quantity_unit: input.quantityUnit ?? null,
    destination: input.destination ?? null,
    schedule_text: input.scheduleText ?? null,
    contact_name: input.contactName ?? null,
    contact_phone: input.contactPhone ?? null,
    context: input.context ?? null,
    confidence: num(input.confidence),
    metadata: {
      ...(input.metadata ?? {}),
      written_by: `canonical:event-write@${input.actor}`,
      source_provider: input.source.provider,
    },
  };
}

/** CREATE EVENT — the only path that inserts a business event. */
export async function createBusinessEvent(
  db: SupabaseClient,
  input: CreateBusinessEventInput,
): Promise<WriteResult<{ id: string; event_code: string; status: string }>> {
  if (!input.eventCode || !input.title) return { ok: false, error: "EVENT_REQUIRED_FIELDS" };
  const status = input.status ?? "created";
  if (!BUSINESS_EVENT_STATES.includes(status)) return { ok: false, error: `EVENT_UNKNOWN_STATE:${status}` };

  const row = buildBusinessEventRow(input);

  const { data, error } = await db.from("business_events").insert(row).select("id, event_code, status").single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as { id: string; event_code: string; status: string } };
}

/** UPDATE EVENT STATE — validated target state; from-state checked where provable. */
export async function transitionBusinessEvent(
  db: SupabaseClient,
  input: { eventId?: string; eventCode?: string; from?: string | null; to: string; actor: string; extra?: Record<string, unknown> },
): Promise<WriteResult> {
  if (!BUSINESS_EVENT_STATES.includes(input.to)) return { ok: false, error: `EVENT_UNKNOWN_STATE:${input.to}` };
  if (!input.eventId && !input.eventCode) return { ok: false, error: "EVENT_TARGET_REQUIRED" };

  if (input.from) {
    const allowed = PROVEN_TRANSITIONS[input.from];
    if (allowed && !allowed.includes(input.to)) {
      return { ok: false, error: `EVENT_TRANSITION_REFUSED:${input.from}->${input.to}` };
    }
  }

  const patch: Record<string, unknown> = { status: input.to, updated_at: new Date().toISOString() };
  for (const [key, value] of Object.entries(input.extra ?? {})) {
    if (!ENRICHABLE_FIELDS.includes(key) && key !== "transaction_id") return { ok: false, error: `EVENT_FIELD_NOT_ALLOWED:${key}` };
    patch[key] = value;
  }

  const base = db.from("business_events").update(patch);
  const query = input.eventId ? base.eq("id", input.eventId) : base.eq("event_code", input.eventCode as string);
  const { error } = await query;
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** BUSINESS METADATA — allow-listed enrichment only (no state change). */
export async function enrichBusinessEvent(
  db: SupabaseClient,
  input: { eventId: string; fields: Record<string, unknown>; actor: string },
): Promise<WriteResult> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [key, value] of Object.entries(input.fields)) {
    if (!ENRICHABLE_FIELDS.includes(key)) return { ok: false, error: `EVENT_FIELD_NOT_ALLOWED:${key}` };
    patch[key] = value;
  }
  const { error } = await db.from("business_events").update(patch).eq("id", input.eventId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * ASSIGN CANONICAL IDENTITY — attach the canonical transaction this event became.
 * Links ONLY: it never changes event state (a caller that also wants a state
 * change issues an explicit transitionBusinessEvent), and it never touches any
 * financial state — the transaction itself is owned by the canonical
 * transaction writer / B-04, not by the event writer.
 */
export async function linkBusinessEventTransaction(
  db: SupabaseClient,
  input: { eventId: string; transactionId: string; actor: string },
): Promise<WriteResult> {
  const { error } = await db
    .from("business_events")
    .update({ transaction_id: input.transactionId, updated_at: new Date().toISOString() })
    .eq("id", input.eventId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

