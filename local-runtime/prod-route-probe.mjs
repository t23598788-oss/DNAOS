#!/usr/bin/env node
/**
 * READ-ONLY route inventory probe (no writes, no deploy, no DB change).
 *
 *  - OLD inventory  = git HEAD (last code deployed to Railway production)
 *  - LIVE probe     = HTTP GET against the running Railway services
 *  - CLASSIFICATION = developer-control vs business surface (keyword rules)
 *
 * Usage: node local-runtime/prod-route-probe.mjs <baseUrl> [<label>]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const BASE = process.argv[2];
const LABEL = process.argv[3] || "prod";
if (!BASE) {
  console.error("usage: node local-runtime/prod-route-probe.mjs <baseUrl> [label]");
  process.exit(2);
}

const DEV_KEYWORDS = [
  "/admin/ide",
  "/admin/api-explorer",
  "/admin/engine-explorer",
  "/admin/dev-loop",
  "/admin/infrastructure",
  "/admin/schema-audit",
  "/admin/traces",
  "/admin/reader",
  "/admin/dbd",
  "/admin/dna",
  "/admin/deploy",
  "/admin/ui-gallery",
  "/admin/workspace",
  "/admin/system-config",
  "/admin/backup",
  "/admin/capability-boxes",
  "/admin/system-reality",
  "/admin/provider-settings",
  "/admin/domains",
  "/admin/screen-vision",
  "/admin/storage-intelligence",
  "/admin/pulse",
  "/admin/links",
  "/developer",
  "/playground",
  "/examples",
  "/workspace-preview",
  "/business-workspace-template",
  "/api/admin/ide",
  "/api/admin/dev-loop",
  "/api/admin/infrastructure",
  "/api/admin/schema-audit",
  "/api/admin/workspace/database",
  "/api/admin/backup",
  "/api/admin/capability-boxes",
  "/api/admin/system-reality",
  "/api/admin/provider-settings",
  "/api/admin/domains",
  "/api/admin/screen-vision",
  "/api/admin/storage-intelligence",
  "/api/admin/pulse",
  "/api/admin/links",
  "/api/dbd",
  "/api/reader",
  "/api/traces",
  "/api/gateway/observe/github",
  "/api/gateway/observe/railway",
  "/api/gateway/observe/vercel",
  "/api/gateway/observe/meta",
  "/api/gateway/proposals",
  "/api/governance",
  "/api/self-description",
  "/api/cron/supabase-project-status",
  "/api/internal/openclaw",
  "/api/manual-doc",
  "/api/explain",
  "/api/routes",
  "/api/v1/",
  "/api/workspace/embed-check",
];

const devRe = new RegExp(DEV_KEYWORDS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"));

const raw = readFileSync("/tmp/old_src_routes.txt", "utf8").trim().split("\n");
const routes = raw
  .map((p) => {
    const isApi = p.endsWith("/route.ts") || p.endsWith("/route.tsx");
    let url = p
      .replace(/^app/, "")
      .replace(/\/(page|route)\.(tsx|ts)$/, "")
      .replace(/\[\.\.\.[^\]]+\]/g, "*")
      .replace(/\[([^\]]+)\]/g, ":param");
    return { file: p, url: url || "/", isApi };
  })
  .filter((r) => !r.url.includes("*") && !r.url.includes(":param"));

const devRoutes = routes.filter((r) => devRe.test(r.url));
const bizRoutes = routes.filter((r) => !devRe.test(r.url));

async function probe(url) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    const res = await fetch(`${BASE}${url}`, {
      method: "GET",
      redirect: "manual",
      signal: ctl.signal,
      headers: { "user-agent": "dna-os-cutover-audit/1.0 (read-only)" },
    });
    clearTimeout(t);
    await res.body?.cancel().catch(() => {});
    return res.status;
  } catch (err) {
    return `ERR:${String(err?.message || err).slice(0, 60)}`;
  }
}

const results = [];
const CONC = 6;
let idx = 0;
async function worker() {
  while (idx < devRoutes.length) {
    const r = devRoutes[idx++];
    const status = await probe(r.url);
    results.push({ url: r.url, status, kind: r.isApi ? "api" : "page", file: r.file });
  }
}
await Promise.all(Array.from({ length: CONC }, worker));

const present = results.filter((r) => typeof r.status === "number" && r.status !== 404);
const missing = results.filter((r) => r.status === 404);
const other = results.filter((r) => typeof r.status !== "number" || (r.status !== 404 && r.status !== 401 && r.status !== 307 && r.status !== 405));

const out = {
  label: LABEL,
  base: BASE,
  probed_at: new Date().toISOString(),
  old_source_route_files: routes.length,
  old_business_candidate_count: bizRoutes.length,
  dev_candidate_count: devRoutes.length,
  dev_present_count: present.length,
  dev_absent_count: missing.length,
  present,
  absent: missing,
  other,
};
const outPath = `/tmp/prod_probe_${LABEL}.json`;
writeFileSync(outPath, JSON.stringify(out, null, 2));

console.log(`=== ${LABEL} :: ${BASE} ===`);
console.log(`old source route files: ${routes.length} (business-candidate ${bizRoutes.length}, dev-candidate ${devRoutes.length})`);
console.log(`DEV ROUTES PRESENT in ${LABEL}: ${present.length} / ${devRoutes.length}`);
for (const p of present.sort((a, b) => a.url.localeCompare(b.url))) {
  console.log(`  PRESENT ${p.status}  ${p.kind.padEnd(4)} ${p.url}`);
}
console.log(`DEV ROUTES ABSENT (404): ${missing.length}`);
if (other.length) {
  console.log(`OTHER STATUSES: ${other.length}`);
  for (const o of other) console.log(`  ${o.status}  ${o.url}`);
}
console.log(`evidence: ${outPath}`);
