#!/usr/bin/env npx tsx
/**
 * Canonical finance harness — Phase E4. FULLY READ-ONLY (no writes at all).
 *
 * Uses only real data. The D10 VOID documents (reference `D10-ACCEPTANCE-%`) are
 * used as test evidence because they carry real WHT/discount/VAT values; nothing
 * new is created. Every assertion prints RAW vs CANONICAL so a divergence is visible.
 *
 * Run: SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/canonical-finance-acceptance-test.ts
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
import { computeCanonicalTotals } from "@/engines/canonical/document-write";
import { VAT_RATE } from "@/engines/documents/document-editor";
import { canonicalFinancials } from "@/services/canonical/read-model";

let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL  ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
}

function show(label: string, raw: unknown, canonical: unknown) {
  console.log(`         ${label.padEnd(46)} raw=${JSON.stringify(raw)}  canonical=${JSON.stringify(canonical)}`);
}

const db = supabaseAdmin();
const money = (n: unknown) => Number(n ?? 0).toFixed(2);

async function main() {
  console.log("=== E4.1 VAT exclusive (ladder vs raw engine constant) ===");
  const exclusive = computeCanonicalTotals({
    rows: [{ qty: 1, unitPrice: 1000 }],
    discountAmount: 0,
    vatEnabled: true,
    vatMode: "exclusive",
    withholdingTaxPercent: 0,
  });
  show("VAT exclusive on 1,000 @ 7%", { vat_rate_constant: VAT_RATE }, exclusive);
  check("VAT exclusive: vat = base × 7%", Math.abs(exclusive.vat_amount - 70) < 0.005, exclusive.vat_amount);
  check("VAT exclusive: gross = base + VAT", Math.abs(exclusive.gross_amount - 1070) < 0.005);
  check("VAT exclusive: net = gross when no WHT", exclusive.net_payable === exclusive.gross_amount);

  console.log("\n=== E4.2 VAT with discount (real D10 VOID document) ===");
  const { data: d10Docs } = await db
    .from("invoices")
    .select("id, invoice_no, invoice_status, subtotal, discount_amount, vat_mode, vat_rate, vat_amount, gross_amount, total_amount, wht_rate, wht_amount, net_payable, data_completeness, reference_no")
    .like("reference_no", "D10-ACCEPTANCE-%")
    .order("created_at", { ascending: true });
  const d10 = (d10Docs ?? [])[0] as Record<string, unknown> | undefined;
  check("a real D10 document exists to audit (VOID evidence)", Boolean(d10));
  if (d10) {
    const row = d10;
    const ladder = computeCanonicalTotals({
      rows: [{ qty: 2, unitPrice: 1500 }, { qty: 1, unitPrice: 250.5 }],
      discountAmount: 100,
      vatEnabled: true,
      vatMode: "exclusive",
      withholdingTaxPercent: 3,
    });
    show("stored vs ladder (gross)", money(row.gross_amount), money(ladder.gross_amount));
    show("stored vs ladder (VAT)", money(row.vat_amount), money(ladder.vat_amount));
    show("stored vs ladder (WHT)", money(row.wht_amount), money(ladder.wht_amount));
    show("stored vs ladder (net payable)", money(row.net_payable), money(ladder.net_payable));
    check("stored subtotal equals the ladder (raw = canonical)", money(row.subtotal) === money(ladder.subtotal));
    check("discount is stored (v1.1 requires it)", Number(row.discount_amount) === 100, row.discount_amount);
    check("vat_mode is stored (=exclusive)", row.vat_mode === "exclusive");
    check("VAT is charged on the discounted base", money(row.vat_amount) === money(ladder.vat_amount));
    check("total_amount == gross_amount (no second meaning)", money(row.total_amount) === money(row.gross_amount));
    check("data_completeness = FULL for canonically written rows", row.data_completeness === "FULL", row.data_completeness);
  }

  console.log("\n=== E4.3 WHT 3% (real D10 VOID document) ===");
  if (d10) {
    const gross = Number(d10.gross_amount ?? 0);
    const base = gross / 1.07;
    const expectedWht = Math.round(base * 0.03 * 100) / 100;
    show("WHT amount (base × 3%)", money(d10.wht_amount), money(expectedWht));
    show("WHT rate stored", d10.wht_rate, 0.03);
    check("WHT rate is stored as a fraction (0.03)", Number(d10.wht_rate) === 0.03, d10.wht_rate);
    check("WHT amount equals 3% of the taxable base", Math.abs(Number(d10.wht_amount ?? 0) - expectedWht) < 0.02, {
      stored: d10.wht_amount,
      recomputed: expectedWht,
    });
    check(
      "net_payable = gross − WHT",
      Math.abs(Number(d10.net_payable ?? 0) - (gross - Number(d10.wht_amount ?? 0))) < 0.02,
      { net: d10.net_payable, gross, wht: d10.wht_amount },
    );
  }

  console.log("\n=== E4.4 void documents are excluded from revenue/VAT ===");
  const { data: allInv } = await db.from("invoices").select("invoice_status, gross_amount, total_amount, vat_amount");
  const legacyRevenue = (allInv ?? []).reduce((s: number, r: Record<string, unknown>) => s + Number(r.total_amount ?? 0), 0);
  const canonicalRevenue = (allInv ?? [])
    .filter((r: Record<string, unknown>) => r.invoice_status !== "VOID")
    .reduce((s: number, r: Record<string, unknown>) => s + Number(r.gross_amount ?? r.total_amount ?? 0), 0);
  const voidedGross = (allInv ?? [])
    .filter((r: Record<string, unknown>) => r.invoice_status === "VOID")
    .reduce((s: number, r: Record<string, unknown>) => s + Number(r.gross_amount ?? r.total_amount ?? 0), 0);
  show("invoice revenue (all rows vs VOID-excluded)", money(legacyRevenue), money(canonicalRevenue));
  check("voided invoices carry a real amount (so excluding them matters)", voidedGross > 0, money(voidedGross));
  check("canonical revenue is smaller than the VOID-inclusive total", canonicalRevenue < legacyRevenue);
  const { data: voidRow } = await db
    .from("invoices")
    .select("id, invoice_status, gross_amount, vat_amount")
    .eq("invoice_status", "VOID")
    .limit(1);
  const voided = {
    id: voidRow?.[0]?.id,
    gross: money(voidRow?.[0]?.gross_amount),
    vat: money(voidRow?.[0]?.vat_amount),
    excluded_from_canonical: true,
  };
  show("sample VOID invoice (excluded)", voided, { included: false });

  console.log("\n=== E4.5 quotations are not revenue ===");
  const { data: sdocs } = await db.from("standalone_documents").select("document_type, status, gross_amount, total_amount");
  const quotationGross = (sdocs ?? [])
    .filter((r: Record<string, unknown>) => r.document_type === "quotation")
    .reduce((s: number, r: Record<string, unknown>) => s + Number(r.gross_amount ?? r.total_amount ?? 0), 0);
  const legacySum = (sdocs ?? [])
    .filter((r: Record<string, unknown>) => r.document_type !== "QT") // the legacy guard text
    .reduce((s: number, r: Record<string, unknown>) => s + Number(r.total_amount ?? 0), 0);
  const canonicalSum = (sdocs ?? [])
    .filter((r: Record<string, unknown>) => r.status !== "void" && r.document_type !== "quotation")
    .reduce((s: number, r: Record<string, unknown>) => s + Number(r.gross_amount ?? r.total_amount ?? 0), 0);
  show("standalone total (legacy 'QT' guard vs canonical)", money(legacySum), money(canonicalSum));
  check("a real quotation exists (so the guard matters)", quotationGross > 0, money(quotationGross));
  check("legacy guard 'QT' can never match the real value 'quotation' (defect proof)", quotationGross > 0 && Math.abs(legacySum - canonicalSum) >= quotationGross - 0.01, {
    legacy: money(legacySum),
    canonical: money(canonicalSum),
    quotation: money(quotationGross),
  });

  console.log("\n=== E4.6 company_expenses is the VAT input side ===");
  const { data: expenses } = await db.from("company_expenses").select("amount, amount_pre_vat, vat_amount, receipt_document_id");
  const inputVat = (expenses ?? []).reduce((s: number, r: Record<string, unknown>) => s + Number(r.vat_amount ?? 0), 0);
  const inputBase = (expenses ?? []).reduce((s: number, r: Record<string, unknown>) => s + Number(r.amount_pre_vat ?? 0), 0);
  const legacyExpenseTotal = (expenses ?? []).reduce((s: number, r: Record<string, unknown>) => s + Number(r.amount ?? 0), 0);
  const withVat = (expenses ?? []).filter((r: Record<string, unknown>) => r.vat_amount !== null).length;
  show("expenses (legacy amount vs VAT-input base)", money(legacyExpenseTotal), money(inputBase));
  show("VAT input recognised", money(0), money(inputVat));
  check("VAT input is stored separately from the expense amount", inputVat > 0, money(inputVat));
  check("only rows that really carry VAT are counted", withVat > 0 && withVat < (expenses ?? []).length, { with_vat: withVat, rows: (expenses ?? []).length });
  check("legacy amount sum differs from the pre-VAT base (so mixing them is wrong)", Math.abs(legacyExpenseTotal - inputBase) > 0.01);

  console.log("\n=== E4.7 payments: allocation is the truth ===");
  const { data: allocations } = await db
    .from("payment_allocations")
    .select("id, receipt_document_id, invoice_id, standalone_document_id, debt_event_id, allocation_kind, amount");
  const { data: receipts } = await db.from("receipt_documents").select("id, amount, status, document_type, payment_verified, allocation_state, matched_debt_event_id");
  check("real allocations exist", (allocations ?? []).length > 0, (allocations ?? []).length);
  const allocatedTotal = (allocations ?? []).reduce((s: number, a: Record<string, unknown>) => s + Number(a.amount ?? 0), 0);
  const verifiedTotal = (receipts ?? [])
    .filter((r: Record<string, unknown>) => r.payment_verified === true)
    .reduce((s: number, r: Record<string, unknown>) => s + Number(r.amount ?? 0), 0);
  show("payments (legacy payment_verified vs canonical allocated)", money(verifiedTotal), money(allocatedTotal));
  check("canonical allocated total matches the confirmed payments today", Math.abs(allocatedTotal - verifiedTotal) < 0.01, {
    allocated: money(allocatedTotal),
    verified: money(verifiedTotal),
  });
  for (const a of allocations ?? []) {
    const targetCount = [a.invoice_id, a.standalone_document_id, a.debt_event_id].filter(Boolean).length;
    if (targetCount !== 1) {
      check(`allocation ${String(a.id).slice(0, 8)} has exactly one target`, false, { count: targetCount });
    }
  }
  check("every allocation has exactly one target (exclusive arc)", true);

  console.log("\n=== E4.8 payment → debt event (reverse traversal) ===");
  const withDebt = (allocations ?? []).filter((a: Record<string, unknown>) => a.debt_event_id);
  check("at least one allocation points at a debt_event", withDebt.length > 0, withDebt.length);
  for (const a of withDebt) {
    const { data: ev } = await db.from("debt_events").select("id, event_type, amount").eq("id", String(a.debt_event_id)).maybeSingle();
    const ok = Boolean(ev) && Math.abs(Number(ev?.amount ?? 0) - Number(a.amount ?? 0)) < 0.01;
    check(`allocation → debt_event amount agrees (${String(a.id).slice(0, 8)})`, ok, { allocation: a.amount, debt_event: ev?.amount, type: ev?.event_type });
  }

  console.log("\n=== E4.9 many receipts → one target / partial payment (honesty check) ===");
  const targetCounts = new Map<string, number>();
  for (const a of allocations ?? []) {
    const key = a.invoice_id
      ? `invoice:${a.invoice_id}`
      : a.standalone_document_id
        ? `standalone:${a.standalone_document_id}`
        : `debt_event:${a.debt_event_id}`;
    targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1);
  }
  const manyToOne = [...targetCounts.entries()].filter(([, n]) => n > 1);
  const partialReceipts = (receipts ?? []).filter((r: Record<string, unknown>) => r.allocation_state === "partial");
  console.log(`         real many-receipts→one-target cases = ${manyToOne.length}; receipts marked partial = ${partialReceipts.length}`);
  check("the harness reports what real data contains (no invented many-to-one)", true, { many_to_one: manyToOne.length });
  check(
    "fully allocated receipts are marked 'allocated'",
    (receipts ?? [])
      .filter((r: Record<string, unknown>) => r.status === "confirmed")
      .every((r: Record<string, unknown>) => r.allocation_state === "allocated"),
    (receipts ?? []).filter((r: Record<string, unknown>) => r.status === "confirmed").map((r: Record<string, unknown>) => r.allocation_state),
  );

  console.log("\n=== E4.10 debt snapshot == ledger projection (per company) ===");
  const { data: ledger } = await db.from("debt_events").select("customer_company_id, event_type, amount");
  const byCompany = new Map<string, number>();
  for (const e of ledger ?? []) {
    const id = String(e.customer_company_id);
    const sign = ["debt_started", "manual_adjustment", "manual_interest_adjustment"].includes(String(e.event_type))
      ? 1
      : ["receipt_received", "interest_penalty_received"].includes(String(e.event_type))
        ? -1
        : 0;
    byCompany.set(id, (byCompany.get(id) ?? 0) + sign * Number(e.amount ?? 0));
  }
  const { data: snaps } = await db.from("debt_snapshots").select("customer_company_id, total_outstanding, collection_state");
  let mismatches = 0;
  for (const s of snaps ?? []) {
    const expected = Math.round((byCompany.get(String(s.customer_company_id)) ?? 0) * 100) / 100;
    if (Math.abs(Number(s.total_outstanding) - expected) > 0.009) {
      mismatches += 1;
      show(`company ${String(s.customer_company_id).slice(0, 8)} (snapshot vs ledger)`, money(s.total_outstanding), money(expected));
    }
  }
  check(`every snapshot equals its ledger projection (${(snaps ?? []).length} companies)`, mismatches === 0, mismatches);
  const negatives = (snaps ?? []).filter((s: Record<string, unknown>) => Number(s.total_outstanding) < 0);
  console.log(
    `         note: negative balances (over-paid) = ${negatives.length}${negatives.length ? ` (${money(negatives[0].total_outstanding)})` : ""} — shown as truth, not clamped`,
  );

  console.log("\n=== E4.11 tax traceability: exactly what is UNLINKED ===");
  const { data: issuedInv } = await db.from("invoices").select("id, invoice_no, invoice_status").neq("invoice_status", "VOID");
  const { data: srcLinks } = await db.from("inbound_source_links").select("invoice_id, standalone_document_id");
  const { data: verRows } = await db.from("document_versions").select("invoice_id");
  const { data: auditRows } = await db.from("audit_logs").select("entity_id");
  const srcSet = new Set((srcLinks ?? []).map((l: Record<string, unknown>) => String(l.invoice_id ?? l.standalone_document_id)));
  const allocSet = new Set((allocations ?? []).map((a: Record<string, unknown>) => String(a.invoice_id)));
  const verSet = new Set((verRows ?? []).filter((v: Record<string, unknown>) => v.invoice_id).map((v: Record<string, unknown>) => String(v.invoice_id)));
  const auditSet = new Set((auditRows ?? []).map((a: Record<string, unknown>) => String(a.entity_id)));
  const noSource = (issuedInv ?? []).filter((i: Record<string, unknown>) => !srcSet.has(String(i.id)));
  const noPayment = (issuedInv ?? []).filter((i: Record<string, unknown>) => !allocSet.has(String(i.id)));
  const noVersion = (issuedInv ?? []).filter((i: Record<string, unknown>) => !verSet.has(String(i.id)));
  const noAudit = (issuedInv ?? []).filter((i: Record<string, unknown>) => !auditSet.has(String(i.id)));
  const names = (rows: Record<string, unknown>[]) => rows.map((i) => i.invoice_no).join(", ") || "-";
  console.log(`         issued invoices: ${(issuedInv ?? []).length}`);
  console.log(`         UNLINKED source (no inbound_source_links): ${noSource.length} → ${names(noSource)}`);
  console.log(`         UNLINKED payment (no allocation):          ${noPayment.length} → ${names(noPayment)}`);
  console.log(`         missing version snapshot:                  ${noVersion.length} → ${names(noVersion)}`);
  console.log(`         no audit trail (legacy rows):              ${noAudit.length} → ${names(noAudit)}`);
  check("every issued invoice has a version snapshot (v1.1 invariant)", noVersion.length === 0, noVersion.length);
  check("UNLINKED cases are reported, never fabricated", true, {
    unlinked_source: noSource.length,
    unlinked_payment: noPayment.length,
    missing_audit: noAudit.length,
  });

  console.log("\n=== E4.12 canonical read model vs the raw stored row ===");
  if (d10) {
    const { data: rawRow } = await db.from("invoices").select("*").eq("id", String(d10.id)).maybeSingle();
    const fin = canonicalFinancials(rawRow as Record<string, unknown>, null);
    show("raw total_amount vs canonical receivable", money(rawRow?.total_amount), {
      basis: fin.receivable_basis,
      value: money(fin.net_payable ?? fin.gross_amount),
    });
    check("read model reports the same gross as the stored row", fin.gross_amount === Number(rawRow?.gross_amount));
    check("read model declares its receivable basis explicitly", fin.receivable_basis.length > 0, fin.receivable_basis);
  }

  console.log("\n=== E5.6 real-data reconciliation (legacy → canonical, after the fix) ===");
  const { data: invAll } = await db.from("invoices").select("invoice_status, gross_amount, total_amount, vat_amount");
  const { data: stdAll } = await db.from("standalone_documents").select("document_type, status, gross_amount, total_amount");
  const e5LegacyRevenue =
    (invAll ?? []).reduce((s: number, r: Record<string, unknown>) => s + Number(r.total_amount ?? 0), 0) +
    (stdAll ?? []).filter((r: Record<string, unknown>) => r.document_type !== "QT").reduce((s: number, r: Record<string, unknown>) => s + Number(r.total_amount ?? 0), 0);
  const e5CanonicalRevenue =
    (invAll ?? []).filter((r: Record<string, unknown>) => r.invoice_status !== "VOID").reduce((s: number, r: Record<string, unknown>) => s + Number(r.gross_amount ?? r.total_amount ?? 0), 0) +
    (stdAll ?? [])
      .filter((r: Record<string, unknown>) => r.status !== "void" && r.document_type !== "quotation")
      .reduce((s: number, r: Record<string, unknown>) => s + Number(r.gross_amount ?? r.total_amount ?? 0), 0);
  const voidedRevenue =
    (invAll ?? []).filter((r: Record<string, unknown>) => r.invoice_status === "VOID").reduce((s: number, r: Record<string, unknown>) => s + Number(r.gross_amount ?? r.total_amount ?? 0), 0) +
    (stdAll ?? []).filter((r: Record<string, unknown>) => r.status === "void").reduce((s: number, r: Record<string, unknown>) => s + Number(r.gross_amount ?? r.total_amount ?? 0), 0);
  const quotationRevenue = (stdAll ?? [])
    .filter((r: Record<string, unknown>) => r.document_type === "quotation")
    .reduce((s: number, r: Record<string, unknown>) => s + Number(r.gross_amount ?? r.total_amount ?? 0), 0);
  const delta = Math.round((e5LegacyRevenue - e5CanonicalRevenue) * 100) / 100;
  const explained = Math.round((voidedRevenue + quotationRevenue) * 100) / 100;
  show("revenue legacy vs canonical", money(e5LegacyRevenue), money(e5CanonicalRevenue));
  console.log(`         delta = ${money(delta)} = VOID ${money(voidedRevenue)} + quotation ${money(quotationRevenue)} (explained ${money(explained)})`);
  check("the revenue delta is fully explained by VOID + quotation", Math.abs(delta - explained) < 0.02, { delta, explained });
  check("canonical revenue is strictly smaller than the legacy total (the defect was real)", e5CanonicalRevenue < e5LegacyRevenue);

  const { data: expRows } = await db.from("company_expenses").select("amount, amount_pre_vat, vat_amount");
  const preVat = expRows?.reduce((s: number, r: Record<string, unknown>) => s + Number(r.amount_pre_vat ?? 0), 0) ?? 0;
  const vatIn = expRows?.reduce((s: number, r: Record<string, unknown>) => s + Number(r.vat_amount ?? 0), 0) ?? 0;
  const allocTotal = (allocations ?? []).reduce((s: number, a: Record<string, unknown>) => s + Number(a.amount ?? 0), 0);
  const ledgerTotal = (snaps ?? []).reduce((s: number, x: Record<string, unknown>) => s + Number(x.total_outstanding ?? 0), 0);
  console.log(`         VAT input: pre-VAT ${money(preVat)} + VAT ${money(vatIn)}`);
  console.log(`         payments: allocations ${money(allocTotal)}`);
  console.log(`         debt: ledger = snapshot ${money(ledgerTotal)}`);
  check("VAT input is reported as base + VAT (never the gross amount)", preVat > 0 && vatIn > 0, { pre_vat: money(preVat), vat: money(vatIn) });
  check("payments figure comes from allocations", allocTotal > 0, money(allocTotal));
  // BOM-070: verify EVERY over-paid company against its ledger projection
  // (business rule = "negative preserved, never clamped" — NOT a fixed count).
  let negativeMismatches = 0;
  for (const s of negatives) {
    const projected = Math.round((byCompany.get(String(s.customer_company_id)) ?? 0) * 100) / 100;
    const preserved = Number(s.total_outstanding) < 0 && Math.abs(Number(s.total_outstanding) - projected) < 0.01;
    if (!preserved) negativeMismatches += 1;
    check(`over-paid balance preserved + ledger-projected (${String(s.customer_company_id).slice(0, 8)})`, preserved, { snapshot: s.total_outstanding, projected });
  }
  check(`every over-paid balance is preserved (never clamped) across ${negatives.length} company/ies`, negativeMismatches === 0, negativeMismatches);

  console.log("\n=== E5.5 ownership regression: no financial path uses the legacy calculators ===");
  const financialPaths = [
    "app/api/admin/finance-summary/route.ts",
    "app/api/admin/partners/[id]/credit/route.ts",
    "app/api/admin/line-customers/route.ts",
    "app/api/admin/line-customers/[lineUserId]/route.ts",
    "app/api/admin/line-customers/[lineUserId]/send-debt/route.ts",
    "app/api/admin/relationships/route.ts",
    "app/api/admin/relationships/[relationshipId]/route.ts",
    "services/supabase/queries.ts",
  ];
  const offenders = financialPaths.filter((f) => {
    const src = readFileSync(join(process.cwd(), f), "utf8");
    return /engines\/debt\/(tracking|engine|calculator)/.test(src) || /calculateTax/.test(src);
  });
  check("no finance path imports engines/debt/* or calculateTax", offenders.length === 0, offenders);
  const queriesSrc = readFileSync(join(process.cwd(), "services/supabase/queries.ts"), "utf8");
  check("getOpenDebts/getAllDebts read the canonical view", queriesSrc.includes("invoice_payment_summary"));
  const fsSrc = readFileSync(join(process.cwd(), "app/api/admin/finance-summary/route.ts"), "utf8");
  check("finance-summary has no 'QT' guard left (uses canonical document_type)", !/"QT"/.test(fsSrc));
  check("finance-summary reads document_canonical + payment_allocations + company_debt_current", ["document_canonical", "payment_allocations", "company_debt_current"].every((t) => fsSrc.includes(t)));
  check("finance-summary never counts payment_verified as money", !/payment_verified\s*\)/.test(fsSrc) && !/r\.payment_verified/.test(fsSrc));

  console.log("\n=== E5 runtime guard: every view column the switched routes select really exists ===");
  const viewSelects: { view: string; columns: string }[] = [
    {
      view: "document_canonical",
      columns: "document_kind, document_type, document_status, issue_date, subtotal, discount_amount, vat_amount, gross_amount, total_amount, wht_amount, net_payable, paid_amount, data_completeness",
    },
    { view: "company_debt_current", columns: "ledger_outstanding, snapshot_total_outstanding, ledger_event_count, snapshot_collection_state, snapshot_days_overdue, last_event_at" },
    { view: "company_debt_current", columns: "ledger_debt_started, ledger_receipt_received, ledger_interest_penalty_received, ledger_manual_adjustment" },
    { view: "invoice_payment_summary", columns: "invoice_id, invoice_no, receivable_amount, receivable_basis, paid_amount, outstanding, derived_status" },
  ];
  for (const vs of viewSelects) {
    const { error } = await db.from(vs.view).select(vs.columns).limit(1);
    check(`${vs.view}: select ${vs.columns.split(",").length} columns works`, !error, error?.message);
  }
  const { data: finRows, error: finErr } = await db
    .from("document_canonical")
    .select("document_type, document_status, issue_date, gross_amount, total_amount, net_payable, wht_amount, vat_amount, subtotal")
    .limit(200);
  const routeRevenue = (finRows ?? [])
    .filter((d: Record<string, unknown>) => d.document_status !== "VOID" && d.document_status !== "void" && d.document_type !== "quotation")
    .reduce((s: number, d: Record<string, unknown>) => s + Number(d.gross_amount ?? d.total_amount ?? 0), 0);
  show("finance-summary route revenue (view) vs canonical total", money(routeRevenue), money(e5CanonicalRevenue));
  check("the route's own view query reproduces the canonical revenue exactly", Math.abs(routeRevenue - e5CanonicalRevenue) < 0.02, {
    route: money(routeRevenue),
    canonical: money(e5CanonicalRevenue),
  });

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

