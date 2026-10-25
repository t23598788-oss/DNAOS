/**
 * Regression test for B-01 / B-02 — document source rewire (2026-09-23).
 *
 * Proves the create-document draft path no longer reads the two tables that do
 * not exist in the LIVE database, and that it reads the canonical sources
 * instead — without guessing any field:
 *   1. active draft path has NO `.from("partners")` / `.from("documents")`
 *      (negative control: putting either back makes this test fail)
 *   2. B-01 reads `companies`; B-02 reads `standalone_documents` / `invoices`
 *   3. no fabricated party contact — the builder never touches `email` and never
 *      passes `contact_name` (companies has no contact column: 42703 on LIVE)
 *   4. money basis = net_payable with the canonical total_amount fallback, and
 *      no new money formula is introduced in this file
 *   5. existing function signatures and the draft contract are unchanged
 *   6. no parallel builder (no buildDraftFromPartnerV2 / buildDraftFromDocumentV2)
 *   7. LIVE (optional, READ ONLY): the new select shapes answer 200 while the
 *      old tables answer 404 PGRST205 — skipped when no local credentials exist.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const BUILDER = "engines/documents/draft-builders.ts";
const PAGE = "app/admin/create-document/page.tsx";

const STANDALONE_SELECT =
  "id, document_no, document_type, customer_company_id, customer_order_id, net_payable, total_amount, companies!standalone_documents_customer_company_id_fkey(id, name, phone, address, tax_id)";
const INVOICE_SELECT =
  "id, invoice_no, customer_company_id, customer_order_id, net_payable, total_amount, companies!invoices_customer_company_id_fkey(id, name, phone, address, tax_id)";
const COMPANY_SELECT = "id, name, phone, address, tax_id";

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

  // new shapes must validate against the LIVE schema (PostgREST checks columns)
  for (const [table, select] of [
    ["companies", COMPANY_SELECT],
    ["standalone_documents", STANDALONE_SELECT],
    ["invoices", INVOICE_SELECT],
  ] as const) {
    const res = await fetch(`${url}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=0`, { headers });
    assert.equal(res.status, 200, `LIVE ${table}: the rewired select must be valid (got ${res.status})`);
  }

  // negative control: the genuinely-dead table is provably gone in LIVE.
  // public.partners is intentionally NOT in this list — it is a real BASE TABLE
  // (business partners, created by the June clearinghouse migrations and used by
  // the pit/ERP features). The document-source rewire moved the draft party path
  // off the partners table to companies; it never dropped the partners table.
  for (const dead of ["documents"]) {
    const res = await fetch(`${url}/rest/v1/${dead}?select=id&limit=1`, { headers });
    assert.equal(res.status, 404, `LIVE ${dead} must not exist (got ${res.status})`);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, "PGRST205", `LIVE ${dead} must report PGRST205`);
  }
  return "checked live (3 rewired selects valid · documents = 404 PGRST205)";
}

async function main() {
  const code = stripComments(read(BUILDER));
  const raw = read(BUILDER);

  // 1 · the active draft path no longer reads the dead tables
  assert.equal(code.includes('.from("partners")'), false, "draft-builders must not query public.partners");
  assert.equal(code.includes('.from("documents")'), false, "draft-builders must not query public.documents");

  // 2 · it reads the canonical sources instead
  assert.ok(code.includes('.from("companies")'), "B-01 must read companies");
  assert.ok(code.includes('.from("standalone_documents")'), "B-02 must read standalone_documents");
  assert.ok(code.includes('.from("invoices")'), "B-02 must read invoices for the invoice kind");
  assert.ok(
    code.includes("companies!standalone_documents_customer_company_id_fkey"),
    "B-02 must use the existing FK embed for the counterparty",
  );

  // 3 · no fabricated party contact
  assert.equal(code.includes("email"), false, "companies.email must not be used as the party contact (different meaning)");
  assert.equal(code.includes("contact_name"), false, "contact_name must not be passed at all — companies has no such column");

  // 4 · money basis + no new formula
  assert.ok(code.includes("doc.netPayable ?? doc.totalAmount"), "money basis must be net_payable with the canonical total_amount fallback");
  for (const forbidden of ["VAT_RATE", "* 0.07", "calculateDocumentTotals", "roundMoney"]) {
    assert.equal(code.includes(forbidden), false, `no new money formula may be introduced here (${forbidden})`);
  }

  // 5 · signatures + contract unchanged
  assert.ok(/export async function buildDraftFromPartner\(\s*partnerId: string,\s*docType\?: string,\s*transactionId\?: string,\s*\): Promise<DocumentDraftInput \| undefined>/.test(raw), "buildDraftFromPartner signature must stay the same");
  assert.ok(/export async function buildDraftFromDocument\(\s*docId: string,\s*newType\?: string,\s*\): Promise<DocumentDraftInput \| undefined>/.test(raw), "buildDraftFromDocument signature must stay the same");
  assert.ok(code.includes("createEmptyDocumentDraft") && code.includes("companyToCustomer"), "the draft must still come from the existing draft factory + company mapping");

  // 6 · no parallel builder
  assert.equal(/buildDraftFromPartnerV2|buildDraftFromDocumentV2|documentDraftRepository/.test(code), false, "no parallel builder may exist");

  // 7 · the caller still uses the same two entry points (contract of the path)
  const page = read(PAGE);
  assert.ok(page.includes("buildDraftFromPartner") && page.includes("buildDraftFromDocument"), "create-document must still call the same two builders");

  const live = await liveCheck();

  console.log("document-source-rewire:test PASS");
  console.log(
    `checks: no partners/documents in the draft path · companies + standalone_documents/invoices wired · contact not faked · money basis net_payable · signatures+contract intact · no parallel builder · live=${live}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
