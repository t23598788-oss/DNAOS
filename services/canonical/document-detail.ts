/**
 * DocumentDetail read model (Phase C6) — READ ONLY.
 * Contract: CANONICAL_MODEL_DOCUMENT_TRANSACTION_FINANCE_V1_1.md
 *
 * Opening a document reads the persisted version snapshot. When the snapshot is
 * thin (LEGACY_PARTIAL) the model reports `line_items_source: "unavailable"` and
 * returns the stored totals as-is — it NEVER rebuilds line items from total_amount.
 */
import { supabaseAdmin } from "@/services/supabase/queries";
import { canonicalFinancials, type CanonicalDocumentDetail, type DocumentKind } from "@/services/canonical/read-model";
import { getCanonicalAllocations } from "@/services/canonical/payments";

export async function getDocumentDetail(kind: DocumentKind, documentId: string): Promise<CanonicalDocumentDetail | null> {
  const db = supabaseAdmin();
  const isInvoice = kind === "invoice";
  const table = isInvoice ? "invoices" : "standalone_documents";

  const { data: doc, error } = await db.from(table).select("*").eq("id", documentId).maybeSingle();
  if (error || !doc) return null;
  const d = doc as Record<string, unknown>;

  const derived = isInvoice
    ? ((await db.from("invoice_payment_summary").select("*").eq("invoice_id", documentId).maybeSingle()).data as Record<string, unknown> | null)
    : null;

  const versionQuery = db
    .from("document_versions")
    .select("id, version_no, status, data_completeness, snapshot, created_at, created_by, previous_version_id")
    .order("version_no", { ascending: false })
    .limit(1);
  const { data: version } = await (isInvoice ? versionQuery.eq("invoice_id", documentId) : versionQuery.eq("standalone_document_id", documentId)).maybeSingle();
  const v = version as Record<string, unknown> | null;

  // artifacts belong to a VERSION, so a document's full set spans every version it has
  const { data: allVersions } = await (isInvoice
    ? db.from("document_versions").select("id").eq("invoice_id", documentId)
    : db.from("document_versions").select("id").eq("standalone_document_id", documentId)
  ).order("version_no", { ascending: true });
  const versionIds = ((allVersions ?? []) as Record<string, unknown>[]).map((row) => String(row.id));
  const { data: artifacts } = versionIds.length
    ? await db
        .from("document_artifacts")
        .select("id, document_version_id, kind, storage_bucket, storage_path, sha256, size_bytes, mime_type, produced_by, created_at")
        .in("document_version_id", versionIds)
        .order("created_at", { ascending: true })
    : { data: [] as Record<string, unknown>[] };

  const { data: sourceLinks } = await db
    .from("inbound_source_links")
    .select("*")
    .or(isInvoice ? `invoice_id.eq.${documentId}` : `standalone_document_id.eq.${documentId}`);
  const inboundIds = [
    ...new Set((sourceLinks ?? []).map((l: Record<string, unknown>) => l.receipt_document_id).filter(Boolean) as string[]),
  ];
  const { data: inbound } = inboundIds.length
    ? await db.from("receipt_documents_bank_line").select("*").in("receipt_document_id", inboundIds)
    : { data: [] as Record<string, unknown>[] };

  const allocations = await getCanonicalAllocations(isInvoice ? { invoiceId: documentId } : { standaloneDocumentId: documentId });

  // line items: snapshot first; live rows only to *describe* legacy gaps, never to invent
  const snapshotItems = (v?.snapshot as Record<string, unknown> | undefined)?.items;
  let lineItems: Record<string, unknown>[] = Array.isArray(snapshotItems) ? (snapshotItems as Record<string, unknown>[]) : [];
  let itemsSource: CanonicalDocumentDetail["line_items_source"] = lineItems.length ? "version_snapshot" : "unavailable";
  if (!lineItems.length) {
    const { data: live } = isInvoice
      ? await db.from("invoice_items").select("*").eq("invoice_id", documentId).order("sort_order", { ascending: true })
      : await db.from("standalone_document_items").select("*").eq("document_id", documentId).order("sort_order", { ascending: true });
    if (live?.length) {
      lineItems = live as Record<string, unknown>[];
      itemsSource = "live_items";
    }
  }

  const { data: audit } = await db
    .from("audit_logs")
    .select("*")
    .eq("entity_id", documentId)
    .order("created_at", { ascending: true });

  const snapshotFinancial = ((v?.snapshot as Record<string, unknown> | undefined)?.financial ?? null) as Record<string, unknown> | null;

  return {
    identity: {
      document_kind: kind,
      document_id: documentId,
      document_no: (d.document_no as string) ?? (d.invoice_no as string) ?? null,
      document_type: isInvoice ? "invoice" : String(d.document_type ?? "standalone_document"),
      document_status: (d.invoice_status as string) ?? (d.status as string) ?? null,
      created_at: (d.created_at as string) ?? null,
      updated_at: (d.updated_at as string) ?? null,
    },
    financials: canonicalFinancials(d, derived),
    version: v
      ? {
          id: String(v.id),
          version_no: Number(v.version_no),
          status: String(v.status),
          data_completeness: String(v.data_completeness),
          created_at: String(v.created_at),
          snapshot: (v.snapshot as Record<string, unknown>) ?? {},
        }
      : null,
    line_items: lineItems,
    line_items_source: itemsSource,
    tax_snapshot: snapshotFinancial,
    transaction_link: {
      customer_order_id: (d.customer_order_id as string) ?? null,
      project_id: (d.project_id as string) ?? null,
    },
    source_lineage: (sourceLinks ?? []).map((l: Record<string, unknown>) => {
      const rc = (inbound ?? []).find((r: Record<string, unknown>) => r.receipt_document_id === l.receipt_document_id) ?? null;
      return { ...l, source_record: rc };
    }),
    generated_artifacts: (artifacts ?? []) as Record<string, unknown>[],
    payment_allocations: allocations,
    derived_financials: derived
      ? {
          paid_amount: Number(derived.paid_amount ?? 0),
          outstanding: derived.outstanding === null || derived.outstanding === undefined ? null : Number(derived.outstanding),
          derived_status: (derived.derived_status as string) ?? null,
          receivable_basis: String(derived.receivable_basis),
        }
      : null,
    audit_evidence: (audit ?? []) as Record<string, unknown>[],
  };
}
