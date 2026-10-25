/**
 * READ-ONLY probe #3 — account attribution + cost normalization (2026-10-25)
 *
 * Same safety contract as the other two probes in this folder:
 *   · HTTP GET only (PostgREST + GoTrue admin read). No insert/update/delete/rpc.
 *   · service-role key read from the Supabase CLI in memory; never printed.
 *   · Aggregates and masked account hashes only — no emails, names, LINE ids,
 *     company names, tokens, or document contents.
 *
 * Usage: node scripts/account-cost-attribution-readonly-probe.mjs [--json out.json]
 */
import { execFileSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
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

const mask = (id) => (id ? `acct_${createHash("sha256").update(String(id)).digest("hex").slice(0, 8)}` : null);
const r2 = (n) => Math.round(Number(n ?? 0) * 100) / 100;
const month = (v) => (typeof v === "string" && v.length >= 7 ? v.slice(0, 7) : null);
const group = (arr, pick) => {
  const m = {};
  for (const r of arr) {
    const k = String(pick(r) ?? "null");
    m[k] = (m[k] ?? 0) + 1;
  }
  return m;
};

async function rows(table, select, query = "", max = 40000) {
  const acc = [];
  let from = 0;
  while (from < max) {
    const url = `${BASE}/rest/v1/${table}?select=${encodeURIComponent(select)}${query ? `&${query}` : ""}`;
    const res = await fetch(url, { headers: { ...H, Range: `${from}-${from + 999}`, "Range-Unit": "items" } });
    if (!res.ok) return { error: res.status };
    const batch = await res.json();
    if (!Array.isArray(batch) || !batch.length) break;
    acc.push(...batch);
    if (batch.length < 1000) break;
    from += 1000;
  }
  return acc;
}

const out = { generated_at: new Date().toISOString(), project_ref: PROJECT_REF };

// ── account → organisation ─────────────────────────────────────────────────
{
  const om = await rows("org_members", "user_id,organization_id,role");
  const im = await rows("identity_memberships", "account_id,role");
  out.memberships = {
    org_members: Array.isArray(om) ? om.map((o) => ({ account: mask(o.user_id), has_org: Boolean(o.organization_id), role: o.role })) : om,
    identity_memberships: Array.isArray(im) ? im.map((i) => ({ account: mask(i.account_id), role: i.role })) : im,
  };
}

// ── who is recorded as the creator of each artefact ────────────────────────
{
  const dv = await rows("document_versions", "created_by");
  const art = await rows("document_artifacts", "created_by,size_bytes");
  const jobs = await rows("jobs", "created_by,status");
  const ai = await rows("ai_tasks", "owner_user_id,line_user_id,kind,status,created_at");
  const be = await rows("business_events", "event_type,status,created_at");
  out.creation_attribution = {
    document_versions_by_actor: Array.isArray(dv) ? group(dv, (d) => mask(d.created_by)) : dv,
    document_artifacts_by_actor: Array.isArray(art) ? group(art, (a) => mask(a.created_by)) : art,
    jobs_by_actor: Array.isArray(jobs) ? group(jobs, (j) => mask(j.created_by)) : jobs,
    ai_tasks_by_owner: Array.isArray(ai) ? group(ai, (a) => mask(a.owner_user_id)) : ai,
    ai_tasks_line_identity_present: Array.isArray(ai) ? group(ai, (a) => (a.line_user_id ? "has_line_identity" : "none")) : ai,
    ai_tasks_by_month_kind_status: Array.isArray(ai)
      ? (() => {
          const m = {};
          for (const a of ai) {
            const k = `${month(a.created_at)}|${a.kind}|${a.status}`;
            m[k] = (m[k] ?? 0) + 1;
          }
          return m;
        })()
      : ai,
    business_events_last: Array.isArray(be) ? be.map((b) => b.created_at).filter(Boolean).sort().slice(-1)[0] ?? null : null,
  };
}

// ── audit coverage (the single attribution spine) ──────────────────────────
{
  const all = await rows("audit_logs", "actor_user_id,entity_type,action,created_at,company_id");
  if (Array.isArray(all)) {
    const attributed = all.filter((a) => a.actor_user_id);
    out.audit = {
      rows_sampled: all.length,
      with_actor: attributed.length,
      without_actor: all.length - attributed.length,
      coverage_pct: r2((attributed.length / all.length) * 100),
      actors: group(attributed, (a) => mask(a.actor_user_id)),
      attributed_actions: attributed.map((a) => ({ account: mask(a.actor_user_id), entity: a.entity_type, action: a.action, at: a.created_at, has_company: Boolean(a.company_id) })),
      action_distribution: Object.entries(group(all, (a) => `${a.entity_type}|${a.action}`))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15),
    };
  } else out.audit = all;
}

// ── invoice normalization (dedupe by provider+service+amount+currency+day) ──
{
  const subs = await rows("subscription_services", "provider,service_name,amount,currency,billing_cycle,status,created_at,next_billing_date");
  if (Array.isArray(subs)) {
    const nz = subs.filter((s) => Number(s.amount ?? 0) > 0);
    const seen = new Set();
    const byMonth = {};
    for (const s of nz) {
      const k = `${month(s.created_at)}|${s.provider}|${s.currency}`;
      const u = `${s.provider}|${s.service_name}|${s.amount}|${s.currency}|${String(s.created_at ?? "").slice(0, 10)}`;
      byMonth[k] = byMonth[k] ?? { raw_rows: 0, unique_invoices: 0, amount_raw: 0, amount_unique: 0 };
      const d = byMonth[k];
      d.raw_rows += 1;
      d.amount_raw = r2(d.amount_raw + Number(s.amount));
      if (!seen.has(u)) {
        seen.add(u);
        d.unique_invoices += 1;
        d.amount_unique = r2(d.amount_unique + Number(s.amount));
      }
    }
    out.invoices = {
      rows_total: subs.length,
      rows_with_amount: nz.length,
      unique_invoice_keys: seen.size,
      by_month_provider: byMonth,
      status_values: [...new Set(subs.map((s) => String(s.status ?? "null")))],
      next_billing_dates_present: nz.filter((s) => s.next_billing_date).length,
    };
  } else out.invoices = subs;
}

// ── worker telemetry completeness ──────────────────────────────────────────
{
  const wu = await rows("worker_usage_events", "provider,model,service,status,input_tokens,output_tokens,latency_ms,cpu_util_pct,ram_used_pct,gpu_util_pct,vram_used_pct,network_bytes_sent,disk_bytes_read,run_context,created_at");
  if (Array.isArray(wu)) {
    const filled = (k) => wu.filter((r) => r[k] != null).length;
    out.worker_usage = {
      rows: wu.length,
      models: group(wu, (w) => w.model),
      providers: group(wu, (w) => w.provider),
      run_context: group(wu, (w) => w.run_context),
      telemetry_filled: {
        cpu_util_pct: filled("cpu_util_pct"),
        ram_used_pct: filled("ram_used_pct"),
        gpu_util_pct: filled("gpu_util_pct"),
        vram_used_pct: filled("vram_used_pct"),
        network_bytes_sent: filled("network_bytes_sent"),
        disk_bytes_read: filled("disk_bytes_read"),
      },
      latency_ms_total: wu.reduce((s, w) => s + Number(w.latency_ms ?? 0), 0),
      tokens_total: wu.reduce((s, w) => s + Number(w.input_tokens ?? 0) + Number(w.output_tokens ?? 0), 0),
      first: wu.map((w) => w.created_at).filter(Boolean).sort()[0] ?? null,
      last: wu.map((w) => w.created_at).filter(Boolean).sort().slice(-1)[0] ?? null,
    };
  } else out.worker_usage = wu;
}

// ── storage: what the 193 GB actually is ───────────────────────────────────
{
  const sr = await rows("storage_resources", "path,size_bytes,state");
  const runs = await rows("storage_scan_runs", "machine_id,actor,roots_scanned,total_bytes,status,started_at");
  if (Array.isArray(sr)) {
    const buckets = {};
    for (const r of sr) {
      const p = String(r.path ?? "");
      const isLocal = p.startsWith("/Users") || p.startsWith("/root") || p.startsWith("/Volumes");
      const seg = p.split("/");
      const key = isLocal ? `LOCAL_DISK:${seg[1]}/${seg[2] ?? ""}/${seg[3] ?? ""}` : `OTHER:${seg.slice(0, 3).join("/")}`;
      buckets[key] = buckets[key] ?? { rows: 0, bytes: 0 };
      buckets[key].rows += 1;
      buckets[key].bytes += Number(r.size_bytes ?? 0);
    }
    out.storage = {
      storage_resources_rows: sr.length,
      storage_resources_bytes: sr.reduce((s, r) => s + Number(r.size_bytes ?? 0), 0),
      path_groups: buckets,
      note: "paths resolve to the development machine's filesystem, not to a Supabase bucket",
    };
  } else out.storage = sr;
  out.storage = out.storage ?? {};
  // actor can be an email in storage_scan_runs — mask it like an account id so
  // no address ever lands in an evidence file.
  const maskActor = (v) => (typeof v === "string" && v.includes("@") ? "owner-account" : v);
  out.storage.scan_runs = Array.isArray(runs)
    ? { total: runs.length, actors: group(runs, (r) => maskActor(r.actor)), machines: [...new Set(runs.map((r) => r.machine_id).filter(Boolean))].length }
    : runs;
}

const flag = process.argv.indexOf("--json");
if (flag >= 0 && process.argv[flag + 1]) {
  writeFileSync(process.argv[flag + 1], JSON.stringify(out, null, 2));
  console.log(`written: ${process.argv[flag + 1]}`);
}
console.log(JSON.stringify(out, null, 2).slice(0, 6000));
