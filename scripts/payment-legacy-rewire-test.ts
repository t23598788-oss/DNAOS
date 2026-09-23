/**
 * B-04C — complete payment reconciliation: gateway → canonical writer, legacy removed.
 *
 * Structural proof (always runnable, no database):
 *   1. the gateway payment path writes NO monetary row and touches neither legacy table;
 *   2. executePayment commits ONLY through the canonical writer, with a server actor;
 *   3. the invoice comes from an explicit id or the deterministic inbound_source_links
 *      relation — never derived from company/amount/date;
 *   4. the token carries { receipt_document_id, invoice_id, amount } and no identity;
 *   5. there is no legacy fallback: a canonical failure returns the canonical error;
 *   6. authority census: one write authority (payment-write.ts), one DB commit
 *      implementation (the migration), and the gateway never calls a payment RPC;
 *   7. every remaining mention of the legacy tables is classified, with zero ACTIVE
 *      runtime monetary references.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const GATEWAY = "gateway/actions.ts";
const WRITER = "engines/canonical/payment-write.ts";
const RPC_NAMES = ["confirm_payment_allocation", "reallocate_payment_allocation"];

function bodyOf(src: string, name: string): string {
  // some helpers (e.g. the relation resolver) are internal — allow both forms,
  // and stop the body at the next function declaration of either kind
  let start = src.indexOf(`export async function ${name}(`);
  if (start < 0) start = src.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `function ${name}() must exist`);
  const rest = src.slice(start + 1);
  const nextExport = rest.search(/\nexport /);
  const nextInternal = rest.search(/\nasync function /);
  const candidates = [nextExport, nextInternal].filter((n) => n !== -1);
  const next = candidates.length ? Math.min(...candidates) : -1;
  return next === -1 ? rest : rest.slice(0, next);
}

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walkFiles(rel, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

function testGatewayContract() {
  const gatewayRaw = read(GATEWAY);
  const gateway = stripComments(gatewayRaw);
  const preview = stripComments(bodyOf(gatewayRaw, "previewPayment"));
  const execute = stripComments(bodyOf(gatewayRaw, "executePayment"));

  // 1 · no legacy monetary write anywhere in the gateway
  for (const legacy of ["invoice_debts", "invoice_payments"]) {
    assert.equal(gateway.includes(`from("${legacy}")`), false, `the gateway must not touch ${legacy}`);
  }
  assert.equal(/from\("payment_allocations"\)[\s\S]{0,60}?\.(insert|update|upsert|delete)\(/.test(gateway), false,
    "the gateway must not write payment_allocations");
  // the PAYMENT path specifically must not write invoice state (document.create legitimately
  // inserts invoices through the confirm_invoice RPC — that is a different concern)
  assert.equal(/from\("invoices"\)[\s\S]{0,60}?\.(insert|update|upsert|delete)\(/.test(execute), false,
    "the payment path must not write invoice payment state");
  assert.equal(/\.(insert|update|upsert)\([^;]{0,200}paid_amount/.test(gateway), false,
    "the gateway must never write paid_amount (reading it is fine)");

  // 2 · executePayment commits only through the canonical writer, with a server actor
  assert.ok(execute.includes("confirmPayment("), "executePayment must call the canonical writer");
  assert.ok(/export async function executePayment\(payload: PaymentInput, actor: string\)/.test(gatewayRaw), "executePayment must take the server actor explicitly");
  assert.ok(execute.includes("if (!actor?.trim())"), "executePayment must refuse an empty actor");
  assert.equal(/payload\.actor|payload\["actor"\]/.test(execute), false, "executePayment must never read an actor from the payload");

  // 3 · deterministic relation, never guessed
  const resolver = stripComments(bodyOf(gatewayRaw, "resolveReceiptInvoiceRelation"));
  assert.ok(resolver.includes('from("inbound_source_links")'), "the relation must come from inbound_source_links");
  assert.equal(/from\("invoices"\)|from\("companies"\)|from\("customer_orders"\)/.test(resolver), false,
    "the resolver must not consult any other table (that would be guessing)");
  assert.equal(/ilike|\.or\(|closest/.test(gateway), false, "no fuzzy invoice matching may exist");
  assert.ok(gateway.includes("ต้องระบุ allocation อย่างชัดเจน"), "an absent/ambiguous relation must fail closed with an explicit instruction");

  // 4 · token contract
  assert.ok(preview.includes('issueToken("payment", {'), "previewPayment must still issue the payment token");
  assert.equal(/issueToken\("payment", \{[^}]*actor/.test(gateway), false, "the token must never carry an actor");
  assert.ok(gateway.includes("invoice_id: f.invoice_id") && gateway.includes("amount: f.amount"), "the token must carry invoice + canonical amount");

  // 5 · fail closed, never a legacy fallback
  assert.equal(gateway.includes('from("invoice_payments").insert'), false, "no legacy insert fallback");
  const catchBlock = execute.slice(execute.indexOf("catch ("));
  assert.ok(catchBlock.includes("return { ok: false"), "a canonical failure must return an error, not retry another path");
}


function testAuthorityCensus() {
  const files = ["app", "core", "engines", "services", "gateway", "scripts"].flatMap((d) => walkFiles(d));
  const rpcCallers: string[] = [];
  const directWriters: string[] = [];
  const legacyWriters: string[] = [];
  for (const rel of files) {
    if (rel.startsWith("scripts/")) continue; // tests may name these strings in assertions
    const src = stripComments(read(rel));
    if (RPC_NAMES.some((n) => src.includes(`rpc("${n}"`))) rpcCallers.push(rel);
    if (/from\("payment_allocations"\)[\s\S]{0,60}?\.(insert|update|upsert|delete)\(/.test(src)) directWriters.push(rel);
    if (/from\("invoice_debts"\)|from\("invoice_payments"\)/.test(src)) legacyWriters.push(rel);
  }
  assert.deepEqual([...new Set(rpcCallers)], [WRITER], `only the canonical writer may call the payment RPCs, got: ${[...new Set(rpcCallers)].join(", ")}`);
  assert.deepEqual([...new Set(directWriters)], [], `no TypeScript file may write payment_allocations, got: ${[...new Set(directWriters)].join(", ")}`);
  assert.deepEqual([...new Set(legacyWriters)], [], `no runtime file may reference the legacy tables, got: ${[...new Set(legacyWriters)].join(", ")}`);

  const migrations = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql"));
  const impls = migrations.filter((f) => read(`supabase/migrations/${f}`).includes("function public.confirm_payment_allocation"));
  assert.equal(impls.length, 1, `exactly one DB commit implementation expected, got: ${impls.join(", ")}`);
  return { authorities: [WRITER], commitImpl: `supabase/migrations/${impls[0]}` };
}

function testLegacyReferenceClassification() {
  const files = ["app", "core", "engines", "services", "gateway", "scripts"].flatMap((d) => walkFiles(d));
  const activeRuntime: string[] = [];
  const diagnosticMetadata: string[] = [];
  const documentationOrTest: string[] = [];
  for (const rel of files) {
    const raw = read(rel);
    if (!raw.includes("invoice_debts") && !raw.includes("invoice_payments")) continue;
    if (rel.startsWith("scripts/")) { documentationOrTest.push(rel); continue; }
    const code = stripComments(raw);
    // an active runtime reference = a query/write against those tables
    if (/from\("(invoice_debts|invoice_payments)"\)/.test(code)) activeRuntime.push(rel);
    else diagnosticMetadata.push(rel);
  }
  const sqlLegacy = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => {
    const sql = read(`supabase/migrations/${f}`);
    return sql.includes("invoice_debts") || sql.includes("invoice_payments");
  });
  assert.deepEqual(activeRuntime, [], `ACTIVE runtime monetary references must be 0, got: ${activeRuntime.join(", ")}`);
  return { activeRuntime: 0, diagnosticMetadata, documentationOrTest, migrationHistorical: sqlLegacy.length };
}

function main() {
  testGatewayContract();
  const census = testAuthorityCensus();
  const classification = testLegacyReferenceClassification();

  console.log("payment-legacy-rewire:test PASS");
  console.log(
    `checks: gateway legacy writes=0 · executePayment→confirmPayment(actor) · deterministic relation (inbound_source_links) · token {receipt,invoice,amount} · fail-closed (no legacy fallback) · authority=${census.authorities.join(",")} (count=1) · commit_impl=${census.commitImpl} (count=1)`,
  );
  console.log(
    `legacy refs: ACTIVE_RUNTIME=${classification.activeRuntime} · diagnostic_metadata=${classification.diagnosticMetadata.length} (${classification.diagnosticMetadata.join(", ")}) · doc_test=${classification.documentationOrTest.length} · migration_historical=${classification.migrationHistorical}`,
  );
}

main();

