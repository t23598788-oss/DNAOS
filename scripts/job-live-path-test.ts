/**
 * Regression test for the JOB LIVE PATH reconciliation (2026-09-23).
 *
 * The existing job capability (getJobs → dispatcher job.list/job.active →
 * impact engine) used to query public.transport_jobs, a table that does not
 * exist in the LIVE database. This test proves the repair kept the capability
 * and its contract while pointing it at the REAL table, and that nothing
 * parallel was introduced:
 *   1. the job path has no runtime reference to public.transport_jobs
 *   2. getJobs() queries public.jobs and selects the contract columns
 *   3. job.list still routes to the existing getJobs() (no second query)
 *   4. job.active semantics are UNCHANGED (IN_PROGRESS, as already declared in
 *      registry/command-registry.json — no new business rule was invented)
 *   5. no duplicate job query / dispatcher / resolver anywhere
 *   6. the returned contract keys are exactly the ones callers already consume
 *   7. LIVE (optional): when local Supabase credentials exist, a READ-ONLY anon
 *      GET confirms public.jobs answers and public.transport_jobs does not.
 *      Skipped automatically when no credentials are present (CI-safe).
 * No writes, no schema change, no credentials are ever printed.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/** The exact contract callers already consume (unchanged by the repair). */
const CONTRACT_KEYS = [
  "id",
  "project_name",
  "job_status",
  "partner_id",
  "contact_name",
  "distance_km",
  "required_quantity",
  "delivered_quantity",
  "created_at",
  "partners",
];

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const p = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walkTs(p, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p);
  }
  return out;
}

async function liveCheck(): Promise<string> {
  const envPath = join(ROOT, ".env.local");
  if (!existsSync(envPath)) return "skipped (no .env.local)";
  const env = readFileSync(envPath, "utf-8");
  const pick = (name: string) => {
    const line = env.split("\n").find((l) => l.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "") : "";
  };
  const url = pick("NEXT_PUBLIC_SUPABASE_URL");
  const key = pick("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!url || !key) return "skipped (no local credentials)";
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const cols = CONTRACT_KEYS.filter((k) => k !== "partners").join(",");

  const jobsRes = await fetch(`${url}/rest/v1/jobs?select=${cols}&limit=1`, { headers });
  assert.equal(jobsRes.status, 200, `LIVE public.jobs must answer 200, got ${jobsRes.status}`);
  const rows = (await jobsRes.json()) as Record<string, unknown>[];
  assert.ok(Array.isArray(rows), "LIVE public.jobs must return an array");
  if (rows.length > 0) {
    for (const k of CONTRACT_KEYS.filter((k) => k !== "partners")) {
      assert.ok(k in rows[0], `LIVE public.jobs row must carry the contract column ${k}`);
    }
  }

  const deadRes = await fetch(`${url}/rest/v1/transport_jobs?select=*&limit=1`, { headers });
  assert.equal(deadRes.status, 404, `LIVE public.transport_jobs must not exist (expected 404, got ${deadRes.status})`);
  const deadBody = (await deadRes.json()) as { code?: string };
  assert.equal(deadBody.code, "PGRST205", "LIVE transport_jobs must report PGRST205 (not in schema cache)");

  // --- soft-delete proof (owner decision 2026-09-23) -------------------------
  // A/B/C/D: the getJobs() scope must equal LIVE `deleted_at IS NULL`, must never
  // return a soft-deleted row, and must return [] (not a fallback) when no live
  // row matches — so the expected counts are MEASURED live, never hardcoded.
  type Row = { id: string; deleted_at: string | null; job_status?: string };
  const all = (await (await fetch(`${url}/rest/v1/jobs?select=id,deleted_at,job_status`, { headers })).json()) as Row[];
  const liveRows = all.filter((r) => !r.deleted_at);
  const liveActive = liveRows.filter((r) => r.job_status === "IN_PROGRESS");

  const filtered = (await (await fetch(`${url}/rest/v1/jobs?select=id,deleted_at&deleted_at=is.null`, { headers })).json()) as Row[];
  assert.equal(filtered.length, liveRows.length, `deleted_at IS NULL must return exactly the ${liveRows.length} live rows, got ${filtered.length}`);
  assert.ok(filtered.every((r) => r.deleted_at === null), "A: getJobs() scope must never return a soft-deleted row");

  const filteredActive = (await (await fetch(`${url}/rest/v1/jobs?select=id,deleted_at,job_status&deleted_at=is.null&job_status=eq.IN_PROGRESS`, { headers })).json()) as Row[];
  assert.equal(
    filteredActive.length,
    liveActive.length,
    `job.active scope must return exactly the ${liveActive.length} live IN_PROGRESS rows, got ${filteredActive.length}`,
  );
  assert.ok(filteredActive.every((r) => r.deleted_at === null), "B: job.active must never return a soft-deleted row");
  if (liveActive.length === 0) assert.equal(filteredActive.length, 0, "C: with no live IN_PROGRESS job the result must be [] — no fallback");

  return `checked live (total ${all.length}, live ${liveRows.length}, soft-deleted ${all.length - liveRows.length}, live IN_PROGRESS ${liveActive.length} → filtered ${filtered.length}/${filteredActive.length})`;
}

async function main() {
  const queries = stripComments(read("services/supabase/queries.ts"));
  const dispatcher = stripComments(read("engines/validation/dispatcher.ts"));

  // 1 + 2 · the job path reads public.jobs, never public.transport_jobs
  assert.equal(queries.includes("transport_jobs"), false, "services/supabase/queries.ts must not query public.transport_jobs");
  assert.ok(queries.includes('.from("jobs")'), "getJobs() must query public.jobs");
  for (const col of ["project_name", "job_status", "partner_id", "contact_name", "distance_km", "required_quantity", "delivered_quantity", "created_at"]) {
    assert.ok(queries.includes(col), `getJobs() select must include the LIVE column ${col}`);
  }
  assert.equal(
    /distance_km: 0|required_quantity: 0|delivered_quantity: 0/.test(queries),
    false,
    "the hardcoded 0 fallbacks must be replaced by the real persisted values",
  );
  // soft-delete scope (owner decision 2026-09-23): the ONE job query must be
  // scoped to deleted_at IS NULL — removing that clause must fail this test.
  assert.ok(
    /\.from\("jobs"\)[\s\S]{0,400}?\.is\("deleted_at",\s*null\)/.test(queries),
    "getJobs() must be scoped with .is(\"deleted_at\", null) so soft-deleted jobs never surface",
  );

  // 3 · job.list keeps routing to the existing getJobs() — now under the
  // caller's verified data scope (STEP 1, 2026-10-25), never an unscoped read.
  assert.ok(
    /"job\.list":\s*async \(_p, scope\) => getJobs\(undefined, scope\)/.test(dispatcher),
    "job.list must still call the existing getJobs() under the request scope",
  );

  // 4 · job.active semantics unchanged (IN_PROGRESS, already declared in the registry)
  assert.ok(
    /"job\.active":\s*async \(_p, scope\) => getJobs\("IN_PROGRESS", scope\)/.test(dispatcher),
    "job.active must keep its existing IN_PROGRESS semantic, scoped",
  );
  const registry = JSON.parse(read("registry/command-registry.json")) as {
    commands: Record<string, { output?: string; description?: string; description_th?: string }>;
  };
  const active = registry.commands["job.active"];
  assert.ok(active, "job.active must stay declared in registry/command-registry.json");
  assert.equal(active.output, "Job[]", "job.active output contract must stay Job[]");
  assert.ok(
    `${active.description ?? ""} ${active.description_th ?? ""}`.includes("IN_PROGRESS"),
    "the declared job.active contract must keep naming IN_PROGRESS",
  );

  // 5 · exactly one job query, no duplicate dispatcher/resolver
  const dirs = ["services", "engines", "core", "app"];
  const jobReaders = dirs.flatMap((d) => walkTs(d)).filter((p) => stripComments(read(p)).includes('.from("jobs")'));
  assert.deepEqual(jobReaders, ["services/supabase/queries.ts"], `exactly one module may query public.jobs, got ${jobReaders.join(", ")}`);
  const allSources = dirs.flatMap((d) => walkTs(d)).map(read).join("\n");
  for (const dup of ["getJobsV2", "getJobsLive", "jobsV2"]) {
    assert.equal(allSources.includes(dup), false, `no parallel job implementation may exist: ${dup}`);
  }

  // 6 · the returned contract keys are unchanged
  const mapBody = queries.slice(queries.indexOf("export async function getJobs"));
  for (const key of CONTRACT_KEYS) {
    assert.ok(new RegExp(`\\b${key}:`).test(mapBody), `returned contract must still contain ${key}`);
  }

  // 7 · optional live read-only check
  const live = await liveCheck();

  console.log("job-live-path:test PASS");
  console.log(
    `checks: no transport_jobs in the job path · getJobs→public.jobs · job.list→getJobs · job.active IN_PROGRESS unchanged · single job query · contract keys intact · live=${live}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
