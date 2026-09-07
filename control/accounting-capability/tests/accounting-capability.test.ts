/**
 * หน้าที่: พิสูจน์ ACCOUNTING_CAPABILITY กับฐานข้อมูลจริง ไม่ใช่ mock
 *
 * Owner, 2026-09-05 Phase 8: "PASS ต้องมาจาก test/runtime/database evidence เท่านั้น"
 * ทุกข้อ A–J อ่านค่ากลับจาก Postgres จริงหลังโพสต์ ไม่มีการยืนยันด้วยข้อความ
 *
 * ต้องมี cluster ที่ apply แล้วสี่ไฟล์ตามลำดับ:
 *   acct-schema.sql -> acct-v2.sql -> acct-v2-fix.sql -> acct-v3-contract.sql
 * ส่ง connection string ทาง ACCT_TEST_DSN
 */

import { calculateDocument } from "../calculation";
import { executeAccounting, type CapabilityCaller } from "../capability";
import type { AccountingInput, DocumentAmounts, EvidencePointer } from "../types";

const DSN = process.env.ACCT_TEST_DSN;
if (DSN === undefined) { console.error("ต้องตั้ง ACCT_TEST_DSN"); process.exit(2); }

const CALLER: CapabilityCaller = { identity_id: "agent-accounting-test", kind: "ai_agent", display_name: "accounting capability test" };
const opts = { connection: { connectionString: DSN }, caller: CALLER, authorize: async () => true };
const denyOpts = { ...opts, authorize: async () => false };

const CUST = "11111111-1111-4111-8111-111111111111";
const VEND = "22222222-2222-4222-8222-222222222222";

const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail: string) => { results.push({ name, pass, detail }); };

const ev = (source_type: EvidencePointer["source_type"], source_id: string): EvidencePointer[] =>
  [{ source_type, source_id, original_pointer: null }];

function amounts(subtotal: number, rate: number, mode: "inclusive" | "exclusive" = "exclusive"): DocumentAmounts {
  const r = calculateDocument({ subtotal, vat_rate: rate, vat_mode: mode });
  if (!r.ok) throw new Error(r.reason);
  return r.amounts;
}

async function main(): Promise<void> {
  // ── PHASE 4: สูตรต้องตรงกับ engines/tax.ts เมื่อไม่มีส่วนลด ──────────────
  {
    // engines/tax.ts inclusive: base = 10700/(1.07) = 10000, vat = 700
    const inc = calculateDocument({ subtotal: 10700, vat_rate: 7, vat_mode: "inclusive" });
    const exc = calculateDocument({ subtotal: 10000, vat_rate: 7, vat_mode: "exclusive" });
    const wht = calculateDocument({ subtotal: 10000, vat_rate: 7, vat_mode: "exclusive", withholding_rate: 3 });
    check("PHASE4 inclusive ตรงกับ engines/tax.ts",
      inc.ok && inc.amounts.tax_base === 10000 && inc.amounts.vat_amount === 700 && inc.amounts.total_amount === 10700,
      inc.ok ? `base=${inc.amounts.tax_base} vat=${inc.amounts.vat_amount}` : "calc failed");
    check("PHASE4 exclusive ตรงกับ engines/tax.ts",
      exc.ok && exc.amounts.vat_amount === 700 && exc.amounts.total_amount === 10700,
      exc.ok ? `vat=${exc.amounts.vat_amount} total=${exc.amounts.total_amount}` : "calc failed");
    check("PHASE4 withholding = base * rate",
      wht.ok && wht.amounts.withholding_amount === 300,
      wht.ok ? `wht=${wht.amounts.withholding_amount}` : "calc failed");
    const disc = calculateDocument({ subtotal: 11000, discount: 1000, vat_rate: 7, vat_mode: "exclusive" });
    check("PHASE4 discount หักก่อนคิดฐานภาษี",
      disc.ok && disc.amounts.tax_base === 10000 && disc.amounts.vat_amount === 700,
      disc.ok ? `base=${disc.amounts.tax_base} vat=${disc.amounts.vat_amount}` : "calc failed");
  }

  // ── A. invoice -> journal -> VAT output -> AR ────────────────────────────
  const invA = "aaaa1111-0000-4000-8000-000000000001";
  const salesA: AccountingInput = {
    kind: "SALES_DOCUMENT", source_type: "invoices", source_id: invA,
    occurred_at: "2026-09-10T03:00:00Z", company_id: CUST,
    evidence: ev("invoices", invA), idempotency_key: `sale:${invA}`,
    payload: { document_no: "INV-TEST-A", is_tax_invoice: false, amounts: amounts(10000, 7) },
  };
  const rA = await executeAccounting(salesA, opts);
  const arLine = rA.kind === "POSTING_RESULT" ? rA.entry.lines.find((l) => l.account === "ลูกหนี้การค้า") : undefined;
  const vatLine = rA.kind === "POSTING_RESULT" ? rA.entry.lines.find((l) => l.account === "ภาษีขาย") : undefined;
  const revLine = rA.kind === "POSTING_RESULT" ? rA.entry.lines.find((l) => l.account === "รายได้จากการขาย") : undefined;
  check("A invoice -> journal + VAT output + AR",
    rA.kind === "POSTING_RESULT" && rA.entry.balanced
      && arLine?.debit === 10700 && vatLine?.credit === 700 && revLine?.credit === 10000,
    rA.kind === "POSTING_RESULT" ? `AR=${arLine?.debit} VAT=${vatLine?.credit} REV=${revLine?.credit}` : JSON.stringify(rA));

  // ── B. supplier expense with VAT -> AP + VAT input ───────────────────────
  const supB = "bbbb1111-0000-4000-8000-000000000002";
  const rB = await executeAccounting({
    kind: "PURCHASE_DOCUMENT", source_type: "company_expenses", source_id: supB,
    occurred_at: "2026-09-11T03:00:00Z", company_id: CUST,
    evidence: ev("company_expenses", supB), idempotency_key: `exp:${supB}`,
    payload: { document_no: "EXP-TEST-B", vendor_company_id: VEND, amounts: amounts(1000, 7) },
  }, opts);
  const apLine = rB.kind === "POSTING_RESULT" ? rB.entry.lines.find((l) => l.account === "เจ้าหนี้การค้า") : undefined;
  const inVat = rB.kind === "POSTING_RESULT" ? rB.entry.lines.find((l) => l.account === "ภาษีซื้อ") : undefined;
  check("B expense -> AP + VAT input",
    rB.kind === "POSTING_RESULT" && rB.entry.balanced && apLine?.credit === 1070 && inVat?.debit === 70,
    rB.kind === "POSTING_RESULT" ? `AP=${apLine?.credit} inputVAT=${inVat?.debit}` : JSON.stringify(rB));

  // ── C. payment -> allocation -> outstanding ลดลง ─────────────────────────
  const before = await executeAccounting({ kind: "ACCOUNTING_QUERY", query: "OUTSTANDING" }, opts);
  const rC = await executeAccounting({
    kind: "PAYMENT", source_type: "bank_statement_transactions", source_id: "cccc-pay-1",
    occurred_at: "2026-09-12T03:00:00Z", company_id: CUST,
    evidence: ev("bank_statement_transactions", "cccc-pay-1"), idempotency_key: "pay:cccc-1",
    payload: { direction: "MONEY_IN", amount: 10700, allocations: [
      { side: "RECEIVABLE", document_source_type: "invoices", document_source_id: invA, amount: 10700 }] },
  }, opts);
  const after = await executeAccounting({ kind: "ACCOUNTING_QUERY", query: "OUTSTANDING" }, opts);
  const b = before.kind === "OUTSTANDING" ? before.receivable : -1;
  const a2 = after.kind === "OUTSTANDING" ? after.receivable : -1;
  check("C payment -> allocation -> outstanding ลด 10700",
    rC.kind === "POSTING_RESULT" && Math.abs((b - a2) - 10700) < 0.01, `ก่อน=${b} หลัง=${a2}`);

  // ── D. partial payment -> outstanding ถูกต้อง ────────────────────────────
  const invD = "dddd1111-0000-4000-8000-000000000004";
  await executeAccounting({
    kind: "SALES_DOCUMENT", source_type: "invoices", source_id: invD,
    occurred_at: "2026-09-13T03:00:00Z", company_id: CUST,
    evidence: ev("invoices", invD), idempotency_key: `sale:${invD}`,
    payload: { document_no: "INV-TEST-D", is_tax_invoice: true, amounts: amounts(1000, 7) },
  }, opts);
  await executeAccounting({
    kind: "PAYMENT", source_type: "bank_statement_transactions", source_id: "dddd-pay-1",
    occurred_at: "2026-09-14T03:00:00Z", company_id: CUST,
    evidence: ev("bank_statement_transactions", "dddd-pay-1"), idempotency_key: "pay:dddd-1",
    payload: { direction: "MONEY_IN", amount: 500, allocations: [
      { side: "RECEIVABLE", document_source_type: "invoices", document_source_id: invD, amount: 500 }] },
  }, opts);
  const arD = await executeAccounting({ kind: "ACCOUNTING_QUERY", query: "AR_STATUS" }, opts);
  const dLine = arD.kind === "AR_STATUS" ? arD.lines.find((l) => Math.abs(l.amount - 570) < 0.01) : undefined;
  check("D partial payment -> คงเหลือ 570", dLine !== undefined,
    arD.kind === "AR_STATUS" ? `พบยอดคงเหลือ ${dLine?.amount ?? "ไม่พบ 570"}` : JSON.stringify(arD));

  // ── E. credit note -> journal + AR adjustment ────────────────────────────
  const cnE = "eeee1111-0000-4000-8000-000000000005";
  const rE = await executeAccounting({
    kind: "CREDIT_NOTE", source_type: "standalone_documents", source_id: cnE,
    occurred_at: "2026-09-15T03:00:00Z", company_id: CUST,
    evidence: ev("standalone_documents", cnE), idempotency_key: `cn:${cnE}`,
    payload: { credit_note_no: "CN-TEST-E", against_source_type: "invoices", against_source_id: invD, amounts: amounts(500, 7) },
  }, opts);
  const arE = await executeAccounting({ kind: "ACCOUNTING_QUERY", query: "AR_STATUS" }, opts);
  const eLine = arE.kind === "AR_STATUS" ? arE.lines.find((l) => Math.abs(l.amount - 35) < 0.01) : undefined;
  check("E credit note -> AR 570 ลดเหลือ 35",
    rE.kind === "POSTING_RESULT" && rE.entry.balanced && eLine !== undefined,
    rE.kind === "POSTING_RESULT" ? `AR หลังลดหนี้ = ${eLine?.amount ?? "ไม่พบ 35"}` : JSON.stringify(rE));

  // ── F. duplicate input -> idempotent ────────────────────────────────────
  const rF = await executeAccounting(salesA, opts);
  const entryCountSame = rF.kind === "POSTING_RESULT" && rA.kind === "POSTING_RESULT"
    && rF.entry.entry_id === rA.entry.entry_id && rF.idempotent_replay;
  check("F ส่งซ้ำ -> ไม่โพสต์ซ้ำ คืน entry เดิม", entryCountSame,
    rF.kind === "POSTING_RESULT" ? `replay=${rF.idempotent_replay} entry เดิม=${rF.entry.entry_id === (rA as any).entry.entry_id}` : JSON.stringify(rF));

  // ── G. unsupported event -> fail closed ─────────────────────────────────
  const rG = await executeAccounting({
    kind: "BUSINESS_EVENT", source_type: "business_events", source_id: "gggg-1",
    occurred_at: "2026-09-16T03:00:00Z", company_id: CUST,
    evidence: ev("business_events", "gggg-1"), idempotency_key: "be:gggg-1",
    payload: { observed_intent: "ถามราคา" },
  }, opts);
  const rGdeny = await executeAccounting(salesA, denyOpts);
  check("G ชนิดที่ไม่มีผลทางบัญชี -> ปฏิเสธ ไม่เดา",
    rG.kind === "ERROR_RESULT" && rG.reason_code === "NO_ACCOUNTING_EFFECT",
    rG.kind === "ERROR_RESULT" ? rG.reason_code : "ไม่ได้ปฏิเสธ");
  check("G write boundary ปฏิเสธ -> ไม่เขียน",
    rGdeny.kind === "ERROR_RESULT" && rGdeny.reason_code === "WRITE_DENIED",
    rGdeny.kind === "ERROR_RESULT" ? rGdeny.reason_code : "เขียนทั้งที่ถูกปฏิเสธ");

  // ── H. evidence -> trace กลับ source ────────────────────────────────────
  const rH = await executeAccounting({ kind: "ACCOUNTING_QUERY", query: "ACCOUNTING_EVIDENCE", source_id: invA }, opts);
  check("H ทุก posting สืบกลับ source ได้",
    rH.kind === "ACCOUNTING_EVIDENCE" && rH.traces_to.some((t) => t.source_id === invA),
    rH.kind === "ACCOUNTING_EVIDENCE" ? `entry ${rH.entry_id} -> ${rH.traces_to.map((t) => t.source_type).join(",")}` : JSON.stringify(rH));

  // ── I. accounting equation ──────────────────────────────────────────────
  const rI = await executeAccounting({ kind: "ACCOUNTING_QUERY", query: "TRIAL_BALANCE" }, opts);
  check("I Σdebit = Σcredit",
    rI.kind === "TRIAL_BALANCE" && rI.balanced,
    rI.kind === "TRIAL_BALANCE" ? `debit=${rI.total_debit} credit=${rI.total_credit}` : JSON.stringify(rI));

  // ── J. รายงานทุกตัว derive จาก journal เดียวกัน ─────────────────────────
  const pnl = await executeAccounting({ kind: "ACCOUNTING_QUERY", query: "PNL" }, opts);
  const bs = await executeAccounting({ kind: "ACCOUNTING_QUERY", query: "BALANCE_SHEET" }, opts);
  const vat = await executeAccounting({ kind: "ACCOUNTING_QUERY", query: "VAT_RESULT" }, opts);
  const pkg = await executeAccounting({ kind: "ACCOUNTING_QUERY", query: "TAX_PACKAGE" }, opts);
  check("J งบดุลสมดุล (สินทรัพย์ = หนี้สิน + ทุน)",
    bs.kind === "BALANCE_SHEET" && bs.balanced,
    bs.kind === "BALANCE_SHEET" ? `A=${bs.assets} L=${bs.liabilities} E=${bs.equity}` : JSON.stringify(bs));
  check("J VAT package ตรงกับ VAT report (แกนเดียวกัน)",
    vat.kind === "VAT_RESULT" && pkg.kind === "TAX_PACKAGE" && vat.net_vat === pkg.net_vat,
    vat.kind === "VAT_RESULT" && pkg.kind === "TAX_PACKAGE" ? `net=${vat.net_vat} / ${pkg.net_vat}` : "อ่านไม่ได้");
  check("J P&L derive จาก journal เดียวกัน",
    pnl.kind === "PNL" && pnl.revenue > 0 && Math.abs(pnl.profit - (pnl.revenue - pnl.expense)) < 0.01,
    pnl.kind === "PNL" ? `rev=${pnl.revenue} exp=${pnl.expense} profit=${pnl.profit}` : JSON.stringify(pnl));

  // ── รายงานผล ────────────────────────────────────────────────────────────
  let failed = 0;
  for (const r of results) {
    if (!r.pass) failed++;
    console.log(`${r.pass ? "PASS" : "FAIL"} | ${r.name} | ${r.detail}`);
  }
  console.log(`\n${results.length - failed}/${results.length} ${failed === 0 ? "ALL PASS" : "มีข้อที่ไม่ผ่าน"}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error("ล้มเหลว:", e); process.exit(1); });
