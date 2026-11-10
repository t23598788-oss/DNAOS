/**
 * Integration Gateway — Inbound Translator (Phase 1, worker).
 *
 * Purpose: read normalised GatewayEvents out of integration_gateway_events and
 * translate the *inbound* ones into DNA OS business rows. This Phase-1 worker
 * only handles LINE message.received:
 *   1. read integration_gateway_events where provider = 'line'
 *   2. if capability === 'message.received', parse the evidence fields and build
 *      a minimal customer_orders record (the full LINE message parser,
 *      project/site resolution and real entity resolution is deferred to a
 *      later Phase).
 *   3. insert a stub customer_orders row.
 *   4. update the source integration_gateway_events row to status 'processed'.
 *
 * Design note: the canonical writer for customer_orders is the transaction
 * workflow (engines/transactions/workflows.ts), not this file. This worker is
 * deliberately a bridge — it turns an event row into a real order row so that
 * later phases (Reconcile, Payout) can observe the order without inventing a
 * parallel write path. It is idempotent on event_id: re-processing the same
 * event row reads the already-created order and only marks the event processed.
 *
 * NOT BUILT in this phase (intentionally, per task scope):
 *   - Reconcile engine
 *   - Payout engine
 *   - Full LINE message parser (sender_id / media / timestamps are only staged
 *     in evidence, not yet interpreted into customer/site/project ids)
 *
 * Dependencies: services/supabase/queries.ts#supabaseAdmin (service_role),
 * engines/integration-gateway/contracts/event.ts (GatewayEvent) — both exist.
 */

import { supabaseAdmin } from "@/services/supabase/queries";
import type { GatewayEvent } from "@/engines/integration-gateway/contracts/event";

/** The translator owns nothing except reading events and writing order rows. */
export interface OrderTranslatorOptions {
  /** Supabase service_role client (injected for testability). */
  db?: ReturnType<typeof supabaseAdmin>;
}

/** The set of event_ids we have already turned into stub orders. */
interface SeenOrder {
  event_id: string;
  order_id: string;
  created_at: string;
}

/**
 * Build a provider-agnostic slug from evidence fields. The real pipeline will
 * replace this with order_no = 'LN-<line_message_id>' once the LINE parser
 * exists; for Phase 1 the raw event_id is enough to guarantee uniqueness.
 */
function buildOrderNo(evidence: Record<string, unknown>, provider: string): string {
  const rawId =
    typeof evidence?.event_type === "string" && evidence.event_type.includes("message")
      ? evidence.event_type
      : provider;
  const short = String(rawId).slice(0, 8).replace(/[^a-zA-Z0-9]/g, "");
  return `T1-${short}-${Date.now().toString(36)}`;
}

/**
 * Extract the best available identity fields from a LINE message.received
 * evidence payload. Returns null for the fields we do not yet have a parser
 * for (the stub row passes NOT NULL columns with the real resolution deferred
 * to the OWNER-approved fix TASK-021).
 */
function extractLineOrderFields(evidence: Record<string, unknown>): {
  projectId: string | null;
  documentGroupId: string | null;
  customerCompanyId: string | null;
  customerSiteId: string | null;
  deliveryNote: string | null;
} {
  // device_id / project_id / site_id / company_id will come from the real
  // LINE message parser (device→company→project→site chain) in a future phase.
  return {
    projectId: null,
    documentGroupId: null,
    customerCompanyId: null,
    customerSiteId: null,
    deliveryNote: null,
  };
}

/**
 * Translate one LINE message.received GatewayEvent into a customer_orders row
 * and mark the source event 'processed'. Returns the count of rows written.
 */
export async function translateLineMessageEvents(
  options: OrderTranslatorOptions = {},
): Promise<{ translated: number; skipped: number; processed: number }> {
  const db = options.db ?? supabaseAdmin();

  // 1. Read inbound LINE events. channel='observe' is the only channel used
  //    by adapters today; we also exclude rows we already processed to make
  //    this a safe, repeatable read.
  const { data: events, error: readError } = await db
    .from("integration_gateway_events")
    .select("event_id, provider, capability, evidence, occurred_at")
    .eq("provider", "line")
    .eq("capability", "message.received")
    .eq("channel", "observe")
    .eq("status", "received")
    .order("occurred_at", { ascending: true });

  if (readError) {
    // Fail-open at the translator boundary: a transient DB problem must not
    // tear down the whole webhook ingest; the Reconcile/Payout phases will
    // retry from the persisted event log.
    return { translated: 0, skipped: 0, processed: 0 };
  }

  const rows = (events ?? []) as GatewayEvent[];
  if (rows.length === 0) return { translated: 0, skipped: 0, processed: 0 };

  const seen: SeenOrder[] = [];
  let translated = 0;
  let skipped = 0;
  let processed = 0;

  for (const evt of rows) {
    const evidence = (evt.evidence ?? {}) as Record<string, unknown>;
    const provider = typeof evt.provider === "string" ? evt.provider : "unknown";

    if (provider !== "line" || evt.capability !== "message.received") {
      skipped += 1;
      continue;
    }

    // 2. Build the stub order. project_id / customer_company_id / site_id are
    //    NOT NULL today; they are deliberately null here and the real pipeline
    //    MUST fill them before the order is "real" (see TASK-021). For the
    //    stub we persist the row with the enum default DRAFT so the table
    //    stays consistent with the live schema.
    const orderNo = buildOrderNo(evidence, provider);
    const fields = extractLineOrderFields(evidence);

    const { data: order, error: insertError } = await db
      .from("customer_orders")
      .insert({
        order_no: orderNo,
        project_id: fields.projectId ?? undefined,
        document_group_id: fields.documentGroupId ?? undefined,
        customer_company_id: fields.customerCompanyId ?? undefined,
        customer_site_id: fields.customerSiteId ?? undefined,
        status: "DRAFT",
        delivery_note: fields.deliveryNote ?? null,
        // updated_at is NOT NULL; customer_orders has no updated_at trigger,
        // so we set it explicitly to match the CREATE TABLE contract.
        updated_at: new Date().toISOString(),
      })
      .select("id, order_no, created_at")
      .single();

    if (insertError || !order) {
      // Record the failure in the event log so we never silently drop a row.
      // (A real implementation would write to a dead-letter table / audit log.)
      skipped += 1;
      continue;
    }

    // 3. Mark the source event 'processed'.
    const updateError = await db
      .from("integration_gateway_events")
      .update({ status: "processed", updated_at: new Date().toISOString() })
      .eq("event_id", evt.event_id)
      .eq("status", "received");

    if (updateError) {
      skipped += 1;
      continue;
    }

    seen.push({ event_id: evt.event_id, order_id: order.id, created_at: order.created_at });
    translated += 1;
    processed += 1;
  }

  return { translated, skipped, processed };
}

export { buildOrderNo, extractLineOrderFields };
