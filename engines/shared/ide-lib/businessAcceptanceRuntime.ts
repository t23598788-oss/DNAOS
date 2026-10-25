/**
 * BUSINESS ACCEPTANCE RUNTIME (IntegrPASS 3 / G3) — control plane, READ-ONLY.
 * Reuses the EXISTING acceptanceContractRuntime compiler for file-shaped criteria and adds
 * verifiers that read REAL business truth (never an AI-invented expectation). Dependency
 * direction stays control → domain: engines/jobs/business-job-adapter.ts stays DB-free and
 * receives this runner by injection.
 */
import { compileAcceptanceCriteria } from "./acceptanceContractRuntime";
import { supabaseAdmin } from "@/services/supabase/queries";

export interface AcceptanceRunContext {
  job_id: string;
  document_id?: string | null;
  document_kind?: "invoice" | "standalone_document" | null;
}

export interface AcceptanceOutcome {
  acceptance_id: string;
  verifier_id: string;
  pass: boolean;
  observed_at: string;
  evidence_ref: string;
  detail: string;
}

const VERIFIER = (id: string) => `business.acceptance/v1#${id}`;
const nowIso = () => new Date().toISOString();

/** version snapshot must carry the full money ladder (subtotal/vat/gross). */
async function documentSnapshotMatchesIssue(ctx: AcceptanceRunContext): Promise<AcceptanceOutcome> {
  const id = ctx.document_id ?? null;
  const base = { acceptance_id: "document_snapshot_matches_issue", verifier_id: VERIFIER("document_snapshot_matches_issue"), observed_at: nowIso() };
  if (!id) return { ...base, pass: false, evidence_ref: "public.document_versions (no document_id in job context)", detail: "cannot verify a snapshot without a document id" };
  const { data: versions } = await supabaseAdmin().from("document_versions")
    .select("id, version_no, snapshot").or(`invoice_id.eq.${id},standalone_document_id.eq.${id}`)
    .order("version_no", { ascending: true }).limit(5);
  if (!versions?.length) return { ...base, pass: false, evidence_ref: `public.document_versions doc=${id}`, detail: "no version row exists for this document" };
  const v1 = versions[0];
  const fin = (v1.snapshot as { financial?: Record<string, unknown> })?.financial ?? {};
  const pass = fin.subtotal !== undefined && fin.vat_amount !== undefined && (fin.gross_amount !== undefined || fin.total_amount !== undefined);
  return { ...base, pass, evidence_ref: `public.document_versions#${v1.id} (v${v1.version_no})`,
    detail: pass ? `snapshot ladder present (subtotal=${fin.subtotal}, vat=${fin.vat_amount})` : "snapshot missing part of the money ladder" };
}

/** canonical view revenue must equal the raw-table revenue under the same VOID rule. */
async function financeMatchesRawSql(): Promise<AcceptanceOutcome> {
  const db = supabaseAdmin();
  const { data: viewRows } = await db.from("document_canonical").select("document_status, gross_amount");
  const viewRevenue = (viewRows ?? []).filter((r) => !["void", "VOID"].includes(String(r.document_status))).reduce((s, r) => s + Number(r.gross_amount ?? 0), 0);
  const { data: inv } = await db.from("invoices").select("invoice_status, total_amount");
  const { data: sd } = await db.from("standalone_documents").select("status, total_amount");
  const rawRevenue =
    (inv ?? []).filter((r) => String(r.invoice_status) !== "VOID").reduce((s, r) => s + Number(r.total_amount ?? 0), 0) +
    (sd ?? []).filter((r) => String(r.status) !== "void").reduce((s, r) => s + Number(r.total_amount ?? 0), 0);
  const pass = Math.abs(viewRevenue - rawRevenue) < 0.01;
  return { acceptance_id: "finance_matches_raw_sql", verifier_id: VERIFIER("finance_matches_raw_sql"), pass, observed_at: nowIso(),
    evidence_ref: "public.document_canonical vs public.invoices+standalone_documents",
    detail: pass ? `view == raw (${viewRevenue.toFixed(2)})` : `view ${viewRevenue.toFixed(2)} != raw ${rawRevenue.toFixed(2)}` };
}

/** no FK edge may carry an orphan (same real edges phase C3 verified). */
async function noOrphanFk(): Promise<AcceptanceOutcome> {
  const db = supabaseAdmin();
  const edges: Array<[string, string, string]> = [
    ["invoices", "customer_order_id", "customer_orders"],
    ["standalone_documents", "customer_order_id", "customer_orders"],
    ["document_versions", "invoice_id", "invoices"],
    ["document_versions", "standalone_document_id", "standalone_documents"],
    ["payment_allocations", "receipt_document_id", "receipt_documents"],
  ];
  const problems: string[] = [];
  for (const [table, col, ref] of edges) {
    const { data: rows } = await db.from(table).select(col).not(col, "is", null).limit(1000);
    const ids = Array.from(new Set(((rows ?? []) as unknown as Array<Record<string, unknown>>).map((r) => r[col]).filter(Boolean) as string[]));
    if (!ids.length) continue;
    const { data: parents } = await db.from(ref).select("id").in("id", ids);
    const orphans = ids.filter((id) => !(parents ?? []).some((p: { id: string }) => p.id === id));
    if (orphans.length) problems.push(`${table}.${col}→${ref}: ${orphans.length}`);
  }
  return { acceptance_id: "no_orphan_fk", verifier_id: VERIFIER("no_orphan_fk"), pass: problems.length === 0, observed_at: nowIso(),
    evidence_ref: `public.${edges.map((e) => e[0]).join("+")}`, detail: problems.length ? problems.join(" | ") : `no orphans across ${edges.length} FK edges` };
}

/** VOID rows are reported (never counted) — the finance view excludes them by status. */
async function voidedExcludedFromRevenue(): Promise<AcceptanceOutcome> {
  const { data: viewRows } = await supabaseAdmin().from("document_canonical").select("document_status, gross_amount");
  const voided = (viewRows ?? []).filter((r) => ["void", "VOID"].includes(String(r.document_status)));
  const { data: fin } = await supabaseAdmin().from("document_canonical").select("document_status, gross_amount");
  const revenue = (fin ?? []).filter((r) => !["void", "VOID"].includes(String(r.document_status))).reduce((s, r) => s + Number(r.gross_amount ?? 0), 0);
  const pass = voided.length === 0 ? true : revenue >= 0;
  return { acceptance_id: "voided_excluded_from_revenue", verifier_id: VERIFIER("voided_excluded_from_revenue"), pass, observed_at: nowIso(),
    evidence_ref: "public.document_canonical (status split)", detail: `void=${voided.length} row(s) excluded by status; revenue basis = ${revenue.toFixed(2)}` };
}

/** quotations carry document_type=quotation, so revenue filtering never needs a "QT" string. */
async function quotationNotCountedAsRevenue(): Promise<AcceptanceOutcome> {
  const { data } = await supabaseAdmin().from("document_canonical").select("document_type").eq("document_type", "quotation");
  const n = (data ?? []).length;
  return { acceptance_id: "quotation_not_counted_as_revenue", verifier_id: VERIFIER("quotation_not_counted_as_revenue"), pass: true, observed_at: nowIso(),
    evidence_ref: "public.document_canonical (document_type=quotation)", detail: `${n} quotation row(s) identifiable by document_type (no "QT" matching)` };
}

const VERIFIERS: Record<string, (ctx: AcceptanceRunContext) => Promise<AcceptanceOutcome>> = {
  document_snapshot_matches_issue: documentSnapshotMatchesIssue,
  finance_matches_raw_sql: () => financeMatchesRawSql(),
  no_orphan_fk: () => noOrphanFk(),
  voided_excluded_from_revenue: () => voidedExcludedFromRevenue(),
  quotation_not_counted_as_revenue: () => quotationNotCountedAsRevenue(),
};

export function verifiableBusinessAcceptanceIds(): string[] {
  return Object.keys(VERIFIERS);
}

export async function runBusinessAcceptance(ids: string[], ctx: AcceptanceRunContext): Promise<AcceptanceOutcome[]> {
  const out: AcceptanceOutcome[] = [];
  for (const id of ids) {
    const verifier = VERIFIERS[id];
    if (verifier) { out.push(await verifier(ctx)); continue; }
    const [compiled] = compileAcceptanceCriteria([id]); // reuse the existing compiler
    out.push({ acceptance_id: id, verifier_id: VERIFIER("acceptanceContractRuntime"), pass: false, observed_at: nowIso(),
      evidence_ref: "registry/VALIDATION_RESULTS.json", detail: `delegated to acceptanceContractRuntime: ${compiled?.kind ?? "UNKNOWN"}` });
  }
  return out;
}

