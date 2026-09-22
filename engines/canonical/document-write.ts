/**
 * Canonical document write service (Phase D2).
 *
 * Contract: CANONICAL_MODEL_DOCUMENT_TRANSACTION_FINANCE_V1_1.md
 *
 * - the money ladder is NOT re-implemented here: it comes from the existing
 *   `calculateDocumentTotals()` in engines/documents/document-editor.ts, which
 *   already implements v1.1 (subtotal → discount → base → VAT → gross → WHT → net)
 * - `total_amount` is GROSS, always (v1.1 invariant 2)
 * - `wht_rate` / `wht_amount` / `net_payable` / `vat_mode` / `discount_amount` are
 *   persisted (previously thrown away)
 * - every issued document gets a `document_versions` row with a real snapshot and a
 *   `previous_version_id` chain; line items are persisted to their real tables
 * - standalone documents are NEVER hard-deleted — void is a version/status change
 * - nothing is ever reconstructed from `total_amount`
 */
import { supabaseAdmin } from "@/services/supabase/queries";
import { calculateDocumentTotals, type DocumentDraftInput } from "@/engines/documents/document-editor";
import { recordCanonicalAudit } from "@/engines/canonical/audit";

export type WriteDocumentKind = "invoice" | "standalone_document";

export interface DocumentLineItem {
  description: string;
  qty: number;
  unit?: string | null;
  unit_price: number;
  discount_amount?: number | null;
  /** only used by the invoice_items table (standalone_document_items has no line total) */
  line_total?: number | null;
  sort_order?: number | null;
}

export interface WriteDocumentInput {
  kind: WriteDocumentKind;
  document_no: string;
  document_type: string;
  customer_company_id: string | null;
  customer_order_id?: string | null;
  project_id?: string | null;
  issue_date?: string | null;
  due_date?: string | null;
  reference_no?: string | null;
  notes?: string | null;
  rows: { qty: number; unitPrice: number }[];
  discountAmount?: number;
  vatEnabled: boolean;
  vatMode?: "exclusive" | "inclusive";
  withholdingTaxPercent?: number;
  items: DocumentLineItem[];
  actor: string;
  status?: string;
}

export interface WriteDocumentResult {
  document_id: string;
  document_kind: WriteDocumentKind;
  document_no: string;
  totals: {
    subtotal: number;
    discount_amount: number;
    vat_mode: string;
    vat_rate: number;
    vat_amount: number;
    gross_amount: number;
    wht_rate: number;
    wht_amount: number;
    net_payable: number;
  };
  items_written: number;
  version: { id: string; version_no: number; previous_version_id: string | null; data_completeness: string };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** v1.1 money ladder computed by the EXISTING engine function (single formula in the repo). */
export function computeCanonicalTotals(input: Pick<WriteDocumentInput, "rows" | "discountAmount" | "vatEnabled" | "vatMode" | "withholdingTaxPercent">) {
  const draft = {
    rows: input.rows,
    discountAmount: input.discountAmount ?? 0,
    vatEnabled: input.vatEnabled,
    vatMode: input.vatMode ?? "exclusive",
    withholdingTaxPercent: input.withholdingTaxPercent ?? 0,
  } as unknown as DocumentDraftInput;
  const totals = calculateDocumentTotals(draft);
  return {
    subtotal: totals.subtotal,
    discount_amount: totals.discountAmount,
    taxable_base: totals.baseAmount,
    vat_mode: input.vatMode ?? (input.vatEnabled ? "exclusive" : "exclusive"),
    vat_rate: input.vatEnabled ? 7 : 0,
    vat_amount: totals.vatAmount,
    gross_amount: totals.grossAmount,
    wht_rate: round2((input.withholdingTaxPercent ?? 0) / 100),
    wht_amount: totals.withholdingAmount,
    net_payable: totals.netAmount,
  };
}

const columnPayload = (t: ReturnType<typeof computeCanonicalTotals>) => ({
  subtotal: t.subtotal,
  discount_amount: t.discount_amount,
  vat_mode: t.vat_mode,
  vat_rate: t.vat_rate,
  vat_amount: t.vat_amount,
  gross_amount: t.gross_amount,
  total_amount: t.gross_amount, // GROSS only — v1.1 invariant 2
  wht_rate: t.wht_rate,
  wht_amount: t.wht_amount,
  net_payable: t.net_payable,
  data_completeness: "FULL",
});

async function persistLineItems(kind: WriteDocumentKind, documentId: string, items: DocumentLineItem[]) {
  if (!items.length) return 0;
  const db = supabaseAdmin();
  if (kind === "invoice") {
    // NOTE: invoice_items.line_total is a GENERATED ALWAYS column (qty * unit_price)
    // — it must never be written by hand.
    const rows = items.map((it, i) => ({
      invoice_id: documentId,
      description: it.description,
      qty: it.qty,
      unit: it.unit ?? null,
      unit_price: it.unit_price,
      sort_order: it.sort_order ?? i,
    }));
    const { error } = await db.from("invoice_items").insert(rows);
    if (error) throw new Error(`บันทึกรายการสินค้า (invoice_items) ไม่สำเร็จ: ${error.message}`);
    return rows.length;
  }
  const rows = items.map((it, i) => ({
    document_id: documentId,
    description: it.description,
    qty: it.qty,
    unit: it.unit ?? null,
    unit_price: it.unit_price,
    sort_order: it.sort_order ?? i,
  }));
  const { error } = await db.from("standalone_document_items").insert(rows);
  if (error) throw new Error(`บันทึกรายการสินค้า (standalone_document_items) ไม่สำเร็จ: ${error.message}`);
  return rows.length;
}

/**
 * Create a document + its line items + version 1 (real snapshot, never a rebuild).
 */
export async function createDocument(input: WriteDocumentInput): Promise<WriteDocumentResult> {
  const db = supabaseAdmin();
  const totals = computeCanonicalTotals(input);
  const table = input.kind === "invoice" ? "invoices" : "standalone_documents";

  const base: Record<string, unknown> = {
    customer_company_id: input.customer_company_id,
    customer_order_id: input.customer_order_id ?? null,
    reference_no: input.reference_no ?? null,
    notes: input.notes ?? null,
    updated_at: new Date().toISOString(),
    ...columnPayload(totals),
  };
  if (input.kind === "invoice") {
    base.invoice_no = input.document_no;
    base.invoice_status = input.status ?? "DRAFT";
    base.invoice_date = input.issue_date ?? new Date().toISOString().split("T")[0];
    base.due_date = input.due_date ?? null;
    base.project_id = input.project_id ?? null;
  } else {
    base.document_no = input.document_no;
    base.document_type = input.document_type;
    base.document_date = input.issue_date ?? null;
    base.status = input.status ?? "active";
  }

  const { data: doc, error } = await db.from(table).insert(base).select("id").single();
  if (error) throw new Error(`สร้างเอกสารไม่สำเร็จ: ${error.message}`);
  const documentId = String(doc.id);

  // Compensating rollback: if the items/version write fails we must not leave a
  // half-written document behind (v1.1 requires a version for every document, and
  // D2 forbids a document without real line items). The row is VOIDed and audited —
  // never deleted.
  try {
    const itemsWritten = await persistLineItems(input.kind, documentId, input.items);
    const version = await createVersion({
      document_kind: input.kind,
      document_id: documentId,
      actor: input.actor,
      status: "active",
      line_items: input.items,
    });

    await recordCanonicalAudit({
      action: "document.created",
      entity_type: table,
      entity_id: documentId,
      actor: input.actor,
      company_id: input.customer_company_id,
      new_value: { document_no: input.document_no, gross_amount: totals.gross_amount, version_no: version.version_no },
      evidence: { version_id: version.id, items: itemsWritten },
    });

    return {
      document_id: documentId,
      document_kind: input.kind,
      document_no: input.document_no,
      totals: {
        subtotal: totals.subtotal,
        discount_amount: totals.discount_amount,
        vat_mode: totals.vat_mode,
        vat_rate: totals.vat_rate,
        vat_amount: totals.vat_amount,
        gross_amount: totals.gross_amount,
        wht_rate: totals.wht_rate,
        wht_amount: totals.wht_amount,
        net_payable: totals.net_payable,
      },
      items_written: itemsWritten,
      version: {
        id: version.id,
        version_no: version.version_no,
        previous_version_id: version.previous_version_id,
        data_completeness: version.data_completeness,
      },
    };
  } catch (e: unknown) {
    await rollbackPartialDocument({ kind: input.kind, document_id: documentId, actor: input.actor, cause: e });
    throw e;
  }
}

/** Void a document whose write failed halfway (never a delete) + record why. */
async function rollbackPartialDocument(input: {
  kind: WriteDocumentKind;
  document_id: string;
  actor: string;
  cause: unknown;
}): Promise<void> {
  const db = supabaseAdmin();
  const table = input.kind === "invoice" ? "invoices" : "standalone_documents";
  const reason = input.cause instanceof Error ? input.cause.message : String(input.cause);
  const patch =
    input.kind === "invoice"
      ? { invoice_status: "VOID", updated_at: new Date().toISOString() }
      : { status: "void", void_reason: `partial write rollback: ${reason}`, voided_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  await db.from(table).update(patch).eq("id", input.document_id);
  try {
    await recordCanonicalAudit({
      action: "document.voided",
      entity_type: table,
      entity_id: input.document_id,
      actor: input.actor,
      field: "write_rollback",
      new_value: { rolled_back: true },
      evidence: { reason },
    });
  } catch {
    /* the audit failure must not mask the original write error */
  }
}


/**
 * Append a version row (append-only chain: new → previous). The snapshot holds the
 * issued state so an old document can always be reopened exactly as issued.
 */
export async function createVersion(input: {
  document_kind: WriteDocumentKind;
  document_id: string;
  actor: string;
  status: "active" | "superseded" | "void";
  line_items?: DocumentLineItem[];
  data_completeness?: "FULL" | "LEGACY_PARTIAL";
  note?: string | null;
}): Promise<{ id: string; version_no: number; previous_version_id: string | null; data_completeness: string }> {
  const db = supabaseAdmin();
  const table = input.document_kind === "invoice" ? "invoices" : "standalone_documents";
  const { data: doc, error: docErr } = await db.from(table).select("*").eq("id", input.document_id).maybeSingle();
  if (docErr || !doc) throw new Error("DOCUMENT_NOT_FOUND: ไม่พบเอกสารที่จะสร้าง version");
  const row = doc as Record<string, unknown>;

  const versionColumn = input.document_kind === "invoice" ? "invoice_id" : "standalone_document_id";
  const { data: latest } = await db
    .from("document_versions")
    .select("id, version_no")
    .eq(versionColumn, input.document_id)
    .order("version_no", { ascending: false })
    .limit(1);
  const prev = latest?.[0];
  const versionNo = Number(prev?.version_no ?? 0) + 1;

  let items = input.line_items ?? null;
  if (!items) {
    const { data: liveItems } =
      input.document_kind === "invoice"
        ? await db.from("invoice_items").select("description, qty, unit, unit_price, line_total, sort_order").eq("invoice_id", input.document_id).order("sort_order", { ascending: true })
        : await db.from("standalone_document_items").select("description, qty, unit, unit_price, sort_order").eq("document_id", input.document_id).order("sort_order", { ascending: true });
    items = (liveItems ?? []) as unknown as DocumentLineItem[];
  }

  const snapshot = {
    document_kind: input.document_kind,
    document_no: row.invoice_no ?? row.document_no ?? null,
    document_type: input.document_kind === "invoice" ? "invoice" : String(row.document_type ?? "standalone_document"),
    issue_date: row.invoice_date ?? row.document_date ?? null,
    due_date: row.due_date ?? null,
    reference: row.reference_no ?? null,
    financial: {
      subtotal: row.subtotal ?? null,
      discount_amount: row.discount_amount ?? null,
      vat_mode: row.vat_mode ?? null,
      vat_rate: row.vat_rate ?? null,
      vat_amount: row.vat_amount ?? null,
      gross_amount: row.gross_amount ?? row.total_amount ?? null,
      total_amount: row.total_amount ?? null,
      wht_rate: row.wht_rate ?? null,
      wht_amount: row.wht_amount ?? null,
      net_payable: row.net_payable ?? null,
      paid_amount: row.paid_amount ?? null,
    },
    items: items ?? [],
    items_count: (items ?? []).length,
    legacy: { written_by: "canonical-write-service", note: input.note ?? null },
  };

  const { data: version, error } = await db
    .from("document_versions")
    .insert({
      [versionColumn]: input.document_id,
      version_no: versionNo,
      previous_version_id: prev ? String(prev.id) : null,
      status: input.status,
      data_completeness: input.data_completeness ?? (row.data_completeness === "LEGACY_PARTIAL" ? "LEGACY_PARTIAL" : "FULL"),
      snapshot,
      created_by: input.actor,
    })
    .select("id, version_no, previous_version_id, data_completeness")
    .single();
  if (error) throw new Error(`สร้าง version ไม่สำเร็จ: ${error.message}`);

  return {
    id: String(version.id),
    version_no: Number(version.version_no),
    previous_version_id: version.previous_version_id ? String(version.previous_version_id) : null,
    data_completeness: String(version.data_completeness),
  };
}

/**
 * Update a draft in place (the document is still a draft, so no new version yet).
 * Line items are REPLACED only when the caller supplies them, and the replacement
 * is a real delete+insert of item rows — never a fake row derived from a total.
 */
export async function updateDocumentDraft(input: {
  document_kind: WriteDocumentKind;
  document_id: string;
  actor: string;
  document_no?: string | null;
  document_type?: string | null;
  customer_company_id?: string | null;
  issue_date?: string | null;
  due_date?: string | null;
  reference_no?: string | null;
  notes?: string | null;
  rows?: { qty: number; unitPrice: number }[];
  discountAmount?: number;
  vatEnabled?: boolean;
  vatMode?: "exclusive" | "inclusive";
  withholdingTaxPercent?: number;
  items?: DocumentLineItem[];
}): Promise<{ document_id: string; items_written: number | null; totals: ReturnType<typeof computeCanonicalTotals> }> {
  const db = supabaseAdmin();
  const table = input.document_kind === "invoice" ? "invoices" : "standalone_documents";
  const { data: current, error: readErr } = await db.from(table).select("*").eq("id", input.document_id).maybeSingle();
  if (readErr || !current) throw new Error("DOCUMENT_NOT_FOUND: ไม่พบเอกสารที่จะแก้ไข");
  const row = current as Record<string, unknown>;

  if (row.invoice_status === "VOID" || row.status === "void") {
    throw new Error("DOCUMENT_VOIDED: เอกสารนี้ถูกยกเลิกแล้ว แก้ไขไม่ได้ (ออกเอกสารใหม่แทน)");
  }

  const totals = computeCanonicalTotals({
    rows: input.rows ?? [],
    discountAmount: input.discountAmount ?? Number(row.discount_amount ?? 0),
    vatEnabled: input.vatEnabled ?? Number(row.vat_rate ?? 0) > 0,
    vatMode: input.vatMode ?? ((row.vat_mode as "exclusive" | "inclusive" | null) ?? "exclusive"),
    withholdingTaxPercent: input.withholdingTaxPercent ?? Number(row.wht_rate ?? 0) * 100,
  });

  const payload: Record<string, unknown> = { ...columnPayload(totals), updated_at: new Date().toISOString() };
  if (input.document_no !== undefined) payload[input.document_kind === "invoice" ? "invoice_no" : "document_no"] = input.document_no;
  if (input.document_type !== undefined && input.document_kind !== "invoice") payload.document_type = input.document_type;
  if (input.customer_company_id !== undefined) payload.customer_company_id = input.customer_company_id;
  if (input.reference_no !== undefined) payload.reference_no = input.reference_no;
  if (input.notes !== undefined) payload.notes = input.notes;
  if (input.issue_date !== undefined) payload[input.document_kind === "invoice" ? "invoice_date" : "document_date"] = input.issue_date;
  if (input.due_date !== undefined && input.document_kind === "invoice") payload.due_date = input.due_date;

  const { error } = await db.from(table).update(payload).eq("id", input.document_id);
  if (error) throw new Error(`แก้ไขเอกสารไม่สำเร็จ: ${error.message}`);

  let itemsWritten: number | null = null;
  if (input.items) {
    if (input.document_kind === "invoice") {
      const { error: delErr } = await db.from("invoice_items").delete().eq("invoice_id", input.document_id);
      if (delErr) throw new Error(`ล้างรายการสินค้าเดิมไม่สำเร็จ: ${delErr.message}`);
    } else {
      const { error: delErr } = await db.from("standalone_document_items").delete().eq("document_id", input.document_id);
      if (delErr) throw new Error(`ล้างรายการสินค้าเดิมไม่สำเร็จ: ${delErr.message}`);
    }
    itemsWritten = await persistLineItems(input.document_kind, input.document_id, input.items);
  }

  await recordCanonicalAudit({
    action: "document.updated",
    entity_type: table,
    entity_id: input.document_id,
    actor: input.actor,
    company_id: (payload.customer_company_id as string) ?? (row.customer_company_id as string) ?? null,
    old_value: { total_amount: row.total_amount ?? null, subtotal: row.subtotal ?? null, vat_amount: row.vat_amount ?? null },
    new_value: { gross_amount: totals.gross_amount, subtotal: totals.subtotal, vat_amount: totals.vat_amount, wht_amount: totals.wht_amount, net_payable: totals.net_payable },
    evidence: { items_written: itemsWritten },
  });

  return { document_id: input.document_id, items_written: itemsWritten, totals };
}

/**
 * Issue/finalize a document: status change + a NEW version snapshot (append-only).
 * An issued document always has at least version 1; issuing creates v2+ so the
 * issued numbers are frozen in the chain.
 */
export async function issueDocument(input: {
  document_kind: WriteDocumentKind;
  document_id: string;
  actor: string;
  new_status?: string;
}): Promise<{ document_id: string; status: string; version: { id: string; version_no: number; previous_version_id: string | null } }> {
  const db = supabaseAdmin();
  const table = input.document_kind === "invoice" ? "invoices" : "standalone_documents";
  const { data: before, error: readErr } = await db.from(table).select("*").eq("id", input.document_id).maybeSingle();
  if (readErr || !before) throw new Error("DOCUMENT_NOT_FOUND: ไม่พบเอกสารที่จะออก");
  const row = before as Record<string, unknown>;
  if (row.invoice_status === "VOID" || row.status === "void") throw new Error("DOCUMENT_VOIDED: เอกสารนี้ถูกยกเลิกแล้ว");

  const status =
    input.new_status ?? (input.document_kind === "invoice" ? (row.invoice_status === "DRAFT" ? "SENT" : String(row.invoice_status)) : "active");
  const { data: liveItems } =
    input.document_kind === "invoice"
      ? await db.from("invoice_items").select("description, qty, unit, unit_price, line_total, sort_order").eq("invoice_id", input.document_id).order("sort_order", { ascending: true })
      : await db.from("standalone_document_items").select("description, qty, unit, unit_price, sort_order").eq("document_id", input.document_id).order("sort_order", { ascending: true });
  if (!liveItems?.length) {
    throw new Error("DOCUMENT_ITEMS_MISSING: ออกเอกสารไม่ได้เมื่อไม่มีรายการสินค้าจริง (ห้ามสร้างแถวจากยอดรวม)");
  }

  const { error } = await db
    .from(table)
    .update(input.document_kind === "invoice" ? { invoice_status: status, updated_at: new Date().toISOString() } : { status: "active", updated_at: new Date().toISOString() })
    .eq("id", input.document_id);
  if (error) throw new Error(`เปลี่ยนสถานะเอกสารไม่สำเร็จ: ${error.message}`);

  const version = await createVersion({
    document_kind: input.document_kind,
    document_id: input.document_id,
    actor: input.actor,
    status: "active",
    line_items: liveItems as unknown as DocumentLineItem[],
  });

  await recordCanonicalAudit({
    action: "document.issued",
    entity_type: table,
    entity_id: input.document_id,
    actor: input.actor,
    company_id: (row.customer_company_id as string) ?? null,
    field: "status",
    old_value: input.document_kind === "invoice" ? (row.invoice_status as string) : null,
    new_value: status,
    evidence: { version_id: version.id, version_no: version.version_no, items: (liveItems ?? []).length },
  });

  return { document_id: input.document_id, status, version: { id: version.id, version_no: version.version_no, previous_version_id: version.previous_version_id } };
}

/**
 * Void a document — business semantics, never a delete.
 * invoices: invoice_status = VOID · standalone_documents: status = void
 * Both cases append a void version and keep every row.
 */
export async function voidDocument(input: { document_kind: WriteDocumentKind; document_id: string; actor: string; reason?: string | null }) {
  const db = supabaseAdmin();
  const table = input.document_kind === "invoice" ? "invoices" : "standalone_documents";
  const { data: before, error: readErr } = await db.from(table).select("*").eq("id", input.document_id).maybeSingle();
  if (readErr || !before) throw new Error("DOCUMENT_NOT_FOUND: ไม่พบเอกสารที่จะยกเลิก");
  const row = before as Record<string, unknown>;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.document_kind === "invoice") patch.invoice_status = "VOID";
  else {
    patch.status = "void";
    patch.void_reason = input.reason ?? null;
    patch.voided_at = new Date().toISOString();
  }
  const { error } = await db.from(table).update(patch).eq("id", input.document_id);
  if (error) throw new Error(`ยกเลิกเอกสารไม่สำเร็จ: ${error.message}`);

  const version = await createVersion({
    document_kind: input.document_kind,
    document_id: input.document_id,
    actor: input.actor,
    status: "void",
    note: input.reason ?? null,
  });

  await recordCanonicalAudit({
    action: "document.voided",
    entity_type: table,
    entity_id: input.document_id,
    actor: input.actor,
    company_id: (row.customer_company_id as string) ?? null,
    field: input.document_kind === "invoice" ? "invoice_status" : "status",
    old_value: input.document_kind === "invoice" ? (row.invoice_status as string) : (row.status as string),
    new_value: "VOID",
    evidence: { version_id: version.id, reason: input.reason ?? null, no_delete: true },
  });

  return { document_id: input.document_id, version_id: version.id, version_no: version.version_no, deleted: false };
}




