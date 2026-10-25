/**
 * READ-ONLY production census (WAVE 4 follow-up, 2026-10-25).
 *
 * Purpose: fill the "DATA REQUIRED" cells in the WAVE 4 revenue audit with REAL
 * row counts / sums from the linked Supabase project.
 *
 * Safety contract (enforced below, not just documented):
 *   · HTTP GET only — there is no insert/update/delete/rpc code path here.
 *   · The service-role key is read from the Supabase CLI at runtime and is NEVER
 *     printed, logged, or written to the output file.
 *   · Output contains aggregate counts/sums only — no emails, names, phones,
 *     LINE ids, company names, tokens, or document contents.
 *
 * Usage:
 *   node scripts/revenue-production-readonly-census.mjs [--json out.json]
 * Requires: `npx supabase` authenticated + project linked (already true here).
 */
import { execFileSync } from "child_process";
import { writeFileSync } from "fs";
import { readFileSync } from "fs";

const PROJECT_REF = "xeytcavxejhyzxwevgto";

function serviceKey() {
  const raw = execFileSync(
    "npx",
    ["supabase", "projects", "api-keys", "--project-ref", PROJECT_REF, "--output", "json"],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  const keys = JSON.parse(raw);
  const row = keys.find((k) => String(k.description ?? "").toLowerCase().includes("service_role"));
  if (!row?.api_key) throw new Error("service_role key not returned by CLI");
  return row.api_key; // never logged
}

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);
const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, "");
const KEY = serviceKey();
const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const problems = [];
const out = { generated_at: new Date().toISOString(), project_ref: PROJECT_REF, tables: {}, aggregates: {}, problems };

async function count(table, query = "") {
  const url = `${URL_BASE}/rest/v1/${table}?select=*&limit=1${query ? `&${query}` : ""}`;
  const res = await fetch(url, { method: "HEAD", headers: { ...HEADERS, Prefer: "count=exact", Range: "0-0" } });
  if (!res.ok) {
    problems.push(`${table}${query ? `?${query}` : ""} → HTTP ${res.status}`);
    return null;
  }
  const cr = res.headers.get("content-range") ?? "";
  const total = cr.includes("/") ? Number(cr.split("/")[1]) : null;
  return Number.isFinite(total) ? total : null;
}

async function rows(table, select, query = "", max = 50000) {
  const collected = [];
  let from = 0;
  const page = 1000;
  while (from < max) {
    const url = `${URL_BASE}/rest/v1/${table}?select=${encodeURIComponent(select)}${query ? `&${query}` : ""}`;
    const res = await fetch(url, {
      headers: { ...HEADERS, Range: `${from}-${from + page - 1}`, "Range-Unit": "items" },
    });
    if (!res.ok) {
      problems.push(`${table} rows → HTTP ${res.status}`);
      break;
    }
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    collected.push(...batch);
    if (batch.length < page) break;
    from += page;
  }
  return collected;
}

const sum = (list, pick) => list.reduce((s, r) => s + Number(pick(r) ?? 0), 0);
const r2 = (n) => Math.round(n * 100) / 100;
const month = (v) => (typeof v === "string" && v.length >= 7 ? v.slice(0, 7) : null);
const groupCount = (list, pick) => {
  const m = {};
  for (const r of list) {
    const k = String(pick(r) ?? "null");
    m[k] = (m[k] ?? 0) + 1;
  }
  return m;
};

const TABLES = [
  "profiles", "companies", "connect_external_identities", "company_line_links",
  "customer_orders", "projects", "customer_sites", "invoices", "invoice_items",
  "standalone_documents", "document_versions", "document_artifacts",
  "business_events", "jobs", "transactions", "debt_events",
  "receipt_documents", "payment_allocations", "document_canonical",
  "company_expenses", "partner_payable_requests", "subscription_services", "supabase_billing_events",
  "line_events", "integration_gateway_events", "worker_usage_events", "ai_tasks",
  "api_tokens", "pit_profiles", "pit_materials", "material_types",
  "vehicle_types", "equipment_assets", "resource_transactions", "match_queue",
  "storage_resources", "storage_evidence", "storage_scan_runs",
  "fee_contracts", "fee_charges", "revenue_recognitions",
];

console.log("=== READ-ONLY PRODUCTION CENSUS (aggregates only) ===");
for (const t of TABLES) {
  const c = await count(t);
  out.tables[t] = c;
  console.log(String(c ?? "BLOCKED/ABSENT").padStart(12), t);
}

// ── identity ───────────────────────────────────────────────────────────────
{
  const p = await rows("profiles", "role,created_at");
  out.aggregates.profiles = {
    total: p.length,
    by_role: groupCount(p, (r) => r.role),
    first_created: p.map((r) => r.created_at).filter(Boolean).sort()[0] ?? null,
    last_created: p.map((r) => r.created_at).filter(Boolean).sort().slice(-1)[0] ?? null,
  };

  const ids = await rows("connect_external_identities", "role,trust_level,company_id,provider");
  out.aggregates.connect_identities = {
    total: ids.length,
    by_provider: groupCount(ids, (r) => r.provider),
    by_role: groupCount(ids, (r) => r.role),
    by_trust: groupCount(ids, (r) => r.trust_level),
    distinct_companies: new Set(ids.map((r) => r.company_id).filter(Boolean)).size,
  };

  const comps = await rows("companies", "type,status,is_individual");
  out.aggregates.companies = {
    total: comps.length,
    by_type: groupCount(comps, (r) => r.type),
    by_status: groupCount(comps, (r) => r.status),
    individual: comps.filter((r) => r.is_individual === true).length,
  };
}

// ── transactions / GMV / cash ──────────────────────────────────────────────
{
  const orders = await rows("customer_orders", "created_at,customer_company_id,status");
  const companies = new Set();
  const months = {};
  for (const o of orders) {
    if (o.customer_company_id) companies.add(o.customer_company_id);
    const m = month(o.created_at);
    if (m) months[m] = (months[m] ?? 0) + 1;
  }
  out.aggregates.customer_orders = {
    total: orders.length,
    distinct_customers: companies.size,
    by_status: groupCount(orders, (r) => r.status),
    by_month: months,
    first: orders.map((o) => o.created_at).filter(Boolean).sort()[0] ?? null,
    last: orders.map((o) => o.created_at).filter(Boolean).sort().slice(-1)[0] ?? null,
  };

  const inv = await rows("invoices", "invoice_date,customer_company_id,invoice_status,total_amount,gross_amount,paid_amount");
  const invCompanies = new Set(inv.map((i) => i.customer_company_id).filter(Boolean));
  const gmv = sum(inv, (i) => i.total_amount ?? i.gross_amount);
  const paid = sum(inv, (i) => i.paid_amount);
  const invMonths = {};
  const invByCompanyMonth = {};
  for (const i of inv) {
    const m = month(i.invoice_date);
    if (m) invMonths[m] = r2((invMonths[m] ?? 0) + Number(i.total_amount ?? i.gross_amount ?? 0));
    if (i.customer_company_id && m) {
      invByCompanyMonth[i.customer_company_id] = invByCompanyMonth[i.customer_company_id] ?? new Set();
      invByCompanyMonth[i.customer_company_id].add(m);
    }
  }
  out.aggregates.invoices = {
    total: inv.length,
    distinct_customers: invCompanies.size,
    gmv_total: r2(gmv),
    paid_amount_column_total: r2(paid),
    by_status: groupCount(inv, (i) => i.invoice_status),
    gmv_by_month: invMonths,
    customers_with_multiple_months: Object.values(invByCompanyMonth).filter((s) => s.size >= 2).length,
    first: inv.map((i) => i.invoice_date).filter(Boolean).sort()[0] ?? null,
    last: inv.map((i) => i.invoice_date).filter(Boolean).sort().slice(-1)[0] ?? null,
  };

  const alloc = await rows("payment_allocations", "amount,allocated_at,allocation_kind,invoice_id,receipt_document_id,standalone_document_id,debt_event_id");
  const allocMonth = {};
  for (const a of alloc) {
    const m = month(a.allocated_at);
    if (m) allocMonth[m] = r2((allocMonth[m] ?? 0) + Number(a.amount ?? 0));
  }
  out.aggregates.payment_allocations = {
    total: alloc.length,
    amount_total: r2(sum(alloc, (a) => a.amount)),
    by_kind: groupCount(alloc, (a) => a.allocation_kind),
    by_month: allocMonth,
    distinct_receipts: new Set(alloc.map((a) => a.receipt_document_id).filter(Boolean)).size,
    targets: {
      invoice: alloc.filter((a) => a.invoice_id).length,
      standalone: alloc.filter((a) => a.standalone_document_id).length,
      debt_event: alloc.filter((a) => a.debt_event_id).length,
    },
  };

  const receipts = await rows("receipt_documents", "document_type,status,amount,document_date");
  out.aggregates.receipt_documents = {
    total: receipts.length,
    amount_total: r2(sum(receipts, (r) => r.amount)),
    by_type: groupCount(receipts, (r) => r.document_type),
    by_status: groupCount(receipts, (r) => r.status),
  };

  const events = await rows("business_events", "event_type,status,created_at");
  out.aggregates.business_events = {
    total: events.length,
    by_type: groupCount(events, (e) => e.event_type),
    by_status: groupCount(events, (e) => e.status),
    by_month: groupCount(events, (e) => month(e.created_at)),
  };
}

// ── cost evidence ──────────────────────────────────────────────────────────
{
  const exp = await rows("company_expenses", "document_type,amount,amount_pre_vat,vat_amount,expense_date,created_at");
  out.aggregates.company_expenses = {
    total: exp.length,
    amount_total: r2(sum(exp, (e) => e.amount)),
    pre_vat_total: r2(sum(exp, (e) => e.amount_pre_vat)),
    vat_total: r2(sum(exp, (e) => e.vat_amount)),
    by_type: groupCount(exp, (e) => e.document_type),
    by_month: groupCount(exp, (e) => month(e.expense_date ?? e.created_at)),
  };

  const subs = await rows("subscription_services", "provider,amount,currency,billing_cycle,status");
  out.aggregates.subscription_services = {
    total: subs.length,
    by_provider: groupCount(subs, (s) => s.provider),
    by_currency: groupCount(subs, (s) => s.currency),
    by_cycle: groupCount(subs, (s) => s.billing_cycle),
    amount_by_currency: Object.fromEntries(
      Object.keys(groupCount(subs, (s) => s.currency)).map((c) => [c, r2(sum(subs.filter((s) => (s.currency ?? "null") === c), (s) => s.amount))]),
    ),
  };

  const supa = await rows("supabase_billing_events", "amount_usd,amount_thb,status,email_received_at");
  out.aggregates.supabase_billing_events = {
    total: supa.length,
    usd_total: r2(sum(supa, (s) => s.amount_usd)),
    thb_total: r2(sum(supa, (s) => s.amount_thb)),
    by_status: groupCount(supa, (s) => s.status),
  };

  const payable = await rows("partner_payable_requests", "status,amount,created_at");
  out.aggregates.partner_payables = {
    total: payable.length,
    amount_total: r2(sum(payable, (p) => p.amount)),
    by_status: groupCount(payable, (p) => p.status),
  };

  const rt = await rows("resource_transactions", "resource_type,quantity,unit_cost,total_cost,total_price");
  out.aggregates.resource_transactions = {
    total: rt.length,
    cost_total: r2(sum(rt, (r) => r.total_cost)),
    price_total: r2(sum(rt, (r) => r.total_price)),
    by_resource: groupCount(rt, (r) => r.resource_type),
  };
}

// ── usage evidence ─────────────────────────────────────────────────────────
{
  const usage = await rows("worker_usage_events", "provider,service,model,input_tokens,output_tokens,total_tokens,token_source,latency_ms,status,created_at");
  out.aggregates.worker_usage_events = {
    total: usage.length,
    input_tokens: sum(usage, (u) => u.input_tokens),
    output_tokens: sum(usage, (u) => u.output_tokens),
    total_tokens: sum(usage, (u) => u.total_tokens),
    token_source: groupCount(usage, (u) => u.token_source),
    by_status: groupCount(usage, (u) => u.status),
    by_provider: groupCount(usage, (u) => u.provider),
    by_service: groupCount(usage, (u) => u.service),
    latency_ms_total: sum(usage, (u) => u.latency_ms),
    first: usage.map((u) => u.created_at).filter(Boolean).sort()[0] ?? null,
    last: usage.map((u) => u.created_at).filter(Boolean).sort().slice(-1)[0] ?? null,
  };

  const gw = await rows("integration_gateway_events", "provider,capability,channel,occurred_at");
  out.aggregates.integration_gateway_events = {
    total: gw.length,
    by_provider: groupCount(gw, (g) => g.provider),
    by_capability: groupCount(gw, (g) => g.capability),
    first: gw.map((g) => g.occurred_at).filter(Boolean).sort()[0] ?? null,
    last: gw.map((g) => g.occurred_at).filter(Boolean).sort().slice(-1)[0] ?? null,
  };

  const line = await rows("line_events", "raw_type,status,created_at,direction");
  out.aggregates.line_events = {
    total: line.length,
    by_type: groupCount(line, (l) => l.raw_type),
    by_status: groupCount(line, (l) => l.status),
    by_direction: groupCount(line, (l) => l.direction),
    by_month: groupCount(line, (l) => month(l.created_at)),
  };

  const ai = await rows("ai_tasks", "kind,status,created_at,processed_at");
  out.aggregates.ai_tasks = {
    total: ai.length,
    by_kind: groupCount(ai, (a) => a.kind),
    by_status: groupCount(ai, (a) => a.status),
    first: ai.map((a) => a.created_at).filter(Boolean).sort()[0] ?? null,
    last: ai.map((a) => a.created_at).filter(Boolean).sort().slice(-1)[0] ?? null,
  };

  const tokens = await rows("api_tokens", "scopes,last_used_at,revoked_at,created_at");
  out.aggregates.api_tokens = {
    total: tokens.length,
    revoked: tokens.filter((t) => t.revoked_at).length,
    used: tokens.filter((t) => t.last_used_at).length,
    by_scope: groupCount(tokens, (t) => JSON.stringify(t.scopes)),
  };

  const docs = await rows("document_versions", "status,created_at");
  out.aggregates.document_versions = { total: docs.length, by_status: groupCount(docs, (d) => d.status) };

  const artifacts = await rows("document_artifacts", "kind,size_bytes,created_at");
  out.aggregates.document_artifacts = {
    total: artifacts.length,
    by_kind: groupCount(artifacts, (a) => a.kind),
    size_bytes_total: sum(artifacts, (a) => a.size_bytes),
  };

  const storage = await rows("storage_resources", "size_bytes");
  out.aggregates.storage_resources = { total: storage.length, size_bytes_total: sum(storage, (s) => s.size_bytes) };

  const pits = await rows("pit_profiles", "user_id,is_open");
  out.aggregates.pit_profiles = {
    total: pits.length,
    with_owner_profile: pits.filter((p) => p.user_id).length,
    without_owner_profile: pits.filter((p) => !p.user_id).length,
    open: pits.filter((p) => p.is_open === true).length,
  };

  const mats = await rows("pit_materials", "price,material_type_id");
  out.aggregates.pit_materials = {
    total: mats.length,
    priced: mats.filter((m) => Number(m.price) > 0).length,
    distinct_materials: new Set(mats.map((m) => m.material_type_id)).size,
  };

  out.aggregates.resource_counts = {
    material_types: out.tables.material_types,
    vehicle_types: out.tables.vehicle_types,
    equipment_assets: out.tables.equipment_assets,
    customer_sites: out.tables.customer_sites,
    projects: out.tables.projects,
    match_queue: out.tables.match_queue,
  };
}

// ── live money baseline (GMV ≠ platform revenue) ───────────────────────────
{
  const inv = await rows("invoices", "invoice_status,invoice_date,customer_company_id,total_amount,gross_amount,customer_order_id");
  const live = inv.filter((i) => !["VOID", "void"].includes(String(i.invoice_status)));
  const byMonth = {};
  for (const i of live) {
    const m = month(i.invoice_date);
    if (m) byMonth[m] = r2((byMonth[m] ?? 0) + Number(i.total_amount ?? i.gross_amount ?? 0));
  }
  out.aggregates.invoices_live = {
    total: live.length,
    gmv_total: r2(sum(live, (i) => i.total_amount ?? i.gross_amount)),
    by_month: byMonth,
    distinct_customers: new Set(live.map((i) => i.customer_company_id).filter(Boolean)).size,
    linked_to_order: live.filter((i) => i.customer_order_id).length,
    void_total: inv.length - live.length,
  };

  const sd = await rows("standalone_documents", "status,voided_at,document_date,customer_company_id,total_amount,gross_amount");
  const liveSd = sd.filter((d) => !d.voided_at && !["VOID", "void", "voided"].includes(String(d.status)));
  out.aggregates.standalone_documents_live = {
    total: liveSd.length,
    gmv_total: r2(sum(liveSd, (d) => d.total_amount ?? d.gross_amount)),
    distinct_customers: new Set(liveSd.map((d) => d.customer_company_id).filter(Boolean)).size,
  };

  const dc = await rows("document_canonical", "document_kind,document_status,gross_amount,total_amount,issue_date");
  const dcLive = dc.filter((d) => !["VOID", "void"].includes(String(d.document_status)) && d.document_kind !== "quotation");
  out.aggregates.document_canonical_live = {
    total: dcLive.length,
    gross_total: r2(sum(dcLive, (d) => d.gross_amount ?? d.total_amount)),
    by_kind: groupCount(dcLive, (d) => d.document_kind),
  };

  const debt = await rows("debt_events", "id,customer_company_id,event_type,amount,occurred_at");
  out.aggregates.debt_events = {
    total: debt.length,
    amount_total: r2(sum(debt, (d) => d.amount)),
    by_type: groupCount(debt, (d) => d.event_type),
    distinct_companies: new Set(debt.map((d) => d.customer_company_id).filter(Boolean)).size,
  };

  const snaps = await rows("debt_snapshots", "customer_company_id,total_outstanding,overdue_amount,collection_state");
  out.aggregates.debt_snapshots = {
    total: snaps.length,
    outstanding_total: r2(sum(snaps, (s) => s.total_outstanding)),
    overdue_total: r2(sum(snaps, (s) => s.overdue_amount)),
    by_state: groupCount(snaps, (s) => s.collection_state),
  };

  const alloc = await rows("payment_allocations", "amount,debt_event_id,invoice_id,standalone_document_id,allocated_at");
  const debtCompany = new Map(debt.map((d) => [d.id, d.customer_company_id]));
  out.aggregates.payment_allocations.targets = {
    invoice: alloc.filter((a) => a.invoice_id).length,
    standalone: alloc.filter((a) => a.standalone_document_id).length,
    debt_event: alloc.filter((a) => a.debt_event_id).length,
  };
  out.aggregates.payment_allocations.paying_companies = new Set(
    alloc.map((a) => (a.debt_event_id ? debtCompany.get(a.debt_event_id) : null)).filter(Boolean),
  ).size;

  // active / transacting / retained (union of real activity months per company)
  const orders = await rows("customer_orders", "customer_company_id,created_at");
  const activity = new Map();
  const add = (company, date) => {
    if (!company) return;
    const m = month(date);
    if (!m) return;
    if (!activity.has(company)) activity.set(company, new Set());
    activity.get(company).add(m);
  };
  for (const o of orders) add(o.customer_company_id, o.created_at);
  for (const i of live) add(i.customer_company_id, i.invoice_date);
  for (const d of debt) add(d.customer_company_id, d.occurred_at);
  out.aggregates.customer_lifecycle = {
    active_companies: activity.size,
    transacting_companies: new Set([
      ...orders.map((o) => o.customer_company_id),
      ...live.map((i) => i.customer_company_id),
    ].filter(Boolean)).size,
    retained_companies_2plus_months: [...activity.values()].filter((s) => s.size >= 2).length,
    active_by_month: (() => {
      const m = {};
      for (const months of activity.values()) for (const k of months) m[k] = (m[k] ?? 0) + 1;
      return m;
    })(),
  };
}

// ── subscription invoices + expenses by month (captured, not normalized) ────
{
  const subs = await rows("subscription_services", "created_at,provider,amount,currency,billing_cycle,status");
  const byMonth = {};
  for (const s of subs) {
    const k = month(s.created_at) ?? "unknown";
    byMonth[k] = byMonth[k] ?? { rows: 0, THB: 0, USD: 0 };
    byMonth[k].rows += 1;
    const c = String(s.currency ?? "");
    if (c === "THB" || c === "USD") byMonth[k][c] = r2(byMonth[k][c] + Number(s.amount ?? 0));
  }
  out.aggregates.subscription_by_month = byMonth;

  const exp = await rows("company_expenses", "document_type,amount,amount_pre_vat,vat_amount,expense_date,created_at");
  const eM = {};
  for (const e of exp) {
    const k = month(e.expense_date ?? e.created_at) ?? "unknown";
    eM[k] = eM[k] ?? { rows: 0, amount: 0, pre_vat: 0, vat: 0 };
    eM[k].rows += 1;
    eM[k].amount = r2(eM[k].amount + Number(e.amount ?? 0));
    eM[k].pre_vat = r2(eM[k].pre_vat + Number(e.amount_pre_vat ?? 0));
    eM[k].vat = r2(eM[k].vat + Number(e.vat_amount ?? 0));
  }
  out.aggregates.expenses_by_month = eM;
}

const jsonFlag = process.argv.indexOf("--json");
const target = jsonFlag >= 0 ? process.argv[jsonFlag + 1] : null;
if (target) {
  writeFileSync(target, JSON.stringify(out, null, 2));
  console.log(`\nwritten: ${target} (aggregates only, no credentials/PII)`);
}

console.log("\n=== KEY AGGREGATES ===");
for (const k of [
  "profiles", "connect_identities", "companies", "customer_orders", "invoices",
  "payment_allocations", "receipt_documents", "company_expenses",
  "subscription_services", "supabase_billing_events", "worker_usage_events",
  "integration_gateway_events", "line_events", "ai_tasks", "api_tokens",
  "pit_profiles", "pit_materials",
]) {
  console.log(k, JSON.stringify(out.aggregates[k]));
}
console.log("problems:", problems.length ? problems : "none");
