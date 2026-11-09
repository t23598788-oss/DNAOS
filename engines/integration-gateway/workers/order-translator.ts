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
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GatewayEvent } from "@/engines/integration-gateway/contracts/event";

export type { SupabaseClient };

/** The translator owns nothing except reading events and writing order rows. */
export interface OrderTranslatorOptions {
  /** Supabase service_role client (injected for testability). */
  db?: typeof supabaseAdmin;
}

/** The set of event_ids we have already turned into stub orders. */
interface SeenOrder {
  event_id: string;
  order_id: string;
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

/** The identity fields a LINE message can carry (or that we can resolve). */
export interface LineOrderFields {
  projectId: string | null;
  documentGroupId: string | null;
  customerCompanyId: string | null;
  customerSiteId: string | null;
  deliveryNote: string | null;
}

/** The four NOT NULL anchors every customer_orders row must carry. */
export interface OrderAnchors {
  projectId: string;
  documentGroupId: string;
  customerCompanyId: string;
  customerSiteId: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asId(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * The exact texts a customer may send to CONFIRM an existing draft order.
 * Order creation (a description like "อยากได้ทราย 500 คิว") is never a
 * confirmation: money may only follow an explicit yes.
 */
const CONFIRM_TEXT_RE = /^(ยืนยัน|ยืนยันครับ|ยืนยันค่ะ|ยืนยันการสั่งซื้อ|confirm|yes|ok)$/i;

function isConfirmationText(value: unknown): boolean {
  return typeof value === "string" && CONFIRM_TEXT_RE.test(value.trim());
}

/** The company a LINE sender is linked to, via the legacy identity projection. */
async function companyForSender(db: SupabaseClient, senderId: string): Promise<string | null> {
  const { data: profiles } = await db
    .from("line_profiles")
    .select("company_id")
    .eq("line_user_id", senderId)
    .limit(1);
  const profile = (Array.isArray(profiles) ? profiles[0] : profiles) as
    | { company_id?: unknown }
    | null
    | undefined;
  const companyId = asId(profile?.company_id);
  return companyId && UUID_RE.test(companyId) ? companyId : null;
}

/** Draft order ids of one sender's company, newest first. */
async function draftOrderIdsForSender(db: SupabaseClient, senderId: string): Promise<string[]> {
  const companyId = await companyForSender(db, senderId);
  if (!companyId) return [];
  const { data: drafts } = await db
    .from("customer_orders")
    .select("id")
    .eq("customer_company_id", companyId)
    .eq("status", "DRAFT")
    .order("created_at", { ascending: false });
  return ((drafts ?? []) as { id?: unknown }[])
    .map((row) => asId(row?.id))
    .filter((id): id is string => Boolean(id));
}

/**
 * Confirm one draft order: DRAFT -> SUBMITTED. Idempotent by design — an order
 * that is already past DRAFT is reported as-is, never moved backwards or
 * re-written, and the UPDATE is guarded by `.in("status", ["DRAFT"])` so a
 * concurrent confirm cannot double-fire.
 */
export async function confirmOrder(
  orderId: string,
  options: OrderTranslatorOptions = {},
): Promise<{ ok: boolean; orderId: string; status: string }> {
  const db = (options.db ?? supabaseAdmin()) as SupabaseClient;

  const { data: order, error: readError } = await db
    .from("customer_orders")
    .select("id, status")
    .eq("id", orderId)
    .maybeSingle();

  if (readError || !order) {
    return { ok: false, orderId, status: "not_found" };
  }

  const current = typeof order.status === "string" ? order.status : "";
  if (current !== "DRAFT") {
    return { ok: true, orderId, status: current };
  }

  const { data: updated, error: updateError } = await db
    .from("customer_orders")
    .update({ status: "SUBMITTED", updated_at: new Date().toISOString() })
    .eq("id", orderId)
    .in("status", ["DRAFT"])
    .select("id, status")
    .maybeSingle();

  if (updateError) {
    return { ok: false, orderId, status: "update_error" };
  }

  if (updated?.status) {
    return { ok: true, orderId, status: String(updated.status) };
  }

  // The row changed between our read and our write — report what it is now.
  const { data: after } = await db
    .from("customer_orders")
    .select("status")
    .eq("id", orderId)
    .maybeSingle();
  return { ok: true, orderId, status: after?.status ? String(after.status) : "unknown" };
}

/**
 * Extract the identity fields a LINE message.received evidence payload carries.
 *
 * The adapter's evidence contract has no project/site resolver yet, so these
 * keys are simply absent today; they are read here so that the day the parser
 * starts emitting them the translator picks them up with no further change.
 */
function extractLineOrderFields(evidence: Record<string, unknown>): LineOrderFields {
  return {
    projectId: asId(evidence.project_id),
    documentGroupId: asId(evidence.document_group_id),
    customerCompanyId: asId(evidence.customer_company_id),
    customerSiteId: asId(evidence.customer_site_id),
    deliveryNote: typeof evidence.delivery_note === "string" ? evidence.delivery_note : null,
  };
}

/**
 * Resolve the four NOT NULL anchors for an order — or refuse.
 *
 * customer_orders.project_id / document_group_id / customer_company_id /
 * customer_site_id are uuid NOT NULL with no default and each carries an FK to
 * projects / document_groups / companies / customer_sites, so a row inserted
 * with `undefined` is rejected by Postgres (that was the silent-skip bug).
 *
 * ONE strategy, documented (do not mix):
 *   1. use the value from the event's evidence when it carries one;
 *   2. otherwise resolve the sending LINE contact through `line_profiles`
 *      (`line_user_id = evidence.sender_id`) to its `company_id`. That is the
 *      strongest real anchor the repo has: the profile table links a LINE user
 *      to a company, but it carries no project/department site;
 *   3. for the remaining project / document_group / site anchors, reuse the
 *      most recent customer_orders row of THAT SAME company. This is the
 *      "most recent order for the same contact" strategy the task allows,
 *      adapted to the column we actually have (orders do not store a
 *      line_user_id; the profile resolves the contact to a company first).
 *   4. if any anchor is still missing, return null — the caller must NOT
 *      insert. Nothing is invented, and no synthetic project/company is made.
 */
async function resolveOrderAnchors(
  db: SupabaseClient,
  fields: LineOrderFields,
  senderId: string | null,
): Promise<{ anchors: OrderAnchors | null; missing: string[] }> {
  let companyId = fields.customerCompanyId && UUID_RE.test(fields.customerCompanyId)
    ? fields.customerCompanyId
    : null;

  if (!companyId && senderId) {
    const { data: profiles } = await db
      .from("line_profiles")
      .select("company_id")
      .eq("line_user_id", senderId)
      .limit(1);
    const profile = (Array.isArray(profiles) ? profiles[0] : profiles) as
      | { company_id?: unknown }
      | null
      | undefined;
    const profileCompany = asId(profile?.company_id);
    if (profileCompany && UUID_RE.test(profileCompany)) companyId = profileCompany;
  }

  let projectId = fields.projectId && UUID_RE.test(fields.projectId) ? fields.projectId : null;
  let documentGroupId =
    fields.documentGroupId && UUID_RE.test(fields.documentGroupId) ? fields.documentGroupId : null;
  let customerSiteId =
    fields.customerSiteId && UUID_RE.test(fields.customerSiteId) ? fields.customerSiteId : null;

  if (companyId && (!projectId || !documentGroupId || !customerSiteId)) {
    const { data: previousRows } = await db
      .from("customer_orders")
      .select("project_id, document_group_id, customer_site_id")
      .eq("customer_company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(1);
    const previous = (Array.isArray(previousRows) ? previousRows[0] : previousRows) as
      | { project_id?: unknown; document_group_id?: unknown; customer_site_id?: unknown }
      | null
      | undefined;
    projectId = projectId ?? asId(previous?.project_id);
    documentGroupId = documentGroupId ?? asId(previous?.document_group_id);
    customerSiteId = customerSiteId ?? asId(previous?.customer_site_id);
  }

  const missing: string[] = [];
  if (!projectId) missing.push("project_id");
  if (!documentGroupId) missing.push("document_group_id");
  if (!companyId) missing.push("customer_company_id");
  if (!customerSiteId) missing.push("customer_site_id");

  if (!projectId || !documentGroupId || !companyId || !customerSiteId) {
    return { anchors: null, missing };
  }

  return {
    anchors: { projectId, documentGroupId, customerCompanyId: companyId, customerSiteId },
    missing: [],
  };
}

/**
 * Translate one LINE message.received GatewayEvent into a customer_orders row
 * and mark the source event 'processed'. Returns the count of rows written.
 */
export async function translateLineMessageEvents(
  options: OrderTranslatorOptions = {},
): Promise<{
  translated: number;
  skipped: number;
  processed: number;
  unanchored: number;
  confirmed: number;
}> {
  const db = (options.db ?? supabaseAdmin()) as SupabaseClient;

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
    return { translated: 0, skipped: 0, processed: 0, unanchored: 0, confirmed: 0 };
  }

  const rows = (events ?? []) as GatewayEvent[];
  if (rows.length === 0) return { translated: 0, skipped: 0, processed: 0, unanchored: 0, confirmed: 0 };

  const seen: SeenOrder[] = [];
  let translated = 0;
  let skipped = 0;
  let processed = 0;
  let unanchored = 0;
  let confirmed = 0;

  for (const evt of rows) {
    const evidence = (evt.evidence ?? {}) as Record<string, unknown>;
    const provider = typeof evt.provider === "string" ? evt.provider : "unknown";

    if (provider !== "line" || evt.capability !== "message.received") {
      skipped += 1;
      continue;
    }

    // 2. Resolve the four NOT NULL anchors BEFORE inserting anything. There is
    //    no invented fallback: an event whose order cannot be anchored is left
    //    in status 'received' so the next cron run can retry it.
    const orderNo = buildOrderNo(evidence, provider);
    const fields = extractLineOrderFields(evidence);
    const senderId = typeof evidence.sender_id === "string" ? evidence.sender_id : null;

    // 2a. Confirmation intent: "ยืนยัน" / "confirm" / "yes" / "ok" confirms an
    //     existing DRAFT — it never creates a new order. Exactly one draft is
    //     required; two or more is ambiguous and the event stays 'received'.
    if (isConfirmationText(evidence.message_text)) {
      const drafts = senderId ? await draftOrderIdsForSender(db, senderId) : [];

      if (drafts.length > 1) {
        console.warn(
          `[order-translator] confirm ambiguous for ${senderId ?? "unknown"}: ${drafts.length} drafts`,
        );
        skipped += 1;
        continue;
      }

      if (drafts.length === 0) {
        // Nothing to confirm. A bare "ยืนยัน" must not become a draft order.
        console.warn(
          `[order-translator] confirm with no draft order for ${senderId ?? "unknown"} — ignoring`,
        );
        const { error: ignoreError } = await db
          .from("integration_gateway_events")
          .update({ status: "processed", updated_at: new Date().toISOString() })
          .eq("event_id", evt.event_id)
          .eq("status", "received");
        if (ignoreError) skipped += 1;
        else processed += 1;
        continue;
      }

      const result = await confirmOrder(drafts[0], {
        db: db as unknown as typeof supabaseAdmin,
      });
      const { error: confirmError } = await db
        .from("integration_gateway_events")
        .update({ status: "processed", updated_at: new Date().toISOString() })
        .eq("event_id", evt.event_id)
        .eq("status", "received");

      if (confirmError) {
        skipped += 1;
        continue;
      }

      if (result.ok && result.status === "SUBMITTED") confirmed += 1;
      processed += 1;
      continue;
    }

    const { anchors, missing } = await resolveOrderAnchors(db, fields, senderId);
    if (!anchors) {
      unanchored += 1;
      skipped += 1;
      console.warn(
        `[order-translator] cannot anchor order for event ${evt.event_id}: ` +
          `missing ${missing.join(", ")} (sender ${senderId ?? "unknown"}) — event left 'received'`,
      );
      continue;
    }

    const { data: order, error: insertError } = await db
      .from("customer_orders")
      .insert({
        order_no: orderNo,
        project_id: anchors.projectId,
        document_group_id: anchors.documentGroupId,
        customer_company_id: anchors.customerCompanyId,
        customer_site_id: anchors.customerSiteId,
        status: "DRAFT",
        delivery_note: fields.deliveryNote ?? null,
        // updated_at is NOT NULL; customer_orders has no updated_at trigger,
        // so we set it explicitly to match the CREATE TABLE contract.
        updated_at: new Date().toISOString(),
      })
      .select("id, order_no")
      .single();

    if (insertError || !order) {
      // Record the failure in the event log so we never silently drop a row.
      // (A real implementation would write to a dead-letter table / audit log.)
      skipped += 1;
      continue;
    }

    // 3. Mark the source event 'processed'.
    const { error: updateError } = await db
        .from("integration_gateway_events")
      .update({ status: "processed", updated_at: new Date().toISOString() })
      .eq("event_id", evt.event_id)
      .eq("status", "received");

    if (updateError) {
      skipped += 1;
      continue;
    }

    seen.push({ event_id: evt.event_id, order_id: order.id });
    translated += 1;
    processed += 1;
  }

  return { translated, skipped, processed, unanchored, confirmed };
}

export { buildOrderNo, extractLineOrderFields, resolveOrderAnchors };
