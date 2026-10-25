/**
 * Canonical transaction write model (Phase D3).
 *
 * A transaction is `customer_orders` and it must always sit inside a COMPLETE
 * chain: company → site → project → document_group → order.
 *
 * The previous behaviour (`app/api/admin/documents/route.ts#autoLinkTransaction`)
 * created an order with only company+status — a half chain. That is gone:
 *   • createTransaction validates every link and refuses to guess
 *   • resolveOrderForDocument either uses the given order or resolves an OPEN order
 *     for the company (with project/group/site present); if none exists it reports
 *     a validation error and the caller writes NOTHING (no half chain, no orphan doc)
 * transaction↔document linkage stays the existing `customer_order_id` FK.
 */
import { createHash } from "crypto";
import { supabaseAdmin } from "@/services/supabase/queries";
import { recordCanonicalAudit } from "@/engines/canonical/audit";

export interface TransactionContext {
  customer_company_id: string;
  customer_site_id: string;
  project_id?: string | null;
  document_group_id?: string | null;
  tx_type?: string | null;
  title?: string | null;
  /**
   * PHASE D (2026-09-23): `customer_orders.delivery_note` is a real, nullable
   * business column that the pre-cutover callers wrote (contact/delivery
   * instructions). Carried here so routing them through the canonical command
   * does not silently drop data. No new state, no new meaning.
   */
  delivery_note?: string | null;
}

export interface ChainValidation {
  ok: boolean;
  missing: string[];
  resolved: {
    customer_company_id?: string;
    customer_site_id?: string;
    project_id?: string;
    document_group_id?: string;
  };
}

function stamps() {
  const stamp = Date.now().toString().slice(-6);
  const dateStr = new Date().toISOString().split("T")[0].replace(/-/g, "");
  return { stamp, dateStr };
}

/**
 * Verify the chain against real rows. Missing links are reported — never invented.
 */
export async function validateTransactionChain(ctx: TransactionContext): Promise<ChainValidation> {
  const db = supabaseAdmin();
  const missing: string[] = [];
  const resolved: ChainValidation["resolved"] = {};

  const { data: company } = await db.from("companies").select("id").eq("id", ctx.customer_company_id).maybeSingle();
  if (!company) missing.push("customer_company_id");
  else resolved.customer_company_id = String(company.id);

  const { data: site } = ctx.customer_site_id
    ? await db.from("customer_sites").select("id, customer_company_id").eq("id", ctx.customer_site_id).maybeSingle()
    : { data: null };
  if (!site) missing.push("customer_site_id");
  else if (String(site.customer_company_id) !== ctx.customer_company_id) missing.push("customer_site_id(ไม่ตรงกับบริษัท)");
  else resolved.customer_site_id = String(site.id);

  if (ctx.project_id) {
    const { data: project } = await db.from("projects").select("id").eq("id", ctx.project_id).maybeSingle();
    if (!project) missing.push("project_id");
    else resolved.project_id = String(project.id);
  } else if (site) {
    const { data: existing } = await db
      .from("projects")
      .select("id")
      .eq("customer_site_id", String(site.id))
      .eq("customer_company_id", ctx.customer_company_id)
      .order("created_at", { ascending: true })
      .limit(1);
    const first = existing?.[0];
    if (first) resolved.project_id = String(first.id);
  }

  if (ctx.document_group_id) {
    const { data: group } = await db.from("document_groups").select("id").eq("id", ctx.document_group_id).maybeSingle();
    if (!group) missing.push("document_group_id");
    else resolved.document_group_id = String(group.id);
  } else if (resolved.project_id) {
    const { data: groups } = await db
      .from("document_groups")
      .select("id")
      .eq("project_id", resolved.project_id)
      .eq("customer_company_id", ctx.customer_company_id)
      .order("created_at", { ascending: true })
      .limit(1);
    const first = groups?.[0];
    if (first) resolved.document_group_id = String(first.id);
  }

  const canDerive = Boolean(resolved.customer_company_id && resolved.customer_site_id);
  return { ok: canDerive, missing, resolved };
}

/**
 * Deterministic order number for an idempotent command (WAVE 2 §06).
 *
 * The database enforces `customer_orders.order_no` UNIQUE, so deriving the
 * number from the caller's key means a retried/redelivered command can only
 * ever produce the SAME order. Without a key the legacy timestamp shape is kept.
 * Exported so the mapping itself can be proven offline (pure, no I/O).
 */
export function orderNoFor(
  idempotencyKey: string | null | undefined,
  stamps: { dateStr: string; stamp: string },
): string {
  const key = idempotencyKey?.trim();
  if (!key) return `ORD-${stamps.dateStr}-${stamps.stamp}`;
  return `ORD-IDEM-${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
}

/** Create the full chain. Site is mandatory (the repo already requires it for orders). */
export async function createTransaction(
  ctx: TransactionContext,
  actor: string,
  options?: { createMissingChain?: boolean; idempotencyKey?: string | null },
) {
  const db = supabaseAdmin();
  if (!ctx.customer_company_id || !ctx.customer_site_id) {
    throw new Error("TRANSACTION_CONTEXT_INCOMPLETE: ต้องมี customer_company_id และ customer_site_id");
  }
  const validation = await validateTransactionChain(ctx);
  if (!validation.ok) throw new Error(`TRANSACTION_CONTEXT_INCOMPLETE: ${validation.missing.join(", ")}`);

  // WAVE 2 — idempotency (owner §06). A command may carry a key; the order number
  // is then DERIVED from that key and `customer_orders.order_no` is UNIQUE in the
  // database, so a redelivered/retried command can never create a second order.
  // Without a key the legacy timestamp behaviour is unchanged.
  const idemKey = options?.idempotencyKey?.trim() || null;
  const { stamp, dateStr } = stamps();
  const orderNo = orderNoFor(idemKey, { dateStr, stamp });

  if (idemKey) {
    const { data: replay } = await db
      .from("customer_orders")
      .select("*")
      .eq("order_no", orderNo)
      .maybeSingle();
    if (replay) {
      return {
        order: replay as Record<string, unknown>,
        project_id: (replay.project_id as string | null) ?? null,
        document_group_id: (replay.document_group_id as string | null) ?? null,
        idempotent_replay: true,
      };
    }
  }

  const title = (ctx.title ?? "").trim() || "งานใหม่";
  let projectId = validation.resolved.project_id ?? null;
  let groupId = validation.resolved.document_group_id ?? null;

  if ((!projectId || !groupId) && options?.createMissingChain !== false) {
    if (!projectId) {
      const { data: project, error } = await db
        .from("projects")
        .insert({
          project_no: `PRJ-${dateStr}-${stamp}`,
          customer_company_id: ctx.customer_company_id,
          customer_site_id: ctx.customer_site_id,
          title,
          status: "ACTIVE",
          updated_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (error) throw new Error(`สร้างโครงการไม่สำเร็จ: ${error.message}`);
      projectId = String(project.id);
    }
    if (!groupId) {
      const { data: projectRow } = await db.from("projects").select("project_no").eq("id", projectId).maybeSingle();
      const { data: group, error } = await db
        .from("document_groups")
        .insert({
          group_no: `DG-${dateStr}-${stamp}`,
          project_id: projectId,
          project_no: projectRow?.project_no ?? null,
          customer_company_id: ctx.customer_company_id,
          title,
          status: "OPEN",
          updated_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (error) throw new Error(`สร้างกลุ่มเอกสารไม่สำเร็จ: ${error.message}`);
      groupId = String(group.id);
    }
  }
  if (!projectId || !groupId) {
    throw new Error("TRANSACTION_CONTEXT_INCOMPLETE: ขาด project/document_group และไม่อนุญาตให้สร้างครึ่งเดียว");
  }

  const { data: order, error: orderErr } = await db
    .from("customer_orders")
    .insert({
      order_no: orderNo,
      project_id: projectId,
      document_group_id: groupId,
      customer_company_id: ctx.customer_company_id,
      customer_site_id: ctx.customer_site_id,
      status: "DRAFT",
      tx_type: ctx.tx_type ?? "sale",
      delivery_note: ctx.delivery_note ?? null,
      updated_at: new Date().toISOString(),
    })
    .select("id, order_no, status, customer_company_id, created_at")
    .single();
  if (orderErr) {
    // A concurrent duplicate lost the unique race — return the winner instead of failing.
    if ((orderErr as { code?: string }).code === "23505" && idemKey) {
      const { data: winner } = await db.from("customer_orders").select("*").eq("order_no", orderNo).maybeSingle();
      if (winner) {
        return {
          order: winner as Record<string, unknown>,
          project_id: (winner.project_id as string | null) ?? null,
          document_group_id: (winner.document_group_id as string | null) ?? null,
          idempotent_replay: true,
        };
      }
    }
    throw new Error(`สร้างธุรกรรมไม่สำเร็จ: ${orderErr.message}`);
  }

  await recordCanonicalAudit({
    action: "transaction.created",
    entity_type: "customer_order",
    entity_id: String(order.id),
    actor,
    company_id: ctx.customer_company_id,
    new_value: { order_no: orderNo, project_id: projectId, document_group_id: groupId, customer_site_id: ctx.customer_site_id },
  });

  return { order: order as Record<string, unknown>, project_id: projectId, document_group_id: groupId, idempotent_replay: false };
}

export interface LinkResolution {
  linked: boolean;
  order_id: string | null;
  code?: "TRANSACTION_CONTEXT_INCOMPLETE";
  reason?: string;
}

/**
 * Resolve the order a document belongs to, BEFORE the document row is written.
 * `linked:false` means the caller must abort and write nothing.
 */
export async function resolveOrderForDocument(input: {
  customer_company_id: string;
  transactionId?: string | null;
}): Promise<LinkResolution> {
  const db = supabaseAdmin();
  if (input.transactionId) {
    const { data: order } = await db
      .from("customer_orders")
      .select("id, customer_company_id, project_id, document_group_id, customer_site_id")
      .eq("id", input.transactionId)
      .maybeSingle();
    if (!order) return { linked: false, order_id: null, code: "TRANSACTION_CONTEXT_INCOMPLETE", reason: "ไม่พบธุรกรรมที่ระบุ" };
    if (String(order.customer_company_id) !== input.customer_company_id) {
      return { linked: false, order_id: null, code: "TRANSACTION_CONTEXT_INCOMPLETE", reason: "ธุรกรรมที่ระบุเป็นของคู่ค้าคนละราย" };
    }
    if (!order.project_id || !order.document_group_id || !order.customer_site_id) {
      return {
        linked: false,
        order_id: null,
        code: "TRANSACTION_CONTEXT_INCOMPLETE",
        reason: "ธุรกรรมนี้ยังไม่มี project/document_group/site ครบ — ต้องซ่อมสายก่อนออกเอกสาร",
      };
    }
    return { linked: true, order_id: String(order.id) };
  }

  const { data: openOrders } = await db
    .from("customer_orders")
    .select("id")
    .eq("customer_company_id", input.customer_company_id)
    .not("status", "in", '("PAID","CANCELLED")')
    .not("project_id", "is", null)
    .not("document_group_id", "is", null)
    .not("customer_site_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const open = openOrders?.[0];
  if (!open) {
    return {
      linked: false,
      order_id: null,
      code: "TRANSACTION_CONTEXT_INCOMPLETE",
      reason: "ไม่พบธุรกรรมที่เปิดอยู่ซึ่งมี company/site/project/document_group ครบ — กรุณาสร้างงาน (transaction) ก่อนออกเอกสาร",
    };
  }
  return { linked: true, order_id: String(open.id) };
}

/** Attach a document to its order (existing FK — no reference table needed). */
export async function linkDocumentToTransaction(input: {
  order_id: string;
  document_kind: "invoice" | "standalone_document";
  document_id: string;
  actor: string;
}) {
  const db = supabaseAdmin();
  const table = input.document_kind === "invoice" ? "invoices" : "standalone_documents";
  const { error } = await db.from(table).update({ customer_order_id: input.order_id }).eq("id", input.document_id);
  if (error) throw new Error(`ผูกเอกสารกับธุรกรรมไม่สำเร็จ: ${error.message}`);
  await recordCanonicalAudit({
    action: "document.updated",
    entity_type: table,
    entity_id: input.document_id,
    actor: input.actor,
    field: "customer_order_id",
    new_value: input.order_id,
  });
}

/**
 * Attach the document to a transaction through the canonical resolver.
 * Returns a validation error (nothing written) when the context is incomplete.
 */
export async function linkDocumentWithValidation(input: {
  customer_company_id: string;
  transactionId?: string | null;
  document_kind: "invoice" | "standalone_document";
  document_id: string;
  actor: string;
}): Promise<{ linked: boolean; order_id: string | null; error?: { code: string; reason: string } }> {
  const resolution = await resolveOrderForDocument({
    customer_company_id: input.customer_company_id,
    transactionId: input.transactionId ?? null,
  });
  if (!resolution.linked || !resolution.order_id) {
    return {
      linked: false,
      order_id: null,
      error: { code: resolution.code ?? "TRANSACTION_CONTEXT_INCOMPLETE", reason: resolution.reason ?? "" },
    };
  }
  await linkDocumentToTransaction({
    order_id: resolution.order_id,
    document_kind: input.document_kind,
    document_id: input.document_id,
    actor: input.actor,
  });
  return { linked: true, order_id: resolution.order_id };
}

/** Status change with the canonical audit action.
 * D1 cutover (owner 2026-09-25) — the ONE runtime authority for customer_orders
 * status writes: advance + DELETE routes send their target here after THEIR OWN
 * state-machine validation (this function never re-computes a transition —
 * see app/api/admin/transactions/[id]/advance/route.ts). Per-request contract:
 * exactly one status update + exactly one canonical audit row.
 * Validation owned here = the current state must exist (no status write, no
 * audit row for a ghost order); target-state rules stay with the caller's
 * existing contract. */
export async function changeTransactionStatus(input: {
  order_id: string;
  status: string;
  actor: string;
  evidence?: Record<string, unknown> | null;
}) {
  const db = supabaseAdmin();
  const { data: before } = await db.from("customer_orders").select("status, customer_company_id").eq("id", input.order_id).maybeSingle();
  if (!before) throw new Error(`TRANSACTION_NOT_FOUND: ไม่พบธุรกรรม ${input.order_id}`);
  const { error } = await db
    .from("customer_orders")
    .update({ status: input.status, updated_at: new Date().toISOString() })
    .eq("id", input.order_id);
  if (error) throw new Error(`เปลี่ยนสถานะธุรกรรมไม่สำเร็จ: ${error.message}`);
  await recordCanonicalAudit({
    action: "transaction.status_changed",
    entity_type: "customer_order",
    entity_id: input.order_id,
    actor: input.actor,
    company_id: before?.customer_company_id ? String(before.customer_company_id) : null,
    field: "status",
    old_value: before?.status ?? null,
    new_value: input.status,
    evidence: input.evidence ?? null,
  });
}
