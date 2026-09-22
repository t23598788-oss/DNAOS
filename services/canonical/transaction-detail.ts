/**
 * TransactionDetail read model (Phase C6) — READ ONLY.
 * Contract: CANONICAL_MODEL_DOCUMENT_TRANSACTION_FINANCE_V1_1.md
 * Composes: customer_orders · companies · customer_sites · projects ·
 * document_groups · document_canonical · invoice_payment_summary ·
 * business_events · inbound_source_links · document_versions ·
 * document_artifacts · payment_allocations · company_debt_current · audit_logs
 */
import { supabaseAdmin } from "@/services/supabase/queries";
import { canonicalFinancials, type CanonicalFinancials, type CanonicalTransactionDetail } from "@/services/canonical/read-model";
import { getCanonicalAllocationsForDocuments, getCanonicalCompanyDebt } from "@/services/canonical/payments";

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const round2 = (n: number) => Math.round(n * 100) / 100;
const ZERO = "00000000-0000-0000-0000-000000000000";

export async function getTransactionDetail(
  orderId: string,
  options?: { includeAudit?: boolean },
): Promise<CanonicalTransactionDetail | null> {
  const db = supabaseAdmin();

  const { data: order, error } = await db.from("customer_orders").select("*").eq("id", orderId).maybeSingle();
  if (error || !order) return null;
  const o = order as Record<string, unknown>;

  const [company, site, project, group] = await Promise.all([
    o.customer_company_id ? db.from("companies").select("*").eq("id", o.customer_company_id).maybeSingle() : Promise.resolve({ data: null }),
    o.customer_site_id ? db.from("customer_sites").select("*").eq("id", o.customer_site_id).maybeSingle() : Promise.resolve({ data: null }),
    o.project_id ? db.from("projects").select("*").eq("id", o.project_id).maybeSingle() : Promise.resolve({ data: null }),
    o.document_group_id ? db.from("document_groups").select("*").eq("id", o.document_group_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  // documents of this transaction — linkage ONLY via the existing customer_order_id FK
  const { data: docs } = await db
    .from("document_canonical")
    .select("*")
    .eq("customer_order_id", orderId)
    .order("issue_date", { ascending: true });
  const documents = (docs ?? []) as Record<string, unknown>[];
  const invoiceIds = documents.filter((d) => d.document_kind === "invoice").map((d) => String(d.document_id));
  const standaloneIds = documents.filter((d) => d.document_kind === "standalone_document").map((d) => String(d.document_id));
  const docRefs = documents.map((d) => ({ document_kind: String(d.document_kind), document_id: String(d.document_id) }));
  const invoiceFilter = invoiceIds.length ? invoiceIds.join(",") : ZERO;
  const standaloneFilter = standaloneIds.length ? standaloneIds.join(",") : ZERO;

  const { data: summaries } = invoiceIds.length
    ? await db.from("invoice_payment_summary").select("*").in("invoice_id", invoiceIds)
    : { data: [] as Record<string, unknown>[] };
  const summaryByInvoice = new Map((summaries ?? []).map((s: Record<string, unknown>) => [String(s.invoice_id), s]));

  const { data: versions } = docRefs.length
    ? await db
        .from("document_versions")
        .select("id, invoice_id, standalone_document_id, version_no, status, data_completeness, created_at, created_by")
        .or(`invoice_id.in.(${invoiceFilter}),standalone_document_id.in.(${standaloneFilter})`)
        .order("version_no", { ascending: true })
    : { data: [] as Record<string, unknown>[] };
  const versionIds = (versions ?? []).map((v: Record<string, unknown>) => String(v.id));

  const [eventsRes, auditRes, sourceRes, artifactsRes, allocations] = await Promise.all([
    db.from("business_events").select("*").eq("transaction_id", orderId).order("occurred_at", { ascending: true }),
    options?.includeAudit === false
      ? Promise.resolve({ data: [] as Record<string, unknown>[] })
      : db.from("audit_logs").select("*").eq("entity_type", "customer_order").eq("entity_id", orderId).order("created_at", { ascending: true }),
    docRefs.length
      ? db
          .from("inbound_source_links")
          .select("*")
          .or(`invoice_id.in.(${invoiceFilter}),standalone_document_id.in.(${standaloneFilter})`)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    versionIds.length
      ? db
          .from("document_artifacts")
          .select("id, document_version_id, kind, storage_bucket, storage_path, sha256, size_bytes, mime_type, produced_by, created_at")
          .in("document_version_id", versionIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    getCanonicalAllocationsForDocuments(docRefs),
  ]);

  const inboundIds = [
    ...new Set((sourceRes.data ?? []).map((l: Record<string, unknown>) => l.receipt_document_id).filter(Boolean) as string[]),
  ];
  const { data: inbound } = inboundIds.length
    ? await db.from("receipt_documents_bank_line").select("*").in("receipt_document_id", inboundIds)
    : { data: [] as Record<string, unknown>[] };

  const financials = documents.map((d) => ({
    ref: d,
    fin: canonicalFinancials(
      d,
      d.document_kind === "invoice" ? ((summaryByInvoice.get(String(d.document_id)) as Record<string, unknown> | undefined) ?? null) : null,
    ),
  }));
  const sum = (pick: (f: CanonicalFinancials) => number | null) =>
    round2(financials.reduce((acc, x) => acc + (pick(x.fin) ?? 0), 0));
  const debt = o.customer_company_id ? await getCanonicalCompanyDebt(String(o.customer_company_id)) : null;

  return {
    transaction: o,
    company: (company as { data: Record<string, unknown> | null }).data ?? null,
    site: (site as { data: Record<string, unknown> | null }).data ?? null,
    project: (project as { data: Record<string, unknown> | null }).data ?? null,
    document_group: (group as { data: Record<string, unknown> | null }).data ?? null,
    financial_summary: {
      document_count: documents.length,
      subtotal: sum((f) => f.subtotal),
      vat_amount: sum((f) => f.vat_amount),
      gross_amount: sum((f) => f.gross_amount ?? f.total_amount_persisted),
      paid_amount: round2(allocations.reduce((acc, a) => acc + (a.amount ?? 0), 0)),
      outstanding: sum((f) => f.outstanding),
      by_document: financials.map((x) => x.fin),
    },
    business_events: (eventsRes.data ?? []) as Record<string, unknown>[],
    inbound_sources: (inbound ?? []) as Record<string, unknown>[],
    generated_documents: documents.map((d) => ({
      document_kind: String(d.document_kind) as "invoice" | "standalone_document",
      document_id: String(d.document_id),
      document_no: (d.document_no as string) ?? null,
      document_type: String(d.document_type),
      document_status: (d.document_status as string) ?? null,
      current_version_no: num(d.current_version_no),
    })),
    versions: (versions ?? []) as Record<string, unknown>[],
    artifacts: (artifactsRes.data ?? []) as Record<string, unknown>[],
    payments: allocations,
    debt,
    evidence: {
      audit_logs: (auditRes.data ?? []) as Record<string, unknown>[],
      version_snapshots: (versions ?? []).length,
      note: "totals are the persisted canonical values; none were recomputed in the read model",
    },
  };
}
