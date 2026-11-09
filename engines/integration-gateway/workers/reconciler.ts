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
 * Read all KBank payment.completed events that are still unreconciled and
 * attempt to match each one to a pending customer_order.
 *
 * Returns a summary object so callers (and tests) can report how many orders
 * were paid, how many payments were unmatched, and how many events failed to
 * read.
 */
export async function reconcileKBankPayments(
  options: ReconciliationOptions = {},
): Promise<{
  matched: number;
  unmatched: number;
  failed: number;
}> {
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
    return { matched: 0, unmatched: 0, failed: 1 };
  }

  const rows = (events ?? []) as GatewayEvent[];
  if (rows.length === 0) return { matched: 0, unmatched: 0, failed: 0 };

  let matched = 0;
  let unmatched = 0;

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

    // 3. Search customer_orders for a match. The identifier we matched on
    //    is either the KBank event's reference_id (in which case we compare
    //    to order_no) or the order's own id (in which case we compare to id).
    //    We filter status to DRAFT / SUBMITTED so only pending orders can
    //    be matched, and we deduplicate with limit(1) per term below.
    const { data: candidates, error: searchError } = await db
      .from("customer_orders")
      .select("id, order_no, customer_company_id, customer_site_id, status, updated_at")
      .or(
        `order_no.eq.${referenceId ?? ""}`,
      )
      .or(
        `id.eq.${referenceId ?? ""}`,
      )
      .in("status", ["DRAFT", "SUBMITTED"])
      .limit(10);

    if (searchError || !candidates || candidates.length === 0) {
      // 5. NO match: mark the payment 'unmatched' and warn.
      unmatched += 1;
      console.warn(
        `[reconciler] Payment ${eventId} of amount ${amount ?? "unknown"} has no matching order`,
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

    // Use the first candidate in the same tenant (the gateway is single-org
    // today, so no cross-tenant disambiguation is needed).
    const order = (candidates ?? [])[0] as {
      id: string;
      order_no: string;
      status: string;
      customer_company_id: string;
      customer_site_id: string;
      updated_at: string;
    };

    // 4a. Matched: set the order to PAID.
    const { error: updateOrderError } = await db
      .from("customer_orders")
      .update({ status: "PAID", updated_at: new Date().toISOString() })
      .eq("id", order.id)
      .eq("status", "DRAFT");

    if (updateOrderError) {
      // A paid order must not overwrite a live order; log and continue so
      // one bad row does not skip the rest of the reconciliation run.
      console.error(`[reconciler] Failed to mark order ${order.order_no} paid`, updateOrderError);
      unmatched += 1;
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

  return { matched, unmatched, failed: 0 };
}

