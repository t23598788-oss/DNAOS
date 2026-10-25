/**
 * READ-ONLY probe #2 — operating cost & per-account usage evidence (2026-10-25)
 *
 * Contract (same as revenue-production-readonly-census.mjs):
 *   · HTTP GET/HEAD only. No insert/update/delete/rpc.
 *   · service-role key read from Supabase CLI in memory; never printed/stored.
 *   · Output = schema listing, counts, sums, masked ids. No emails, names,
 *     phones, LINE ids, company names, tokens, or document contents.
 *
 * Usage: node scripts/operating-cost-readonly-probe.mjs [--json out.json]
 */
import { execFileSync } from "child_process";
import { writeFileSync, readFileSync } from "fs";
import { createHash } from "crypto";

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
  return row.api_key;
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
const BASE = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, "");
const KEY = serviceKey();
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const out = { generated_at: new Date().toISOString(), project_ref: PROJECT_REF, schema: {}, accounts: {}, attribution: {}, storage: {}, problems: [] };
const mask = (id) => (id ? `acct_${createHash("sha256").update(String(id)).digest("hex").slice(0, 8)}` : null);
const r2 = (n) => Math.round(Number(n ?? 0) * 100) / 100;

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`, { headers: H });
  if (!res.ok) {
    out.problems.push(`${path} → HTTP ${res.status}`);
    return null;
  }
  return res.json().catch(() => null);
}

async function countWhere(table, query) {
  const url = `${BASE}/rest/v1/${table}?select=*&limit=1${query ? `&${query}` : ""}`;
  const res = await fetch(url, { method: "HEAD", headers: { ...H, Prefer: "count=exact", Range: "0-0" } });
  if (!res.ok) return null;
  const cr = res.headers.get("content-range") ?? "";
  const n = cr.includes("/") ? Number(cr.split("/")[1]) : null;
  return Number.isFinite(n) ? n : null;
}

async function rows(table, select, query = "", max = 20000) {
  const acc = [];
  let from = 0;
  while (from < max) {
    const url = `${BASE}/rest/v1/${table}?select=${encodeURIComponent(select)}${query ? `&${query}` : ""}`;
    const res = await fetch(url, { headers: { ...H, Range: `${from}-${from + 999}`, "Range-Unit": "items" } });
    if (!res.ok) {
      out.problems.push(`${table} rows → HTTP ${res.status}`);
      break;
    }
    const batch = await res.json();
    if (!Array.isArray(batch) || !batch.length) break;
    acc.push(...batch);
    if (batch.length < 1000) break;
    from += 1000;
  }
  return acc;
}

// ── 1. production schema (columns that can attribute an action to a human) ──
{
  const spec = await getJson("/rest/v1/");
  const defs = spec?.definitions ?? {};
  out.schema.table_count = Object.keys(defs).length;
  const interesting = /user|profile|owner|created_by|actor|submitted|uploaded|account|company_id|email/i;
  const attribution = {};
  for (const [table, def] of Object.entries(defs)) {
    const cols = Object.keys(def.properties ?? {});
    const hit = cols.filter((c) => interesting.test(c));
    if (hit.length) attribution[table] = hit;
  }
  out.schema.attribution_columns = attribution;
  out.schema.tables_without_attribution_count = Object.keys(defs).length - Object.keys(attribution).length;
  out.schema.table_names = Object.keys(defs);
}

// ── 2. the 3 production accounts (masked, no email) ────────────────────────
{
  const users = await getJson("/auth/v1/admin/users?per_page=200");
  const list = users?.users ?? [];
  out.accounts.total_auth_users = list.length;
  out.accounts.users = list.map((u) => ({
    account: mask(u.id),
    created_at: u.created_at ?? null,
    last_sign_in_at: u.last_sign_in_at ?? null,
    email_confirmed: Boolean(u.email_confirmed_at || u.confirmed_at),
    banned_until: u.banned_until ?? null,
    provider: (u.app_metadata?.provider ?? null),
    role_claim: u.role ?? null,
    has_email: Boolean(u.email),
    has_phone: Boolean(u.phone),
  }));

  const profiles = await rows("profiles", "id,role,created_at,updated_at");
  out.accounts.profiles = profiles.map((p) => ({
    account: mask(p.id),
    role: p.role,
    created_at: p.created_at,
    updated_at: p.updated_at,
  }));

  const ids = new Set(list.map((u) => u.id));
  const pids = new Set(profiles.map((p) => p.id));
  out.accounts.auth_without_profile = [...ids].filter((i) => !pids.has(i)).length;
  out.accounts.profile_without_auth = [...pids].filter((i) => !ids.has(i)).length;
}

// ── 3. per-account attribution counts (the heart of the audit) ─────────────
{
  const probes = [
    ["audit_logs", "actor_user_id"],
    ["api_tokens", "user_id"],
    ["documents", "created_by"],
    ["standalone_documents", "created_by"],
    ["business_events", "created_by"],
    ["ai_tasks", "created_by"],
    ["worker_usage_events", "user_id"],
    ["storage_resources", "owner_id"],
    ["company_expenses", "submitted_by_line_user_id"],
    ["line_events", "line_user_id"],
    ["connect_external_identities", "profile_id"],
  ];
  const cols = out.schema.attribution_columns ?? {};
  out.attribution.probe = {};
  for (const [table, col] of probes) {
    if (!cols[table] || !cols[table].includes(col)) {
      out.attribution.probe[`${table}.${col}`] = "COLUMN_NOT_IN_SCHEMA";
      continue;
    }
    const total = await countWhere(table, "");
    const withActor = await countWhere(table, `${col}=not.is.null`);
    out.attribution.probe[`${table}.${col}`] = { rows: total, with_actor: withActor, unattributed: total != null && withActor != null ? total - withActor : null };
  }
}

// ── 4. storage shape (metadata only, no file contents) ─────────────────────
{
  const buckets = await getJson("/storage/v1/bucket");
  out.storage.buckets = Array.isArray(buckets)
    ? buckets.map((b) => ({ name: b.name, public: b.public, file_size_limit: b.file_size_limit ?? null, created_at: b.created_at ?? null }))
    : "NOT_VERIFIED";
  const sr = await rows("storage_resources", "*", "", 500);
  if (sr.length) {
    const sample = sr[0];
    out.storage.storage_resources_columns = Object.keys(sample);
    const byBucket = {};
    for (const r of sr) {
      const k = String(r.bucket ?? r.bucket_name ?? r.location ?? "unknown");
      byBucket[k] = byBucket[k] ?? { rows: 0, bytes: 0 };
      byBucket[k].rows += 1;
      byBucket[k].bytes += Number(r.size_bytes ?? r.size ?? 0);
    }
    out.storage.storage_resources_by_group = byBucket;
    out.storage.storage_resources_rows_scanned = sr.length;
    out.storage.storage_resources_total_bytes = sr.reduce((s, r) => s + Number(r.size_bytes ?? r.size ?? 0), 0);
  }
  const objCount = await countWhere("storage_objects", "");
  out.storage.storage_objects_via_rest = objCount ?? "NOT_EXPOSED";
  out.storage.note = "size figures come from the storage_resources metadata table, not from the object store billing meter";
}

// ── 5. runtime activity windows that can be tied to cost ───────────────────
{
  const jobRows = await rows("jobs", "created_at,status");
  out.runtime = {
    jobs: {
      total: jobRows.length,
      by_status: jobRows.reduce((m, j) => ((m[j.status] = (m[j.status] ?? 0) + 1), m), {}),
      first: jobRows.map((j) => j.created_at).filter(Boolean).sort()[0] ?? null,
      last: jobRows.map((j) => j.created_at).filter(Boolean).sort().slice(-1)[0] ?? null,
    },
  };
  const usd = await rows("supabase_billing_events", "amount_usd,amount_thb,status,email_received_at");
  out.runtime.supabase_billing = {
    rows: usd.length,
    usd: r2(usd.reduce((s, u) => s + Number(u.amount_usd ?? 0), 0)),
    thb: r2(usd.reduce((s, u) => s + Number(u.amount_thb ?? 0), 0)),
    events: usd.map((u) => ({ status: u.status, at: u.email_received_at ?? null })),
  };
}

const flag = process.argv.indexOf("--json");
if (flag >= 0 && process.argv[flag + 1]) {
  writeFileSync(process.argv[flag + 1], JSON.stringify(out, null, 2));
  console.log(`written: ${process.argv[flag + 1]} (aggregates only)`);
}
console.log(JSON.stringify(out, null, 2).slice(0, 12000));
console.log("problems:", out.problems.length ? out.problems : "none");
