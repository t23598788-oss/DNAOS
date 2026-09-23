/**
 * Regression test for B-03 — payment preview / canonical financial read
 * reconciliation (2026-09-23, FULL_BUSINESS_SYSTEM_RECONCILIATION §21).
 *
 * previewPayment() used to read two tables that do not exist in the LIVE
 * database (`invoice_debts`, `documents`), so every payment preview failed.
 * It now reads the canonical receivable view/columns that already exist:
 *   1. active preview path has NO `.from("invoice_debts")` / `.from("documents")`
 *      (negative control: putting either back makes this test fail)
 *   2. it reads `invoice_payment_summary` (persisted receivable_amount /
 *      paid_amount / outstanding / derived_status — nothing recomputed) and
 *      `invoices` via the existing FK embed `invoices_customer_company_id_fkey`
 *   3. no new money formula (no VAT/WHT rate, no rounding helper, no
 *      `receivable - paid` re-derivation, no calculateDocumentTotals)
 *   4. the ActionResponse contract, the preview payload keys, the
 *      `issueToken("payment", { invoice_debt_id })` handshake and the function
 *      signature are unchanged — B-04 executePayment keeps working as before
 *   5. B-04C finished B-04: executePayment is canonical (no invoice_debts /
 *      invoice_payments); B-05 executeDebtCreate still on debt_trackings
 *   6. no parallel implementation (no previewPaymentV2 / paymentPreviewRepository)
 *   7. LIVE (optional, READ ONLY): the new selects answer 200 while the two
 *      legacy tables answer 404 PGRST205 — skipped when no local credentials.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const ACTIONS = "gateway/actions.ts";
const read = () => readFileSync(join(ROOT, ACTIONS), "utf-8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/** Body of one exported async function: from its declaration to the next `export`. */
function bodyOf(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `function ${name}() must exist`);
  const rest = src.slice(start + 1);
  const next = rest.search(/\nexport /);
  return next === -1 ? rest : rest.slice(0, next);
}

const SUMMARY_SELECT =
  "invoice_id, invoice_no, receivable_amount, receivable_basis, paid_amount, outstanding, derived_status";
const INVOICE_SELECT = "id, companies!invoices_customer_company_id_fkey(id, name)";

async function liveCheck(): Promise<string> {
  const envPath = join(ROOT, ".env.local");
  if (!existsSync(envPath)) return "skipped (no .env.local)";
  const env = readFileSync(envPath, "utf-8");
  const pick = (n: string) => {
    const line = env.split("\n").find((l) => l.startsWith(`${n}=`));
    return line ? line.slice(n.length + 1).trim().replace(/^["']|["']$/g, "") : "";
  };
  const url = pick("NEXT_PUBLIC_SUPABASE_URL");
  const key = pick("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!url || !key) return "skipped (no local credentials)";
  const headers = { apikey: key, Authorization: `Bearer ${key}` };

  // bounded live probe — a slow/blocked network must never hang the test
  const get = (path: string) => fetch(`${url}${path}`, { headers, signal: AbortSignal.timeout(10_000) });

  // the rewired selects must validate against the LIVE schema (PostgREST checks columns + embeds)
  for (const [table, select] of [
    ["invoice_payment_summary", SUMMARY_SELECT],
    ["invoices", INVOICE_SELECT],
  ] as const) {
    const res = await get(`/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=0`);
    assert.equal(res.status, 200, `LIVE ${table}: the rewired select must be valid (got ${res.status})`);
  }

  // negative control: the old paths are provably dead in LIVE
  for (const dead of ["invoice_debts", "documents"]) {
    const res = await get(`/rest/v1/${dead}?select=id&limit=1`);
    assert.equal(res.status, 404, `LIVE ${dead} must not exist (got ${res.status})`);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, "PGRST205", `LIVE ${dead} must report PGRST205`);
  }
  return "checked live (invoice_payment_summary + invoices embeds valid · invoice_debts/documents = 404 PGRST205)";
}

async function main() {
  const raw = read();
  const code = stripComments(raw);
  const preview = stripComments(bodyOf(raw, "previewPayment"));

  // 1 · legacy tables are gone from the preview path
  for (const dead of ["invoice_debts", "documents"]) {
    assert.equal(preview.includes(`.from("${dead}")`), false, `previewPayment must not query public.${dead}`);
  }

  // 1b · negative control — prove the checker above detects a real regression
  const planted = `${preview}\n  await supabase().from("invoice_debts").select("id");\n`;
  assert.equal(
    planted.includes('.from("invoice_debts")'),
    true,
    "negative control: a planted legacy reference must be detected by this checker",
  );

  // 2 · canonical read authority instead (persisted values, no recomputation)
  //      B-04C moved the reads into resolvePaymentFacts(), which previewPayment and
  //      executePayment share — so the assertion is on the payment section, not one body.
  const paymentSection = code.slice(code.indexOf("resolveReceiptInvoiceRelation"), code.indexOf("// ---- DOCUMENT CREATE ----"));
  assert.ok(paymentSection.includes('from("invoice_payment_summary")'), "the payment path must read the canonical receivable view");
  assert.ok(paymentSection.includes("outstanding"), "outstanding must be the persisted canonical value");
  assert.ok(paymentSection.includes("paid_amount"), "paid must be the persisted canonical value");
  assert.ok(paymentSection.includes("derived_status"), "status must come from the canonical view");
  assert.ok(paymentSection.includes('from("invoices")'), "invoice company/status must come from the canonical invoices read");
  assert.ok(paymentSection.includes('from("receipt_documents")'), "the receipt must be read from receipt_documents");
  assert.ok(paymentSection.includes('from("inbound_source_links")'), "the deterministic invoice relation must be inbound_source_links");

  // 3 · no new financial formula anywhere in the payment path
  for (const forbidden of [
    "VAT_RATE", "* 0.07", "calculateDocumentTotals", "roundMoney",
    "total_amount -", "receivable_amount -", "outstanding -", "Math.max(0",
  ]) {
    assert.equal(paymentSection.includes(forbidden), false, `no money formula may exist in the payment path (${forbidden})`);
  }

  // 4 · canonical token contract (B-04C): receipt + invoice + amount, never identity
  assert.ok(preview.includes('issueToken("payment", {'), "the preview must still issue a payment token");
  assert.ok(preview.includes("receipt_document_id: f.receipt_document_id"), "the token must carry the canonical receipt id");
  assert.ok(preview.includes("invoice_id: f.invoice_id"), "the token must carry the deterministic invoice id");
  assert.ok(preview.includes("amount: f.amount"), "the token must carry the canonical receipt amount");
  assert.equal(/issueToken\("payment", \{[^}]*actor/.test(code), false, "the token must never carry an actor");
  for (const key of ["receipt_document_id", "invoice_id", "document_number", "party_name", "amount", "outstanding_amount", "status"]) {
    assert.ok(preview.includes(key), `preview response key missing: ${key}`);
  }

  // 5 · B-04C completed B-04: the gateway payment path is canonical now (no legacy
  // monetary write, no legacy tables), while B-05 is still untouched.
  const execPay = stripComments(bodyOf(raw, "executePayment"));
  assert.equal(execPay.includes('.from("invoice_debts")'), false, "B-04C removed the invoice_debts dependency");
  assert.equal(execPay.includes('.from("invoice_payments")'), false, "B-04C removed the invoice_payments dependency");
  assert.ok(execPay.includes("confirmPayment("), "executePayment must commit through the canonical writer");
  assert.ok(execPay.includes("actor"), "executePayment must take a server actor");
  const execDebt = stripComments(bodyOf(raw, "executeDebtCreate"));
  assert.ok(execDebt.includes('.from("debt_trackings")'), "B-05 executeDebtCreate must keep debt_trackings");

  // 6 · no parallel implementation
  assert.equal(
    /previewPaymentV2|paymentPreviewRepository|financialReadV2|canonicalPaymentRead/.test(code),
    false,
    "no parallel payment-preview implementation may exist",
  );

  const live = await liveCheck();

  console.log("payment-preview-rewire:test PASS");
  console.log(
    `checks: no invoice_debts/documents in previewPayment · canonical invoice_payment_summary + invoices FK embed wired · persisted paid/outstanding (no formula) · contract retained · B-04C canonical executePayment · B-05 untouched · no parallel impl · live=${live}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

