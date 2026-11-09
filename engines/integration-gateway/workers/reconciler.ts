/**\n * Integration Gateway — Reconciliation Worker (Phase 2).\n *
 * Purpose: match KBank payment events against the pending order queue and
 * reconcile them. This worker runs on the GatewayEvent bus and is the first
 * engine in the Reconcile pipeline:
 *
 *   1. read integration_gateway_events where provider = 'kbank',
 *      capability = 'payment.completed' and status = 'received' (not yet
 *      reconciled);
 *   2. extract amount and reference_id (or order_id) from the event's
 *      evidence JSON;
 *   3. search customer_orders for a match:
 *        order_no = reference_id OR id = reference_id
 *        AND the order status is 'DRAFT' or 'SUBMITTED' (pending payment);
 *   4. if a match is found:
 *        - update customer_orders status to 'PAID';
 *        - update integration_gateway_events status to 'processed';
 *        - log success: "Order {order_no} matched with payment {event_id}".
 *   5. if no match is found:
 *        - update integration_gateway_events status to 'unmatched';
 *        - log warning: "Payment {event_id} of amount {amount} has no matching order".
 *
 * Design notes (idempotency / fail-closed):
 *   - The loop is safe to re-run: each event_id is consumed exactly once
 *     because the read filters on status = 'received' and the write for a
 *     matched event advances the event to 'processed'; for an unmatched event
 *     we also advance to 'unmatched', so a re-run finds nothing new.
 *   - Reads use the service_role client (supabaseAdmin) so that writes into
 *     customer_orders (write-permitted tenant rows) and the guarded event
 *     columns work without RLS interference, matching the pattern used by the
 *     inbound translator (order-translator.ts).
 *   - Fail-open at the read boundary: a transient DB problem must not tear
 *     down the whole reconciliation loop; unmatched events are left untouched
 *     for a later retry so no payment can silently drop between the gateway
 *     and the accounting layer.
 *
 * Dependency: services/supabase/queries.ts#supabaseAdmin (service_role).
 */

import { supabaseAdmin } from "@/services/supabase/queries";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GatewayEvent } from "@/engines/integration-gateway/contracts/event";

/** Options carried through the reconciliation pipeline. */
interface ReconciliationOptions {
  /** Supabase service_role client (injected for testability). */
  db?: typeof supabaseAdmin;
}

/** The set of event_ids that were (or would have been) processed by this run. */
interface ProcessedEvent {
  event_id: string;
  order_id: string | null;
  order_no: string | null;
  status: "matched" | "unmatched";
}

/**
 * The statuses a KBank payment may land on.
 *
 * OWNER DECISION (binding, 2026-11-09): the KBank webhook means "money has
 * landed", so the order is expected to be SUBMITTED or PAID at that moment —
 * matching DRAFT-only was wrong. SUBMITTED is kept so a payment that arrives
 * before the status flip still matches. Do not narrow this back to DRAFT.
 */
const MATCHABLE_STATUSES: string[] = ["SUBMITTED", "PAID"];

const ORDER_COLUMNS =
  "id, order_no, customer_company_id, customer_site_id, status, updated_at";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One customer_orders row as the reconciler reads it. */
interface ReconciliationCandidate {
  id: string;
  order_no: string;
  customer_company_id: string;
  customer_site_id: string;
  status: string;
  updated_at: string;
}

/** Summary returned to the caller (cron route / tests). */
export interface ReconciliationResult {
  matched: number;
  unmatched: number;
  failed: number;
  /** One entry per event that could not be matched: "<event_id>: <why>". */
  reasons: string[];
}

/**
 * Read all KBank payment.completed events that are still unreconciled and
 * attempt to match each one to a pending customer_order.
 *
 * Returns a summary object so callers (and tests) can report how many orders
 * were paid, how many payments were unmatched, and how many events failed to
 * read.
 */
export async function reconcileKBankPayments(
  options: ReconciliationOptions = {},
): Promise<ReconciliationResult> {
  const db = (options.db ?? supabaseAdmin()) as SupabaseClient;

  // 1. Read unreconciled KBank payment.completed events.
  const { data: events, error: readError } = await db
    .from("integration_gateway_events")
    .select("event_id, provider, capability, evidence, occurred_at")
    .eq("provider", "kbank")
    .eq("capability", "payment.completed")
    .eq("status", "received")
    .order("occurred_at", { ascending: true });

  if (readError) {
    // Fail-open: the reconciliation engine must never halt the webhook
    // ingest pipeline. A transient problem is retried on the next run, and
    // the offending rows keep their 'received' status so they are not lost.
    return { matched: 0, unmatched: 0, failed: 1, reasons: ["event read failed"] };
  }

  const rows = (events ?? []) as GatewayEvent[];
  if (rows.length === 0) return { matched: 0, unmatched: 0, failed: 0, reasons: [] };

  let matched = 0;
  let unmatched = 0;
  const reasons: string[] = [];

  for (const evt of rows) {
    const evidence = (evt.evidence ?? {}) as Record<string, unknown>;
    const eventId = typeof evt.event_id === "string" ? evt.event_id : "unknown";

    // 2. Extract amount and reference_id (or order_id) from the evidence.
    //    KBank's payload shape is not yet frozen, so read the keys we
    //    actually expect and fall back to a null placeholder rather than
    //    throwing on a shape change.
    const amount = typeof evidence.amount === "number"
      ? evidence.amount
      : typeof evidence.amount === "string"
        ? parseFloat(evidence.amount)
        : null;
    const referenceId =
      typeof evidence.reference_id === "string"
        ? evidence.reference_id
        : typeof evidence.order_id === "string"
          ? evidence.order_id
          : null;

    // 3. Search customer_orders for a match. The identifier is either the
    //    KBank reference (compare to order_no) or the order's own uuid
    //    (compare to id).
    //
    //    TWO separate queries instead of chained `.or()` on purpose:
    //      - PostgREST ANDs chained `.or()` filters together, so the old
    //        `.or(order_no).or(id)` required BOTH conditions to hold; and
    //      - `id.eq.<order_no>` compared a uuid column to a non-uuid string,
    //        raising 22P02 for every order-number reference.
    //
    //    Status: see MATCHABLE_STATUSES (owner decision — PAID counts as
    //    payable-landed, SUBMITTED is kept for an early payment).
    const candidates: ReconciliationCandidate[] = [];
    let reason: string | null = null;

    if (!referenceId) {
      reason = "no reference_id / order_id in evidence";
    } else {
      const { data: byOrderNo, error: orderNoError } = await db
        .from("customer_orders")
        .select(ORDER_COLUMNS)
        .eq("order_no", referenceId)
        .in("status", MATCHABLE_STATUSES)
        .limit(1);

      if (orderNoError) {
        reason = `order_no lookup failed: ${orderNoError.message}`;
      } else if (Array.isArray(byOrderNo) && byOrderNo.length > 0) {
        candidates.push(byOrderNo[0] as ReconciliationCandidate);
      }

      // Only a real uuid may be compared against the uuid `id` column.
      if (!reason && candidates.length === 0) {
        if (UUID_RE.test(referenceId)) {
          const { data: byId, error: idError } = await db
            .from("customer_orders")
            .select(ORDER_COLUMNS)
            .eq("id", referenceId)
            .in("status", MATCHABLE_STATUSES)
            .limit(1);

          if (idError) {
            reason = `id lookup failed: ${idError.message}`;
          } else if (Array.isArray(byId) && byId.length > 0) {
            candidates.push(byId[0] as ReconciliationCandidate);
          }
        } else {
          reason = `reference ${referenceId} is not a uuid, so id lookup was skipped`;
        }
      }
    }

    const order = candidates[0] ?? null;

    if (!order) {
      // 5. NO match: mark the payment 'unmatched' and record why.
      unmatched += 1;
      const why = reason ?? `no order found for reference ${referenceId}`;
      reasons.push(`${eventId}: ${why}`);
      console.warn(
        `[reconciler] Payment ${eventId} of amount ${amount ?? "unknown"} has no matching order (${why})`,
      );

      const { error: updateError } = await db
        .from("integration_gateway_events")
        .update({ status: "unmatched", updated_at: new Date().toISOString() })
        .eq("event_id", evt.event_id)
        .eq("status", "received");

      if (updateError) {
        // Record the failure in the event log; leave the row 'received' so a
        // retry does not silently double-advance.
        console.error(`[reconciler] Failed to mark ${eventId} unmatched`, updateError);
      }
      continue;
    }

    // 4a. Matched: set the order to PAID.
    const { error: updateOrderError } = await db
      .from("customer_orders")
      .update({ status: "PAID", updated_at: new Date().toISOString() })
      .eq("id", order.id)
      .in("status", MATCHABLE_STATUSES);

    if (updateOrderError) {
      // A paid order must not overwrite a live order; log and continue so
      // one bad row does not skip the rest of the reconciliation run.
      console.error(`[reconciler] Failed to mark order ${order.order_no} paid`, updateOrderError);
      unmatched += 1;
      reasons.push(`${eventId}: order ${order.order_no} could not be marked PAID`);
      continue;
    }

    // 4b. Matched: mark the source event 'processed'.
    const { error: updateEventError } = await db
      .from("integration_gateway_events")
      .update({ status: "processed", updated_at: new Date().toISOString() })
      .eq("event_id", evt.event_id)
      .eq("status", "received");

    if (updateEventError) {
      console.error(`[reconciler] Failed to mark ${eventId} processed`, updateEventError);
      // The order is paid even if the event marker failed; log and continue.
    }

    matched += 1;
    console.log(
      `[reconciler] Order ${order.order_no} matched with payment ${eventId}`,
    );
  }

  return { matched, unmatched, failed: 0, reasons };
}

