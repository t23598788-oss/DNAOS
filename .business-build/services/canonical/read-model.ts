/**
 * Canonical read model (Phase C6) — the ONE place that assembles the
 * Document / Transaction / Finance truth for backend consumers.
 *
 * Contract: CANONICAL_MODEL_DOCUMENT_TRANSACTION_FINANCE_V1_1.md
 *   - reads the canonical tables/views only; never rebuilds numbers
 *   - every money figure is the PERSISTED one (+ the basis it came from)
 *   - opening a document reads the version snapshot; a legacy document is
 *     reported as LEGACY_PARTIAL instead of being reconstructed from total_amount
 *   - transaction↔document linkage uses the existing `customer_order_id` FK only
 *
 * No writes, no UI concerns, no new owner: this module is a projection layer.
 */
import type { CanonicalPaymentAllocation } from "@/services/canonical/payments";

export type DocumentKind = "invoice" | "standalone_document";

export interface CanonicalDocumentRef {
  document_kind: DocumentKind;
  document_id: string;
  document_no: string | null;
  document_type: string;
}

export interface CanonicalFinancials {
  subtotal: number | null;
  discount_amount: number | null;
  vat_rate: number | null;
  vat_mode: string | null;
  vat_amount: number | null;
  gross_amount: number | null;
  wht_rate: number | null;
  wht_amount: number | null;
  net_payable: number | null;
  total_amount_persisted: number | null;
  paid_amount: number | null;
  outstanding: number | null;
  receivable_basis: string;
  data_completeness: "FULL" | "LEGACY_PARTIAL";
}

export interface CanonicalTransactionDetail {
  transaction: Record<string, unknown> | null;
  company: Record<string, unknown> | null;
  site: Record<string, unknown> | null;
  project: Record<string, unknown> | null;
  document_group: Record<string, unknown> | null;
  financial_summary: {
    document_count: number;
    subtotal: number;
    vat_amount: number;
    gross_amount: number;
    paid_amount: number;
    outstanding: number;
    by_document: CanonicalFinancials[];
  };
  business_events: Record<string, unknown>[];
  inbound_sources: Record<string, unknown>[];
  generated_documents: (CanonicalDocumentRef & { document_status: string | null; current_version_no: number | null })[];
  versions: Record<string, unknown>[];
  artifacts: Record<string, unknown>[];
  payments: CanonicalPaymentAllocation[];
  debt: Record<string, unknown> | null;
  evidence: { audit_logs: Record<string, unknown>[]; version_snapshots: number; note: string };
}

export interface CanonicalDocumentDetail {
  identity: CanonicalDocumentRef & { document_status: string | null; created_at: string | null; updated_at: string | null };
  financials: CanonicalFinancials;
  version: {
    id: string;
    version_no: number;
    status: string;
    data_completeness: string;
    created_at: string;
    snapshot: Record<string, unknown>;
  } | null;
  line_items: Record<string, unknown>[];
  line_items_source: "version_snapshot" | "live_items" | "unavailable";
  tax_snapshot: Record<string, unknown> | null;
  transaction_link: { customer_order_id: string | null; project_id: string | null };
  source_lineage: Record<string, unknown>[];
  generated_artifacts: Record<string, unknown>[];
  payment_allocations: CanonicalPaymentAllocation[];
  derived_financials: { paid_amount: number; outstanding: number | null; derived_status: string | null; receivable_basis: string } | null;
  audit_evidence: Record<string, unknown>[];
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function completenessOf(row: { data_completeness?: unknown }): "FULL" | "LEGACY_PARTIAL" {
  return row.data_completeness === "FULL" ? "FULL" : "LEGACY_PARTIAL";
}

/** Canonical financial ladder exactly as persisted (no recomputation). */
export function canonicalFinancials(row: Record<string, unknown>, derived?: Record<string, unknown> | null): CanonicalFinancials {
  const netPayable = num(row.net_payable);
  const gross = num(row.gross_amount);
  const totalPersisted = num(row.total_amount);
  const basis = netPayable !== null ? "net_payable" : gross !== null ? "gross_amount (legacy: wht unknown)" : "total_amount (legacy)";
  const paid = num(derived?.paid_amount ?? row.paid_amount) ?? 0;
  const receivable = netPayable ?? gross ?? totalPersisted;
  return {
    subtotal: num(row.subtotal),
    discount_amount: num(row.discount_amount),
    vat_rate: num(row.vat_rate),
    vat_mode: (row.vat_mode as string | null) ?? null,
    vat_amount: num(row.vat_amount),
    gross_amount: gross,
    wht_rate: num(row.wht_rate),
    wht_amount: num(row.wht_amount),
    net_payable: netPayable,
    total_amount_persisted: totalPersisted,
    paid_amount: paid,
    outstanding: receivable === null ? null : Math.round((receivable - paid) * 100) / 100,
    receivable_basis: basis,
    data_completeness: completenessOf(row),
  };
}
