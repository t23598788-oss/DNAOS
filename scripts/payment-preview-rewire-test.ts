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
 *   5. B-04 / B-05 code is untouched (executePayment still on invoice_debts /
 *      invoice_payments, executeDebtCreate still on debt_trackings)
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
  assert.ok(preview.includes('.from("invoice_payment_summary")'), "B-03 must read the canonical receivable view");
  assert.ok(preview.includes("receivable_amount"), "principal must come from the persisted receivable_amount");
  assert.ok(preview.includes("receivable.outstanding"), "outstanding must be the persisted canonical value");
  assert.ok(preview.includes("receivable.paid_amount"), "paid must be the persisted canonical value");
  assert.ok(preview.includes('.from("invoices")'), "party name must come from the canonical invoices read");
  assert.ok(
    preview.includes("companies!invoices_customer_company_id_fkey"),
    "the counterparty must use the existing FK embed, never a hand-rolled join",
  );
  assert.ok(
    preview.includes('receivable.derived_status === "PAID"') && preview.includes('"VOID"') && preview.includes('"CLOSED"'),
    "status must follow the canonical PAID|VOID → CLOSED mapping used by getOpenDebts/getAllDebts",
  );

  // 3 · no new financial formula
  for (const forbidden of [
    "VAT_RATE", "* 0.07", "calculateDocumentTotals", "roundMoney",
    "total_amount -", "receivable_amount -", "outstanding -",
  ]) {
    assert.equal(preview.includes(forbidden), false, `no new money formula may be introduced (${forbidden})`);
  }
  assert.equal(
    /outstanding\s*=\s*[^;]*[-+*/]/.test(preview),
    false,
    "outstanding must not be re-derived by arithmetic — read the canonical persisted value",
  );

  // 4 · contract + handshake unchanged (this is what keeps B-04 executePayment working)
  for (const key of [
    "invoice_debt_id:", "document_number:", "party_name:", "principal_amount:", "outstanding_amount:",
    "current_interest:", "paid_so_far:", "status:", "will_change:",
  ]) {
    assert.ok(preview.includes(key), `preview contract key missing: ${key}`);
  }
  assert.ok(
    preview.includes('issueToken("payment", { invoice_debt_id: invoiceDebtId })'),
    "the preview→execute token payload must stay the same",
  );
  assert.ok(
    /export async function previewPayment\(invoiceDebtId: string\): Promise<ActionResponse>/.test(raw),
    "previewPayment signature must stay the same",
  );
  assert.equal(
    /\.(insert|update|upsert|delete)\(/.test(preview),
    false,
    "preview must stay READ ONLY (no write call in the body)",
  );

  // 5 · B-04 / B-05 boundaries: their code must be untouched
  const execPay = stripComments(bodyOf(raw, "executePayment"));
  assert.ok(execPay.includes('.from("invoice_debts")'), "B-04 executePayment must keep its own (unchanged) legacy path");
  assert.ok(execPay.includes('.from("invoice_payments")'), "B-04 executePayment must keep invoice_payments");
  assert.ok(execPay.includes("invoice_debt_id"), "B-04 must still accept the invoice_debt_id handshake from preview");
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
    `checks: no invoice_debts/documents in previewPayment · canonical invoice_payment_summary + invoices FK embed wired · persisted paid/outstanding (no formula) · contract+token handshake intact · B-04/B-05 untouched · no parallel impl · live=${live}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

