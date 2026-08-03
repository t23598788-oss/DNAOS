/**
 * DNA OS — Infrastructure Dependency Graph Sync
 *
 * Owner directive (2026-08-04): "Do not guess. Only report relationships
 * that can be proven from runtime configuration or source code." — this
 * scans real source for the real env var each service is read through
 * (Deno.env.get / process.env), and writes back which real files reference
 * it. Extends registry/infrastructure.json (already the single source of
 * truth for services — Rule 103/111) with a `dependency_graph` field per
 * service. No new registry file, no fabricated relationships — a module
 * only appears here if grep can prove it references that service's env var.
 *
 * scheduled_jobs comes from a live `cron.job` query (real pg_cron state,
 * not guessed) — run `npm run sync-infra-deps -- --with-cron` to refresh
 * that part too (needs `supabase db query --linked`, so it's opt-in and
 * not part of the default fast path used by deploy-gate).
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { glob } from "glob";

const ROOT = join(__dirname, "..");
const INFRA_PATH = join(ROOT, "registry/infrastructure.json");

// The only hand-declared fact per service (same discipline as
// infrastructure.json's own existing `affected_workflows` field) — which
// real env var(s) gate that service's code path. Everything else below is
// computed by grepping for these, not guessed.
const SERVICE_ENV_VARS: Record<string, string[]> = {
  supabase: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY"],
  vercel: ["VERCEL_TOKEN"],
  anthropic: ["ANTHROPIC_API_KEY"],
  gemini: ["GEMINI_API_KEY"],
  line_messaging: ["LINE_CHANNEL_ACCESS_TOKEN", "LINE_CHANNEL_SECRET"],
  line_notify: ["LINE_CHANNEL_ACCESS_TOKEN"],
  // registry/infrastructure.json's "google_maps" entry is real but the code
  // it actually gates is a Longdo Map key, not a Google Maps key (found
  // live during this sync — flagged, not silently "fixed" by renaming the
  // registry entry without the owner's say-so).
  google_maps: ["LONGDO_MAP_API_KEY"],
  gmail: ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"],
  github: [],
  domain: [],
  node_runtime: [],
  deno_runtime: [],
};

type DependencyGraph = {
  modules: string[];
  api_routes: string[];
  edge_functions: string[];
  scheduled_jobs: Array<{ jobname: string; schedule: string; active: boolean }> | "not_refreshed";
};

function grepFilesReferencing(envVar: string): string[] {
  if (!envVar) return [];
  try {
    const out = execSync(
      `grep -rl "${envVar}" --include="*.ts" --include="*.tsx" . 2>/dev/null | grep -v node_modules | grep -v "^./scripts/sync-infrastructure-dependencies.ts"`,
      { cwd: ROOT, encoding: "utf-8" },
    );
    return out.split("\n").map((l) => l.replace(/^\.\//, "").trim()).filter(Boolean);
  } catch {
    return []; // grep exits 1 when no matches — not an error here
  }
}

function classify(files: string[]): { api_routes: string[]; edge_functions: string[]; modules: string[] } {
  const api_routes: string[] = [];
  const edge_functions: string[] = [];
  const modules: string[] = [];
  for (const f of files) {
    if (/^app\/api\/.*route\.ts$/.test(f)) api_routes.push(f);
    else if (/^supabase\/functions\/[^/]+\/index\.ts$/.test(f)) edge_functions.push(f.split("/")[2]);
    else modules.push(f);
  }
  return { api_routes, edge_functions: [...new Set(edge_functions)], modules };
}

async function getLiveCronJobs(): Promise<Array<{ jobname: string; schedule: string; active: boolean }> | null> {
  try {
    const out = execSync(
      `echo "select jobname, schedule, active from cron.job order by jobname;" | supabase db query --linked -f /dev/stdin`,
      { cwd: ROOT, encoding: "utf-8" },
    );
    const jsonStart = out.indexOf("{");
    const parsed = JSON.parse(out.slice(jsonStart));
    return parsed.rows;
  } catch (e) {
    console.error("ดึง cron.job สดไม่สำเร็จ (ข้าม scheduled_jobs รอบนี้):", (e as Error).message);
    return null;
  }
}

async function main() {
  const withCron = process.argv.includes("--with-cron");
  const raw = JSON.parse(readFileSync(INFRA_PATH, "utf-8"));

  const liveCronJobs = withCron ? await getLiveCronJobs() : null;

  for (const [key, envVars] of Object.entries(SERVICE_ENV_VARS)) {
    if (!raw.services[key]) continue;

    const allFiles = [...new Set(envVars.flatMap(grepFilesReferencing))];
    const { api_routes, edge_functions, modules } = classify(allFiles);

    const scheduled_jobs = liveCronJobs
      ? liveCronJobs.filter((j: any) => edge_functions.includes(j.jobname))
      : (raw.services[key].dependency_graph?.scheduled_jobs ?? "not_refreshed");

    const dependency_graph: DependencyGraph = { modules, api_routes, edge_functions, scheduled_jobs };
    raw.services[key].dependency_graph = dependency_graph;
    // affected_workflows is untouched — it's the existing hand-curated
    // business-workflow field (Rule 111: reuse, don't re-derive what a
    // human already declared correctly).
  }

  raw.dependency_graph_generated_at = new Date().toISOString();
  writeFileSync(INFRA_PATH, JSON.stringify(raw, null, 2) + "\n");
  console.log(`อัปเดต dependency_graph ใน ${INFRA_PATH} เสร็จแล้ว${withCron ? " (รวม cron.job สด)" : " (ยังไม่ดึง cron.job สด — รันด้วย --with-cron เพื่ออัปเดต)"}`);
}

main();
