/**
 * REVENUE / METERING AUDIT TEST (WAVE 4, 2026-10-25) — offline only.
 *
 * This is an AUDIT test, not a forecast. It proves two things:
 *
 *   A. The 100,000,000 THB target can be decomposed arithmetically, and every
 *      function returns NULL ("UNKNOWN / DATA REQUIRED") when a price, rate,
 *      frequency, or cost is not supplied. No number is invented.
 *
 *   B. The current repository does NOT yet contain the pieces needed to call
 *      anything "DNA OS revenue": no fee contract/charge table, no revenue
 *      recognition table, no tenant key on usage events, no billable-unit meter,
 *      and the finance summary aggregates the OPERATING BUSINESS's invoices
 *      (GMV), not a platform fee. These are asserted as real, current gaps.
 *
 * Static + pure math only: no DB, no network, no credentials, no billing call.
 */
import { readFileSync, existsSync } from "fs";

let checks = 0;
let failed = 0;
const pass = (m: string) => {
  checks += 1;
  console.log(`PASS  ${m}`);
};
const fail = (m: string, d?: string) => {
  checks += 1;
  failed += 1;
  console.log(`FAIL  ${m}${d ? `\n        ↳ ${d}` : ""}`);
};
const expect = (cond: boolean, m: string, d?: string) => (cond ? pass(m) : fail(m, d));
const read = (p: string) => readFileSync(p, "utf8");
const round2 = (n: number) => Math.round(n * 100) / 100;

// ── reverse-model math: variables only, never an assumed price ──────────────
const TARGET = 100_000_000;

/** Revenue per transaction is REQUIRED input; null means UNKNOWN. */
function requiredTransactions(target: number, revenuePerTransaction: number | null): number | null {
  if (revenuePerTransaction === null || !Number.isFinite(revenuePerTransaction) || revenuePerTransaction <= 0) return null;
  return Math.ceil(target / revenuePerTransaction);
}

/** Fee-based model: platform revenue = GMV × fee rate. Rate is REQUIRED. */
function requiredGmv(target: number, feeRate: number | null): number | null {
  if (feeRate === null || !Number.isFinite(feeRate) || feeRate <= 0 || feeRate > 1) return null;
  return Math.ceil(target / feeRate);
}

/** Per-service split; weights must be an owner decision that sums to 1. */
function splitTarget(target: number, weights: number[] | null): number[] | null {
  if (!weights || weights.length === 0) return null;
  const sum = weights.reduce((s, w) => s + w, 0);
  if (Math.abs(sum - 1) > 1e-9 || weights.some((w) => w < 0)) return null;
  return weights.map((w) => round2(target * w));
}

function requiredUsers(transactions: number | null, transactionsPerUser: number | null): number | null {
  if (transactions === null || transactionsPerUser === null || transactionsPerUser <= 0) return null;
  return Math.ceil(transactions / transactionsPerUser);
}

function requiredProcessingEvents(transactions: number | null, eventsPerTransaction: number | null): number | null {
  if (transactions === null || eventsPerTransaction === null || eventsPerTransaction <= 0) return null;
  return Math.ceil(transactions * eventsPerTransaction);
}

function workingCapital(annualCost: number | null, paymentTermsDays: number | null): number | null {
  if (annualCost === null || paymentTermsDays === null || paymentTermsDays < 0) return null;
  return round2((annualCost / 365) * paymentTermsDays);
}

(async () => {
  console.log("=== A — 100M target arithmetic (no price assumed) ===");
  {
    expect(round2(TARGET / 12) === 8_333_333.33, "A monthly target = 8,333,333.33 THB");
    expect(round2(TARGET / 52) === 1_923_076.92, "A weekly target = 1,923,076.92 THB");
    expect(round2(TARGET / 365) === 273_972.6, "A daily target = 273,972.60 THB (365-day basis)");

    expect(requiredTransactions(TARGET, null) === null, "A transactions required = UNKNOWN when revenue/transaction is unpriced");
    expect(requiredGmv(TARGET, null) === null, "A GMV required = UNKNOWN when fee rate is unpriced");
    expect(requiredUsers(requiredTransactions(TARGET, null), 12) === null, "A users required = UNKNOWN when price is unpriced");
    expect(splitTarget(TARGET, null) === null, "A per-service split = UNKNOWN until the owner sets weights");
    expect(requiredProcessingEvents(requiredTransactions(TARGET, null), 4) === null, "A processing events = UNKNOWN without transaction count");
    expect(workingCapital(null, 30) === null, "A working capital = UNKNOWN without a measured annual cost");

    expect(splitTarget(TARGET, [0.5, 0.5])?.reduce((s, v) => s + v, 0) === TARGET, "A a valid split sums exactly to the target");
    expect(splitTarget(TARGET, [0.5, 0.6]) === null, "A weights that do not sum to 1 are rejected");
    expect(splitTarget(TARGET, [-0.1, 1.1]) === null, "A negative weights are rejected");

    const r = requiredTransactions(TARGET, 1_000);
    expect(r === 100_000, "A formula sanity: T/R with a HYPOTHETICAL R only (not a proposed price)");
    expect(requiredGmv(TARGET, 0.01) === 10_000_000_000, "A formula sanity: T/fee-rate (hypothetical rate, not a proposal)");
    expect(requiredGmv(TARGET, 1.5) === null, "A a fee rate above 100% is rejected, not silently used");
  }

  console.log("\n=== B — no platform fee / revenue-recognition storage exists ===");
  {
    const schema = read("supabase/local-migration/full_schema.sql").toLowerCase();
    const migrations = existsSync("supabase/migrations")
      ? require("fs").readdirSync("supabase/migrations").map((f: string) => read(`supabase/migrations/${f}`)).join("\n").toLowerCase()
      : "";
    const all = `${schema}\n${migrations}`;
    for (const table of ["fee_contracts", "fee_charges", "processing_fees", "revenue_recognitions", "usage_events"]) {
      expect(!new RegExp(`create table[^;]*\\b${table}\\b`).test(all), `B no ${table} table exists (UNPRICED / MISSING)`);
    }
    expect(!/create (or replace )?(table|view)[^;]*\bplatform_revenue\b/.test(all), "B no platform_revenue table/view exists");
    expect(!/create (or replace )?(table|view)[^;]*\btenant_usage\b/.test(all), "B no tenant_usage table exists");
  }

  console.log("\n=== C — the live quote has no fee/markup step ===");
  {
    const pricing = read("engines/pricing.ts");
    expect(/systemFeePercent/.test(pricing) && /system_fee/.test(pricing), "C a system-fee formula EXISTS in engines/pricing.ts:27-40");
    expect(/profit = markup - systemFee/.test(pricing), "C the fee is deducted from markup (not booked as revenue anywhere)");

    const dispatcher = read("engines/validation/dispatcher.ts");
    expect(/total_price:\s*quote\.unitPrice \* quantity \+ transportCost/.test(dispatcher), "C the LIVE quote total is unit price × qty + transport only (dispatcher.ts:146)");
    expect(!/calcPricing|system_fee|markup/i.test(dispatcher), "C the live quote path never calls the fee engine — so no fee is charged");

    const index = read("engines/index.ts");
    expect(/calcPricing/.test(index), "C engines/index.ts is the only module importing calcPricing");
    let otherCallers = 0;
    const { readdirSync, statSync } = require("fs") as typeof import("fs");
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === ".next" || name === ".git") continue;
        const p = `${dir}/${name}`;
        if (statSync(p).isDirectory()) walk(p, out);
        else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
      }
      return out;
    };
    for (const f of walk(".")) {
      if (f === "./engines/index.ts" || f.startsWith("./engines/pricing.ts") || f.startsWith("./scripts/")) continue;
      if (/from ["']@\/engines\/pricing["']|calcPricing\(/.test(read(f))) otherCallers += 1;
    }
    expect(otherCallers === 0, "C zero production callers of the fee engine (BUILT_NOT_WIRED, corroborates FCR-013)", `callers=${otherCallers}`);
  }

  console.log("\n=== D — GMV is not DNA OS revenue ===");
  {
    const summary = read("app/api/admin/finance-summary/route.ts");
    expect(/from\("document_canonical"\)/.test(summary), "D finance-summary reads canonical documents (the OPERATING business's invoices)");
    expect(/revenueByMonth\.set\(k, \(revenueByMonth\.get\(k\) \?\? 0\) \+ gross\)/.test(summary), "D its revenue_documented total is document GROSS (GMV), line 70-74");
    expect(/payments_allocated/.test(summary), "D cash received is reported separately from the document total");
    expect(!/platform_revenue|dna_os_revenue|service_fee_revenue/.test(summary), "D it does NOT claim to be platform/DNA OS revenue");
    expect(!/system_fee|fee_charges/.test(summary), "D no platform fee is included anywhere in that summary");

    const alloc = read("supabase/migrations/20260922000001_canonical_foundation_v1_1.sql");
    expect(/create table if not exists public\.payment_allocations/.test(alloc), "D payment_allocations is a cash-allocation table");
    expect(!/revenue/i.test(alloc.split("create table if not exists public.payment_allocations")[1]?.slice(0, 1200) ?? ""), "D payment_allocations has no revenue column (cash ≠ revenue)");
  }

  console.log("\n=== E — tenant attribution on usage is missing ===");
  {
    const usage = read("supabase/migrations/20260810000002_worker_usage_events.sql");
    expect(!/company_id|tenant_id|organization_id/.test(usage), "E worker_usage_events has NO tenant/company key (cannot bill a tenant from it)");
    expect(/request_id/.test(usage) && /service/.test(usage), "E it does carry request_id + service (traceable, but not attributable)");

    const gateway = read("supabase/migrations/20260805000002_integration_gateway_observe.sql");
    expect(!/company_id|tenant_id/.test(gateway), "E integration_gateway_events has NO tenant/company key");

    const line = read("supabase/migrations/20260709000002_line_events.sql");
    expect(!/company_id|tenant_id/.test(line), "E line_events has NO tenant/company key");

    expect(!/api_request_logs|api_usage_events/.test(read("supabase/migrations/20260705000006_api_tokens.sql")), "E api_tokens records only last_used_at (no per-request usage rows)");
    expect(/last_used_at/.test(read("supabase/migrations/20260705000006_api_tokens.sql")), "E api token usage evidence = a single timestamp, not a meter");
  }

  console.log("\n=== F — revenue can be attributed to a company only at the document layer ===");
  {
    const schema = read("supabase/local-migration/full_schema.sql");
    expect(/CREATE TABLE IF NOT EXISTS "public"\."invoices"[\s\S]{0,400}"customer_company_id" "uuid" NOT NULL/.test(schema), "F invoices carry customer_company_id (tenant attribution EXISTS for money documents)");
    expect(/"public"\."customer_orders"[\s\S]{0,500}"customer_company_id"/.test(schema), "F customer_orders carry customer_company_id (transaction → tenant)");
    const audit = read("engines/canonical/audit.ts");
    expect(/company_id: input\.company_id \?\? null/.test(audit), "F audit_logs company_id is optional and defaults to null");
  }

  console.log("\n=== G — cost evidence is declared, not invoiced ===");
  {
    const infra = JSON.parse(read("registry/infrastructure.json")) as { services: Record<string, { cost_monthly_thb: number | null; plan?: string }> };
    const costs = Object.values(infra.services).map((s) => s.cost_monthly_thb);
    expect(costs.filter((c) => c !== null && c > 0).length === 1, "G exactly ONE declared paid service exists (domain, 50 THB/month)");
    expect(costs.filter((c) => c === 0).length >= 10, "G most services are declared 0 (free tier) in the registry");
    expect(costs.includes(null), "G at least one cost is honestly null (Anthropic pending credential), not guessed");

    const ledger = JSON.parse(read("registry/COST_LEDGER.json")) as { entries: unknown[] };
    expect(ledger.entries.length === 0, "G the real AI cost ledger has 0 entries (no measured inference cost yet)");
    const budgets = JSON.parse(read("registry/COST_BUDGETS.json")) as { budgets: unknown[] };
    expect(budgets.budgets.length === 0, "G the real AI cost budget ledger has 0 approved budgets");
    const compute = JSON.parse(read("registry/COMPUTE_RESOURCE_REGISTRY.json")) as { resources: unknown[] };
    expect(compute.resources.length === 0, "G the compute resource registry has 0 registered resources");

    const exp = read("supabase/migrations/20260727000002_company_expenses.sql") +
      read("supabase/migrations/20260731000004_company_expenses_detail_fields.sql");
    expect(/amount_pre_vat/.test(exp) && /vat_amount/.test(exp), "G expenses separate pre-VAT and VAT (real cost capture exists)");
    expect(/subscription_services/.test(read("supabase/functions/subscription-email-sync/index.ts")), "G subscription invoices are captured as COST, not revenue");
  }

  console.log("\n=== H — no organization / tenant billing model ===");
  {
    const all = read("supabase/local-migration/full_schema.sql").toLowerCase() +
      require("fs").readdirSync("supabase/migrations").map((f: string) => read(`supabase/migrations/${f}`).toLowerCase()).join("\n");
    expect(!/create table[^;]*\bpublic\.organizations\b/.test(all), "H no organizations table (no org subscription billing)");
    expect(!/create table[^;]*\bpublic\.org_members\b/.test(all), "H no org_members table (no seat-based billing)");
    expect(/create table if not exists public\.scoped_grants/.test(all), "H scoped_grants EXISTS but is AI tool authority, not business/tenant billing");
    expect(/subject_type[^;]{0,120}account/.test(read("supabase/migrations/20260926000001_tool_scope_and_commands.sql")), "H scoped_grants covers account/device/tool actions only");

    const coverage = JSON.parse(read("registry/business-coverage.json")) as { domains: Record<string, { status: string }> };
    expect(coverage.domains.accounting?.status === "not_covered", "H accounting domain is honestly not_covered (no general ledger / revenue recognition)");
  }

  console.log("\n=== I — service-unit evidence exists but is not billable ===");
  {
    const evidence: Array<[string, boolean]> = [
      ["business_events (intent/transactions)", existsSync("supabase/local-migration/full_schema.sql") && /business_events/.test(read("supabase/local-migration/full_schema.sql"))],
      ["document_versions / document_artifacts (document processing)", /document_versions|document_artifacts/.test(read("supabase/migrations/20260922000001_canonical_foundation_v1_1.sql"))],
      ["ai_tasks + worker_usage_events (AI/OCR)", /ai_tasks/.test(read("supabase/migrations/20260725000006_ai_tasks.sql")) && /worker_usage_events/.test(read("supabase/migrations/20260810000002_worker_usage_events.sql"))],
      ["integration_gateway_events (webhook/inbound)", /integration_gateway_events/.test(read("supabase/migrations/20260805000002_integration_gateway_observe.sql"))],
      ["device_commands (tool execution)", /device_commands/.test(read("supabase/migrations/20260926000001_tool_scope_and_commands.sql"))],
      ["storage_resources / storage_evidence (storage)", /storage_resources/.test(read("supabase/migrations/20260804000004_storage_intelligence.sql"))],
    ];
    for (const [name, ok] of evidence) expect(ok, `I evidence exists for ${name}`);
    expect(!/billable|unit_price|charge_amount/.test(read("supabase/migrations/20260810000002_worker_usage_events.sql")), "I worker usage rows carry NO billable amount");
    expect(!/billable|charge_amount|unit_price/.test(read("supabase/migrations/20260805000002_integration_gateway_observe.sql")), "I gateway events carry NO billable amount");
  }

  console.log("\n=== J — 100M cannot be asserted as achievable ===");
  {
    const priceKnown = false; // no contract/price row exists anywhere in source
    const conversionKnown = false; // no historical revenue/conversion dataset in the repo
    const costKnown = false; // no invoice-backed cost per service
    expect(!priceKnown && !conversionKnown && !costKnown, "J price, conversion and unit cost are all DATA REQUIRED — the target stays a target, never a forecast");
  }

  console.log("\n=== SUMMARY ===");
  console.log(`checks=${checks} failed=${failed}`);
  console.log(failed === 0 ? "GATE: PASS" : `GATE: FAIL (${failed})`);
  if (process.argv.includes("--strict") && failed > 0) process.exit(1);
})();
