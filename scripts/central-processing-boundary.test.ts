/**
 * CENTRAL PROCESSING AUTHORITY — BOUNDARY REGRESSION (2026-10-25)
 *
 * Static + mock only: no DB, no network, no credentials, no production writes.
 * Proves (or disproves) the architecture rule:
 *
 *   "ทุกช่องทางเป็น Transport Adapter เท่านั้น — ไม่มีอำนาจประมวลผลธุรกิจ
 *    บันทึกการเงิน คำนวณราคา หรือออกเอกสารเป็นของตัวเอง"
 *
 * Checks
 *   A  Adapter purity        — provider adapters / observe routes contain NO business write
 *   B  Provider-tier census  — legacy provider tier must not write business tables directly
 *   C  Mock parity           — LINE and Meta normalize into the SAME canonical event shape
 *   D  Writer independence   — canonical writers never import or branch on a provider
 *   E  Public read gate      — public reader goes through the publication policy, not raw tables
 *   F  Cross-org scope       — an authenticated actor carries an explicit company scope
 *
 * Exit code: 0 by default (the report is the deliverable). Pass `--strict` to exit 1
 * when any GATE check fails — this is how the same file can be used as a CI gate later.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, relative } from "path";
import { normalizeLineWebhook } from "../engines/integration-gateway/adapters/line";
import { normalizeMetaWebhook } from "../engines/integration-gateway/adapters/meta";
import { isGatewayEvent } from "../engines/integration-gateway/contracts/event";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

let checks = 0;
let failed = 0;
const fail = (msg: string, evidence?: string) => {
  failed += 1;
  checks += 1;
  console.log(`FAIL  ${msg}${evidence ? `\n        ↳ ${evidence}` : ""}`);
};
const pass = (msg: string, evidence?: string) => {
  checks += 1;
  console.log(`PASS  ${msg}${evidence ? `\n        ↳ ${evidence}` : ""}`);
};

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(join(ROOT, dir))) return out;
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (name.endsWith(".ts")) out.push(rel);
  }
  return out;
}

/** Tables whose rows are business truth — a transport tier must never write them. */
const BUSINESS_TABLES = new Set([
  "companies",
  "customer_sites",
  "customer_orders",
  "projects",
  "document_groups",
  "invoices",
  "invoice_items",
  "standalone_documents",
  "standalone_document_items",
  "company_expenses",
  "partner_payable_requests",
  "payment_allocations",
  "debt_events",
  "receipt_documents",
  "business_events",
  "pit_materials",
  "pit_price_requests",
  "pit_profiles",
  "material_types",
  "pending_authorizations",
  "print_jobs",
  "supabase_billing_events",
  "credit_agreements",
  "fee_charges",
  "fee_contracts",
  "tax_register_entries",
]);

/** Direct-write census: for every write op, find the table on the same chain (<=8 lines above). */
function findBusinessWrites(file: string) {
  const src = read(file);
  const lines = src.split("\n");
  const hits: Array<{ table: string; op: string; line: number; snippet: string }> = [];
  const writeOp = /\.(insert|update|upsert|delete)\(|\.rpc\(/;
  for (let i = 0; i < lines.length; i += 1) {
    if (!writeOp.test(lines[i])) continue;
    for (let j = i; j >= Math.max(0, i - 8); j -= 1) {
      const m = lines[j].match(/\.from\(\s*["'`]([a-z_]+)["'`]\s*\)/);
      if (!m) continue;
      if (BUSINESS_TABLES.has(m[1])) {
        const op = (lines[i].match(/\.(insert|update|upsert|delete|rpc)\(/) ?? [, "?"])[1];
        hits.push({ table: m[1], op, line: i + 1, snippet: lines[i].trim().slice(0, 90) });
      }
      break;
    }
  }
  return hits;
}

console.log("=== A — ADAPTER PURITY (transport tier contains no business write) ===");
const adapterFiles = [
  ...walk("engines/integration-gateway/adapters"),
  ...walk("app/api/gateway/observe"),
];
for (const f of adapterFiles) {
  const writes = findBusinessWrites(f);
  if (writes.length) {
    fail(`A ${f} writes business tables`, writes.map((w) => `${w.table}.${w.op} (L${w.line})`).join(", "));
  } else {
    pass(`A ${f} — no business-table write`);
  }
}
for (const f of adapterFiles) {
  const src = read(f);
  const forbidden = ["recordCanonicalAudit", "createDocument(", "confirmPayment(", "issueDocument("].filter((t) =>
    src.includes(t),
  );
  if (forbidden.length) fail(`A ${f} calls a canonical business writer`, forbidden.join(", "));
  else pass(`A ${f} — no canonical business writer call`);
}

console.log("\n=== B — PROVIDER-TIER DIRECT WRITE CENSUS (LEGACY LINE EDGE FUNCTION) ===");
const providerTier = walk("supabase/functions/line-webhook-v2");
const findings: Array<{ file: string; table: string; op: string; line: number }> = [];
for (const f of providerTier) {
  for (const w of findBusinessWrites(f)) findings.push({ file: f, table: w.table, op: w.op, line: w.line });
}
if (findings.length === 0) pass("B provider tier writes no business table directly");
else {
  fail(
    `B ${findings.length} direct business write(s) remain in the provider tier`,
    findings.map((f) => `${relative("supabase/functions/line-webhook-v2", f.file)}:${f.line} ${f.table}.${f.op}`).join("\n        ↳ "),
  );
}
// Sanctioned bridges may only hand data to a central boundary (Connect internal routes
// or the gateway observe ingress). A read-only bridge (no fetch, no write) is out of scope.
const BRIDGE_TARGETS = ["/api/internal/connect/", "/api/gateway/observe/"];
const bridgeFiles = walk("supabase/functions/_shared").filter((f) => /connect-/.test(f));
for (const f of bridgeFiles) {
  const src = read(f);
  const direct = findBusinessWrites(f);
  const transports = /fetch\(/.test(src);
  if (direct.length) fail(`B bridge ${f} writes a business table directly`, JSON.stringify(direct));
  else if (transports && !BRIDGE_TARGETS.some((t) => src.includes(t)))
    fail(`B bridge ${f} transports data outside the central boundary`);
  else if (transports) pass(`B bridge ${f} — central boundary only, no direct write`);
  else pass(`B bridge ${f} — read-only (no transport, no write)`);
}

console.log("\n=== C — MOCK PARITY (same Intent shape from two providers) ===");
const linePayload = {
  destination: "U_destination_account",
  events: [
    {
      type: "message",
      webhookEventId: "01HTESTLINE0001",
      timestamp: 1790000000000,
      source: { type: "user", userId: "U_seller_test" },
      message: { id: "line-msg-1", type: "text", text: "ราคาหิน 1 คิว เท่าไหร่" },
      replyToken: "reply-token",
      deliveryContext: { isRedelivery: false },
    },
  ],
};
const metaPayload = {
  object: "page",
  entry: [
    {
      id: "page-123",
      messaging: [
        {
          sender: { id: "psid-999" },
          recipient: { id: "page-123" },
          timestamp: 1790000000000,
          message: { mid: "m_meta_1", text: "ราคาหิน 1 คิว เท่าไหร่" },
        },
      ],
    },
  ],
};

const lineOut = normalizeLineWebhook(linePayload);
const metaOut = normalizeMetaWebhook(metaPayload);
const lineEv = lineOut.events[0];
const metaEv = metaOut.events[0];

if (!lineEv || !metaEv) fail("C one provider produced no event", `line=${lineOut.events.length} meta=${metaOut.events.length}`);
else {
  if (lineEv.capability === metaEv.capability && lineEv.capability === "message.received")
    pass(`C both providers map to the same capability`, lineEv.capability);
  else fail("C capabilities differ", `${lineEv.capability} vs ${metaEv.capability}`);

  if (lineEv.channel === "observe" && metaEv.channel === "observe" && isGatewayEvent(lineEv) && isGatewayEvent(metaEv))
    pass("C both events satisfy the canonical GatewayEvent contract (channel=observe)");
  else fail("C event contract mismatch");

  const lineAgain = normalizeLineWebhook(linePayload).events[0];
  const metaAgain = normalizeMetaWebhook(metaPayload).events[0];
  if (lineAgain?.event_id === lineEv.event_id && metaAgain?.event_id === metaEv.event_id)
    pass("C event_id is deterministic (same message ⇒ same id ⇒ idempotent upsert)");
  else fail("C event_id is not deterministic");

  if (lineEv.event_id !== metaEv.event_id) pass("C providers cannot collide on event_id");
  else fail("C event_id collision across providers");

  // Required transport fields (STEP 01): provider, account, sender identity, message id, timestamp.
  const metaEvidence = metaEv.evidence as Record<string, unknown>;
  const lineEvidence = lineEv.evidence as Record<string, unknown>;
  const has = (e: Record<string, unknown>, k: string) => e[k] !== undefined && e[k] !== null;

  if (has(metaEvidence, "sender_id") && has(metaEvidence, "entry_id") && has(metaEvidence, "webhook_event_id"))
    pass("C meta evidence keeps sender identity + account + message id");
  else fail("C meta evidence is missing a required transport field", JSON.stringify(metaEvidence));

  if (has(lineEvidence, "source_type") && !("sender_id" in lineEvidence))
    fail(
      "C LINE evidence drops SENDER IDENTITY (provider identity cannot be attributed downstream)",
      `evidence keys = ${Object.keys(lineEvidence).join(",")}`,
    );
  else if (has(lineEvidence, "sender_id")) pass("C line evidence keeps sender identity");

  if (!JSON.stringify(lineEvidence).includes("ราคาหิน") && !JSON.stringify(metaEvidence).includes("ราคาหิน"))
    pass("C raw message text never enters evidence (privacy boundary holds)");
  else fail("C raw message text leaked into evidence");
}

console.log("\n=== D — CANONICAL WRITER INDEPENDENCE (no provider branching) ===");
const canonicalFiles = walk("engines/canonical");
for (const f of canonicalFiles) {
  const src = read(f);
  const problems: string[] = [];
  if (/from\s+["'][^"']*(engines\/connect|supabase\/functions|registry\/communication)/.test(src))
    problems.push("imports a provider layer");
  if (/provider\s*===?\s*["'](line|facebook|instagram|messenger)["']/.test(src))
    problems.push("branches on provider name");
  if (/api\.line\.me|graph\.facebook\.com/.test(src)) problems.push("calls a provider API");
  if (/from\s+["'][^"']*integrations?\/gateway\/adapters/.test(src)) problems.push("imports a provider adapter");
  if (problems.length) fail(`D ${f} is provider-coupled`, problems.join(", "));
  else pass(`D ${f} — provider-independent`);
}

console.log("\n=== E — PUBLIC READ GATE ===");
{
  const reader = read("services/public-catalog/reader.ts");
  if (reader.includes("publication_records") && /core\/public-catalog\/policy/.test(reader))
    pass("E public reader reads through publication_records + policy (no raw business table passthrough)");
  else fail("E public reader bypasses the publication gate");
  const api = read("app/api/public/products/route.ts");
  if (/publication|policy|readPublicCatalog/.test(api)) pass("E public products API depends on the same gate");
  else fail("E public products API bypasses the publication gate");
}

console.log("\n=== F — CROSS-ORG / COMPANY SCOPE ===");
{
  const requireAuth = read("core/auth/requireAuth.ts");
  const session = read("core/auth/session.ts");
  if (/company_scope|company_ids|companyScopes/.test(requireAuth) || /company_scope|company_ids/.test(session))
    pass("F authenticated actor carries an explicit company scope");
  else
    fail(
      "F NO company scope on the authenticated actor — a single role can act across organisations",
      "core/auth/requireAuth.ts + core/auth/session.ts carry role only",
    );
}

console.log("\n=== G — WAVE 1 CROSS-CHANNEL BUSINESS-INTENT CHECKS ===");
{
  // G1 adapters must NOT invent business fields (intent extraction belongs to the central engine).
  const businessKeys = ["material", "quantity", "price", "amount", "company_id", "customer_id", "tax", "total"];
  for (const [name, ev] of [
    ["line", lineEv],
    ["meta", metaEv],
  ] as const) {
    if (!ev) continue;
    const leaked = businessKeys.filter((k) => k in (ev.evidence as Record<string, unknown>));
    if (leaked.length) fail(`G1 ${name} adapter invents business fields`, leaked.join(","));
    else pass(`G1 ${name} adapter carries transport evidence only (no material/price/company)`);
  }

  // G2 no adapter may reference a financial writer or a money table.
  const moneyTokens = ["payment_allocations", "document-write", "createDocument(", "confirmPayment(", "pit_materials"];
  for (const f of adapterFiles) {
    const src = read(f);
    const hit = moneyTokens.filter((t) => src.includes(t));
    if (hit.length) fail(`G2 ${f} touches financial authority`, hit.join(","));
    else pass(`G2 ${f} — no financial writer/table reference`);
  }

  // G3 the provider tier must not issue documents.
  const edgeFiles = providerTier;
  let docIssuers = 0;
  for (const f of edgeFiles) {
    const src = read(f);
    if (/createDocument\(|issueDocument\(|document-write/.test(src)) {
      docIssuers += 1;
      fail(`G3 ${f} issues documents from the provider tier`);
    }
    if (findBusinessWrites(f).some((w) => w.table === "invoices" || w.table === "standalone_documents")) {
      docIssuers += 1;
      fail(`G3 ${f} writes a document table directly`);
    }
  }
  if (docIssuers === 0) pass("G3 provider tier issues no document (0 writer calls, 0 document-table writes)");

  // G4 no price mutation from a provider message without a permission check.
  {
    const f = "supabase/functions/line-webhook-v2/engines/supplier-quote-reply.ts";
    const src = read(f);
    const writesPrice = /from\("pit_materials"\)[\s\S]{0,120}\.(insert|update)\(/.test(src);
    const hasPermissionCheck = /authority|canWritePrice|scope|permission|grant/i.test(src);
    if (writesPrice && !hasPermissionCheck)
      fail("G4 provider message mutates the central price with NO permission check", `${f} writes pit_materials, no authority/scope reference`);
    else if (writesPrice) pass("G4 price mutation is guarded by a permission check");
    else pass("G4 provider tier does not mutate the central price");
  }

  // G5 duplicate command must not create a duplicate transaction.
  {
    const src = read("engines/canonical/transaction-write.ts");
    const hasIdempotency = /idempotenc|onConflict|upsert\(|unique/i.test(src);
    if (hasIdempotency) pass("G5 transaction creation carries an idempotency guard");
    else
      fail(
        "G5 transaction creation has NO idempotency guard (a retried command creates a second order)",
        "engines/canonical/transaction-write.ts generates ORD-<date>-<ms> with no idempotency key",
      );
  }

  // G6 the reply must be able to leave through the same channel the contact used.
  {
    const lineOutbound = /pushMessages|replyMessages|LINE_MESSAGING_API|api\.line\.me/.test(
      read("supabase/functions/line-webhook-v2/engines/response.ts"),
    );
    // A real outbound capability means an actual provider send endpoint — not the
    // word "messenger" in a comment. Only graph.facebook.com counts today.
    const metaOutbound = [...walk("app/api"), ...walk("engines"), ...walk("supabase/functions")].some((f) =>
      /graph\.facebook\.com/.test(read(f)),
    );
    if (lineOutbound) pass("G6 LINE can reply through the same channel (push/reply path exists)");
    else fail("G6 LINE has no reply path");
    if (metaOutbound) pass("G6 Meta can reply through the same channel");
    else
      fail(
        "G6 Meta has NO outbound path — an inbound Messenger intent cannot be answered on its own channel",
        "no graph.facebook.com / send capability anywhere in the repo",
      );
  }

  // G7 provider identity must never be matched to an organisation by display name.
  {
    const lineAdapter = read("engines/integration-gateway/adapters/line.ts");
    const metaAdapter = read("engines/integration-gateway/adapters/meta.ts");
    const nameMatching = /display_?name|displayName|line_name/i.test(lineAdapter) || /display_?name|displayName/i.test(metaAdapter);
    if (nameMatching) fail("G7 adapter resolves identity from a display name");
    else pass("G7 adapters never match identity by display name (no accidental authority)");
  }
}

console.log("\n=== SUMMARY ===");
console.log(`checks=${checks} failed=${failed}`);
console.log(failed === 0 ? "GATE: PASS" : `GATE: FAIL (${failed} finding${failed === 1 ? "" : "s"})`);
if (process.argv.includes("--strict") && failed > 0) process.exit(1);
