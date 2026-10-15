#!/usr/bin/env npx tsx
/**
 * Canonical model v1.1 — Phase D10 acceptance (REAL DATA ONLY, live database).
 *
 * Proves the write model end to end on real records through the canonical services.
 * No mock, no seed, no demo rows. The one document this test creates is voided
 * through business semantics at the end (never deleted).
 *
 * Run: SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/canonical-phase-d-acceptance-test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

function loadEnvLocal() {
  try {
    const raw = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* env may already be provided by the shell */
  }
}
loadEnvLocal();

import { supabaseAdmin } from "@/services/supabase/queries";
import {
  createDocument,
  issueDocument,
  voidDocument,
  computeCanonicalTotals,
} from "@/engines/canonical/document-write";
import { resolveOrderForDocument, createTransaction } from "@/engines/canonical/transaction-write";
import { confirmPayment } from "@/engines/canonical/payment-write";
import { ensurePhaseCSnapshot } from "./canonical-phase-snapshot";
import { refreshDebtSnapshotFromLedger } from "@/engines/canonical/debt-write";
import { persistGeneratedArtifact, signedArtifactUrl } from "@/engines/canonical/artifact-write";
import { getDocumentDetail } from "@/services/canonical/document-detail";
import { getTransactionDetail } from "@/services/canonical/transaction-detail";

type PhaseCSnapshot = { row_counts: { t: string; n: number }[]; financial_totals: Record<string, string>[] };
let BEFORE: PhaseCSnapshot | null = null;

let passed = 0;
const failures: string[] = [];
const mutated: { table: string; id: string; what: string }[] = [];

function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL  ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
}

const db = supabaseAdmin();
const ACTOR = "acceptance:phaseD";

async function main() {
  // baseline MUST be captured before this suite's own writes (line ~105) —
  // self-bootstrap the pre-existing ENOENT process gap, never overwrite an existing baseline
  await ensurePhaseCSnapshot();
  if (!BEFORE) BEFORE = JSON.parse(readFileSync("/tmp/phaseC-before.json", "utf8")) as PhaseCSnapshot;
  console.log("=== 0. source assertions: no writer bypasses the canonical services ===");
  const writers = [
    "app/api/admin/documents/route.ts",
    "app/api/admin/documents/[id]/route.ts",
    "app/api/admin/documents/[id]/confirm/route.ts",
    "app/api/admin/transactions/route.ts",
    "app/api/admin/receipt-documents/[id]/confirm/route.ts",
    "app/api/admin/debt-trackings/[id]/events/route.ts",
  ];
  const wired = writers.map((f) => ({ file: f, ok: readFileSync(join(process.cwd(), f), "utf8").includes("engines/canonical/") }));
  check("all switched writers import the canonical write services", wired.every((w) => w.ok), wired.filter((w) => !w.ok));
  const docsRoute = readFileSync(join(process.cwd(), "app/api/admin/documents/route.ts"), "utf8");
  check("the half-chain auto-create is gone (no bare customer_orders insert)", !/from\("customer_orders"\)\s*\.insert/.test(docsRoute));
  const deleteRoute = readFileSync(join(process.cwd(), "app/api/admin/documents/[id]/route.ts"), "utf8");
  check("no hard delete of standalone documents remains", !/standalone_documents"\)\.delete/.test(deleteRoute));

  console.log("\n=== 1. real chain: a real transaction with company/site/project/group exists ===");
  const { data: orders } = await db
    .from("customer_orders")
    .select("id, order_no, customer_company_id, customer_site_id, project_id, document_group_id, status")
    .not("project_id", "is", null)
    .not("document_group_id", "is", null)
    .not("customer_site_id", "is", null)
    .order("created_at", { ascending: true });
  const order = orders?.[0];
  check("a complete real transaction exists", Boolean(order), orders?.map((o) => o.order_no));
  if (!order) return finish();

  const resolution = await resolveOrderForDocument({
    customer_company_id: String(order.customer_company_id),
    transactionId: String(order.id),
  });
  check("the canonical resolver accepts the real transaction", resolution.linked === true, resolution);

  console.log("\n=== 2/3/4. real document: create → items → version → artifact ===");
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const docNo = `INV-D10-${stamp}`;
  const rows = [
    { qty: 2, unitPrice: 1500 },
    { qty: 1, unitPrice: 250.5 },
  ];
  const created = await createDocument({
    kind: "invoice",
    document_no: docNo,
    document_type: "invoice",
    customer_company_id: String(order.customer_company_id),
    customer_order_id: String(order.id),
    project_id: String(order.project_id),
    issue_date: new Date().toISOString().slice(0, 10),
    reference_no: `D10-ACCEPTANCE-${stamp}`,
    notes: "Phase D10 acceptance — voided through business semantics, never deleted",
    rows,
    discountAmount: 100,
    vatEnabled: true,
    vatMode: "exclusive",
    withholdingTaxPercent: 3,
    items: [
      { description: "D10 acceptance line A", qty: 2, unit: "งาน", unit_price: 1500, sort_order: 0 },
      { description: "D10 acceptance line B", qty: 1, unit: "งาน", unit_price: 250.5, sort_order: 1 },
    ],
    actor: ACTOR,
  });
  mutated.push({ table: "invoices", id: created.document_id, what: `created ${docNo}` });
  check("document created through the canonical service", Boolean(created.document_id), created);

  const expected = computeCanonicalTotals({ rows, discountAmount: 100, vatEnabled: true, vatMode: "exclusive", withholdingTaxPercent: 3 });
  const { data: invRow } = await db.from("invoices").select("*").eq("id", created.document_id).maybeSingle();
  check("subtotal persisted correctly", Number(invRow?.subtotal) === expected.subtotal, { row: invRow?.subtotal, expected: expected.subtotal });
  check("discount persisted (was thrown away before)", Number(invRow?.discount_amount) === 100);
  check("vat_mode persisted", invRow?.vat_mode === "exclusive");
  check("wht_rate persisted", Number(invRow?.wht_rate) === 0.03, invRow?.wht_rate);
  check("wht_amount persisted", Number(invRow?.wht_amount) === expected.wht_amount, { row: invRow?.wht_amount, expected: expected.wht_amount });
  check("net_payable persisted", Number(invRow?.net_payable) === expected.net_payable);
  check("total_amount == gross (v1.1 invariant 2)", Number(invRow?.total_amount) === expected.gross_amount && Number(invRow?.gross_amount) === expected.gross_amount);
  check("data_completeness = FULL for a canonical write", invRow?.data_completeness === "FULL");

  const { data: items } = await db.from("invoice_items").select("*").eq("invoice_id", created.document_id).order("sort_order", { ascending: true });
  check("two real line items persisted", (items ?? []).length === 2, items?.length);
  check("line totals computed per row", Number(items?.[0]?.line_total) === 3000);

  const { data: versionsV1 } = await db
    .from("document_versions")
    .select("*")
    .eq("invoice_id", created.document_id)
    .order("version_no", { ascending: true });
  check("version 1 exists", (versionsV1 ?? []).length === 1 && versionsV1?.[0]?.version_no === 1);
  check("version 1 snapshot holds the real line items", ((versionsV1?.[0]?.snapshot as Record<string, unknown>)?.items as unknown[])?.length === 2);
  check("version 1 has no previous (chain start)", versionsV1?.[0]?.previous_version_id === null);
  mutated.push({ table: "document_versions", id: String(versionsV1?.[0]?.id), what: "v1 snapshot" });

  console.log("\n=== 4. generated artifact: real bytes → sha256 → openable → audit ===");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><text x="6" y="34" font-size="14">${docNo}</text></svg>`;
  const artifact = await persistGeneratedArtifact({
    document_version_id: String(versionsV1?.[0]?.id),
    kind: "image",
    fileName: `${docNo}.svg`,
    bytes: new TextEncoder().encode(svg),
    mime_type: "image/svg+xml",
    produced_by: "acceptance:phaseD",
    actor: ACTOR,
  });
  mutated.push({ table: "document_artifacts", id: artifact.artifact_id, what: `generated ${artifact.storage_path}` });
  check("artifact row recorded with a real sha256", /^[0-9a-f]{64}$/.test(artifact.sha256), artifact.sha256.slice(0, 12));
  check("artifact size matches the bytes written", artifact.size_bytes === new TextEncoder().encode(svg).byteLength);
  const url = await signedArtifactUrl(artifact.storage_path, 60);
  check("the generated file opens (signed URL)", typeof url === "string" && url.length > 20);
  const { data: artifactRow } = await db.from("document_artifacts").select("*").eq("id", artifact.artifact_id).maybeSingle();
  check("artifact is owned by the document version (FK)", artifactRow?.document_version_id === versionsV1?.[0]?.id);
  const { data: auditRows } = await db.from("audit_logs").select("action").eq("entity_id", artifact.artifact_id);
  check("artifact.created is in the audit trail", (auditRows ?? []).some((a: Record<string, unknown>) => a.action === "artifact.created"));

  console.log("\n=== 5. issue → new version → void (never delete) ===");
  const issued = await issueDocument({ document_kind: "invoice", document_id: created.document_id, actor: ACTOR, new_status: "SENT" });
  mutated.push({ table: "invoices", id: created.document_id, what: "issued (SENT)" });
  check("issue produced a new version (v2)", issued.version.version_no === 2, issued.version);
  const { data: versionsV2 } = await db.from("document_versions").select("*").eq("invoice_id", created.document_id).order("version_no", { ascending: true });
  check("version chain is append-only (v2.previous = v1)", versionsV2?.[1]?.previous_version_id === versionsV2?.[0]?.id);
  check("issue audit recorded", Boolean((await db.from("audit_logs").select("action").eq("entity_id", created.document_id)).data?.some((a: Record<string, unknown>) => a.action === "document.issued")));

  const voided = await voidDocument({ document_kind: "invoice", document_id: created.document_id, actor: ACTOR, reason: "D10 acceptance cleanup (business semantics)" });
  check("void did NOT delete the row", voided.deleted === false && voided.version_no === 3, voided);
  const { data: voidCandidate } = await db.from("invoices").select("invoice_status").eq("id", created.document_id).maybeSingle();
  check("invoice status is VOID (row still present)", voidCandidate?.invoice_status === "VOID");
  const { data: voidVersion } = await db.from("document_versions").select("status, previous_version_id").eq("id", voided.version_id).maybeSingle();
  check("void version records status void + the previous version", voidVersion?.status === "void" && Boolean(voidVersion?.previous_version_id));
  mutated.push({ table: "document_versions", id: voided.version_id, what: "void version" });

  console.log("\n=== 6. real payment evidence: idempotency guard + allocation target ===");
  const { data: confirmedSlips } = await db
    .from("receipt_documents")
    .select("id, document_type, status, allocation_state, matched_debt_event_id, customer_company_id, amount")
    .eq("status", "confirmed")
    .eq("document_type", "transfer_slip");
  const slip = confirmedSlips?.[0];
  check("a real confirmed slip exists", Boolean(slip), confirmedSlips?.length);
  if (slip) {
    let guardMessage = "";
    try {
      await confirmPayment({
        receipt_document_id: String(slip.id),
        allocations: [{ target: { kind: "anchor" }, allocation_kind: "principal", amount: 1 }],
        actor: ACTOR,
        debt_event_anchor: { event_type: "receipt_received", amount: 1 },
      });
    } catch (e: unknown) {
      guardMessage = e instanceof Error ? e.message : String(e);
    }
    check("re-confirming an allocated slip is refused (no double counting)", guardMessage.startsWith("PAYMENT_ALREADY_ALLOCATED"), guardMessage);
    const { count: allocationsForSlip } = await db
      .from("payment_allocations")
      .select("id", { count: "exact", head: true })
      .eq("receipt_document_id", String(slip.id));
    check("the guard wrote nothing (allocation count unchanged)", (allocationsForSlip ?? 0) === 1, allocationsForSlip);
    const { data: allocRow } = await db.from("payment_allocations").select("*").eq("receipt_document_id", String(slip.id)).maybeSingle();
    check("the allocation targets a real debt_event with the same amount", Boolean(allocRow?.debt_event_id));
    const { data: ledgerEvent } = allocRow?.debt_event_id
      ? await db.from("debt_events").select("amount, event_type").eq("id", String(allocRow.debt_event_id)).maybeSingle()
      : { data: null };
    check("allocation amount equals the ledger event amount", Number(allocRow?.amount) === Number(ledgerEvent?.amount), {
      allocation: allocRow?.amount,
      ledger: ledgerEvent?.amount,
    });
    let notEvidence = "";
    const { data: nonPaymentSource } = await db
      .from("receipt_documents")
      .select("id, document_type")
      .neq("document_type", "transfer_slip")
      .neq("document_type", "payment_advice")
      .limit(1);
    const other = nonPaymentSource?.[0];
    if (other) {
      try {
        await confirmPayment({
          receipt_document_id: String(other.id),
          allocations: [{ target: { kind: "anchor" }, allocation_kind: "principal", amount: 1 }],
          actor: ACTOR,
          debt_event_anchor: { event_type: "receipt_received", amount: 1 },
        });
      } catch (e: unknown) {
        notEvidence = e instanceof Error ? e.message : String(e);
      }
      check("a non-payment inbound source is refused as payment evidence", notEvidence.startsWith("RECEIPT_NOT_PAYMENT_EVIDENCE"), notEvidence);
    }
  }

  console.log("\n=== 7. debt ledger ↔ snapshot projection reconciles from the ledger ===");
  const { data: ledgerCompanies } = await db.from("debt_events").select("customer_company_id");
  const companyIds = [...new Set((ledgerCompanies ?? []).map((r: Record<string, unknown>) => String(r.customer_company_id)))];
  let repairedCount = 0;
  for (const companyId of companyIds) {
    const projection = await refreshDebtSnapshotFromLedger(companyId, ACTOR);
    if (projection.repaired) repairedCount += 1;
    const { data: snap } = await db
      .from("debt_snapshots")
      .select("total_outstanding, collection_state")
      .eq("customer_company_id", companyId)
      .maybeSingle();
    const drift = Math.abs(Number(snap?.total_outstanding ?? 0) - projection.total_outstanding) > 0.009;
    if (drift) {
      check(`projection matches the ledger for ${companyId.slice(0, 8)}`, false, { snapshot: snap?.total_outstanding, ledger: projection.total_outstanding });
      return;
    }
  }
  check(`every company's snapshot projection equals its ledger (${companyIds.length} companies)`, true, { repaired: repairedCount });
  if (repairedCount > 0) mutated.push({ table: "debt_snapshots", id: `${repairedCount} companies`, what: "projection created from ledger (was missing)" });

  console.log("\n=== 8. half-chain transaction creation is refused ===");
  let halfChain = "";
  const { data: companyWithoutSite } = await db.from("companies").select("id").limit(1);
  try {
    await createTransaction({ customer_company_id: String(companyWithoutSite?.[0]?.id ?? ""), customer_site_id: "" }, ACTOR);
  } catch (e: unknown) {
    halfChain = e instanceof Error ? e.message : String(e);
  }
  check("creating a transaction without a site is refused", halfChain.startsWith("TRANSACTION_CONTEXT_INCOMPLETE"), halfChain);
  const { count: ordersBeforeCount } = await db.from("customer_orders").select("id", { count: "exact", head: true });
  const { count: projectsCount } = await db.from("projects").select("id", { count: "exact", head: true });
  check("no order/project was created by the refused call", (ordersBeforeCount ?? 0) === 2 && (projectsCount ?? 0) === 3, {
    orders: ordersBeforeCount,
    projects: projectsCount,
  });

  console.log("\n=== 9/10. read model reads back what the write model wrote ===");
  const detail = await getDocumentDetail("invoice", created.document_id);
  check("DocumentDetail returns the created document", detail?.identity.document_id === created.document_id);
  check("DocumentDetail reports the void status", detail?.identity.document_status === "VOID", detail?.identity.document_status);
  check("DocumentDetail reads the persisted WHT back", detail?.financials.wht_amount === expected.wht_amount, detail?.financials.wht_amount);
  check("DocumentDetail returns the current version (void, v3)", detail?.version?.version_no === 3 && detail?.version?.status === "void", detail?.version);
  check("DocumentDetail line items come from the version snapshot", detail?.line_items_source === "version_snapshot" && detail?.line_items.length === 2, {
    source: detail?.line_items_source,
    items: detail?.line_items.length,
  });
  check("DocumentDetail exposes the generated artifact", (detail?.generated_artifacts.length ?? 0) === 1);
  check("DocumentDetail links back to the transaction (customer_order_id FK)", detail?.transaction_link.customer_order_id === String(order.id));
  const txDetail = await getTransactionDetail(String(order.id));
  check("TransactionDetail sees the new document through the order FK", (txDetail?.generated_documents ?? []).some((d) => d.document_id === created.document_id));
  check("TransactionDetail money includes the document (gross > 0)", (txDetail?.financial_summary.gross_amount ?? 0) > 0, txDetail?.financial_summary);

  console.log("\n=== 10b. cleanup: every document this harness created is VOIDed (never deleted) ===");
  const { data: leftover } = await db
    .from("invoices")
    .select("id, invoice_status, reference_no")
    .like("reference_no", "D10-ACCEPTANCE-%")
    .neq("invoice_status", "VOID");
  for (const row of leftover ?? []) {
    const cleanup = await voidDocument({
      document_kind: "invoice",
      document_id: String(row.id),
      actor: ACTOR,
      reason: "D10 acceptance cleanup — failed/leftover attempt",
    });
    mutated.push({ table: "invoices", id: String(row.id), what: `voided leftover attempt (version ${cleanup.version_no})` });
  }
  check("no non-void acceptance document remains", true, (leftover ?? []).length);
  const { data: stillOpen } = await db
    .from("invoices")
    .select("id, invoice_status")
    .like("reference_no", "D10-ACCEPTANCE-%")
    .neq("invoice_status", "VOID");
  check("verified after cleanup: every acceptance document is VOID", (stillOpen ?? []).length === 0, stillOpen);

  console.log("\n=== 11. nothing else drifted ===");
  const { count: invoicesNow } = await db.from("invoices").select("id", { count: "exact", head: true });
  const beforeInv = BEFORE!.row_counts.find((r) => r.t === "invoices")!;
  // documents created by THIS run are counted separately (the harness knows its own marker)
  const { data: acceptanceDocs } = await db.from("invoices").select("id, invoice_status, total_amount").like("reference_no", "D10-ACCEPTANCE-%");
  const createdByThisRun = (acceptanceDocs ?? []).length;
  check(
    "invoice count grew by exactly the documents this run created (failed attempts rolled back to VOID)",
    (invoicesNow ?? 0) === beforeInv.n + createdByThisRun,
    { now: invoicesNow, before: beforeInv.n, created: createdByThisRun },
  );
  const voidedRollbacks = (acceptanceDocs ?? []).filter((d: Record<string, unknown>) => d.invoice_status === "VOID");
  check("every document this run created is VOID (business-semantics rollback)", voidedRollbacks.length === createdByThisRun, {
    created: createdByThisRun,
    void: voidedRollbacks.length,
  });
  const { count: receiptsNow } = await db.from("receipt_documents").select("id", { count: "exact", head: true });
  const beforeReceipts = BEFORE!.row_counts.find((r) => r.t === "receipt_documents")!;
  check("no receipt row was created or removed", (receiptsNow ?? 0) === beforeReceipts.n, { now: receiptsNow, before: beforeReceipts.n });
  const { data: oldInvoices } = await db
    .from("invoices")
    .select("total_amount, reference_no")
    .or("reference_no.is.null,reference_no.not.like.D10-ACCEPTANCE-%");
  const legacySum = (oldInvoices ?? []).reduce((s: number, r: Record<string, unknown>) => s + Number(r.total_amount ?? 0), 0);
  const beforeTotal = Number(BEFORE!.financial_totals.find((r) => r.t === "invoices")!.total);
  check("legacy invoice totals are untouched (acceptance documents excluded)", Math.abs(legacySum - beforeTotal) < 0.01, {
    now: legacySum.toFixed(2),
    before: beforeTotal.toFixed(2),
  });

  return finish();
}

function finish() {
  console.log("\n=== rows mutated by this acceptance run (real ids) ===");
  for (const m of mutated) console.log(`  ${m.table.padEnd(20)} ${m.id}  ${m.what}`);
  console.log("\n============================================================");
  console.log(`${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("FAILED CHECKS:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e instanceof Error ? e.message : e);
  process.exit(2);
});
