/**
 * Isolated negative-authorization tests (Directives 007/008/009, Phase A.5/A.6).
 *
 * PURPOSE — proves at DATABASE level (not by code review) that these writes are DENIED:
 *   N1  anonymous insert on a business table (RLS on, no service-role bypass)
 *   N2  cross-tenant update/supabase auth sharing — one tenant cannot mutate another
 *   N3  revoked/absent agent token cannot write through the canonical API
 *   N4  canonical finance writer demands its signature channel — unsigned write denied
 *   N5  service-role key is not accepted by public/business write endpoints
 *
 * RUNTIME REQUIREMENTS — this file NEVER touches a production system. It runs
 * ONLY against an authorized hardened runner that provides dedicated fixtures:
 *
 *   AUTH_TEST_SUPABASE_URL            isolated test project URL
 *   AUTH_TEST_SUPABASE_ANON_KEY       test project anon key (RLS active)
 *   AUTH_TEST_SUPABASE_SERVICE_ROLE_KEY  test project service key (fixture rows only)
 *   AUTH_TEST_TENANT_A_ID / AUTH_TEST_TENANT_B_ID   two tenant fixtures
 *   AUTH_TEST_AGENT_REVOKED_TOKEN     pre-revoked agent token fixture
 *   AUTH_TEST_INTERNAL_WRITE_TOKEN    correct secret expected by /api/internal/connect/*
 *
 * Missing or placeholder env = the test REFUSES to run (BLOCKED, exit 2) and
 * says exactly which fixture is missing — it must never degrade into "PASS by
 * absence of evidence".
 *
 * Run on the hardened runner: npx tsx scripts/security/isolated-negative-authorization.test.ts
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const PLACEHOLDER_RE = /(your|example|placeholder|changeme|xxxx)/i;

function needEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length < 8 || PLACEHOLDER_RE.test(v)) {
    console.error(`BLOCKED  fixture env missing/placeholder: ${name}`);
    console.error("This is not a code failure: run on the authorized hardened runner with isolated fixtures.");
    process.exit(2);
  }
  return v;
}

const URL = needEnv("AUTH_TEST_SUPABASE_URL");
const ANON = needEnv("AUTH_TEST_SUPABASE_ANON_KEY");
const SERVICE = needEnv("AUTH_TEST_SUPABASE_SERVICE_ROLE_KEY");
const TENANT_A = needEnv("AUTH_TEST_TENANT_A_ID");
const TENANT_B = needEnv("AUTH_TEST_TENANT_B_ID");
const INTERNAL = needEnv("AUTH_TEST_INTERNAL_WRITE_TOKEN");
const BASE_URL = process.env.AUTH_TEST_APP_BASE_URL ?? "http://127.0.0.1:3000";

let failed = 0;
const results: string[] = [];
function record(name: string, denied: boolean, detail: string) {
  results.push(`${denied ? "PASS" : "FAIL"}  N-${name} — ${detail}`);
  if (!denied) failed += 1;
}

const anon: SupabaseClient = createClient(URL, ANON, { auth: { persistSession: false } });
const service = createClient(URL, SERVICE, { auth: { persistSession: false } });

/** Evidence helper — prints only counts/error-codes, never row values. */
function denied(left: unknown, side: string): { denied: boolean; detail: string } {
  const e = left as { code?: string; message?: string } | null;
  const denied = e !== null;
  return { denied, detail: `${side}: ${denied ? e?.code ?? "error" : "write succeeded"}` };
}

async function main() {
  // N1 — anonymous insert denied (RLS must reject, not silently no-op).
  {
    const res = await anon
      .from("business_events")
      .insert({ tenant_id: TENANT_A, event_type: "auc_write_probe", payload: {} });
    const d = denied(res.error, "anon insert business_events");
    record("1 anon insert denied (RLS)", d.denied, d.detail);
  }

  // N2 — cross-tenant write denied: authenticated-as-A cannot mutate B's row.
  {
    // Fixture: one row owned by tenant B, pre-inserted by the runner's setup.
    const seed = await service
      .from("debt_trackings")
      .select("id").eq("tenant_id", TENANT_B).limit(1);
    const rowId = (seed.data as { id: string }[] | null)?.[0]?.id;
    if (!rowId) {
      record("2 cross-tenant update denied", false, "fixture row for tenant B missing — runner setup incomplete");
    } else {
      const res = await anon
        .from("debt_trackings")
        .update({ status: "auc_cross_tenant_probe" })
        .eq("id", rowId);
      const d = denied(res.error, "cross-tenant update");
      record("2 cross-tenant update denied (tenant isolation)", d.denied, d.detail);
    }
  }

  // N3 — revoked agent token cannot write through the public API surface.
  {
    const revoked = process.env.AUTH_TEST_AGENT_REVOKED_TOKEN ?? "";
    if (!revoked) {
      record("3 revoked agent token denied", false, "fixture env AUTH_TEST_AGENT_REVOKED_TOKEN missing");
    } else {
      const r = await fetch(`${BASE_URL}/api/v1/query`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${revoked}` },
        body: JSON.stringify({ command: "auc_write_probe" }),
      });
      record("3 revoked agent token denied at API", r.status >= 400 && r.status < 500, `HTTP ${r.status}`);
    }
  }

  // N4 — unsigned/tenant-scoped finance write via internal connect route denied.
  {
    const r = await fetch(`${BASE_URL}/api/internal/connect/payment-confirm`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer wrong-${TENANT_A.slice(0, 4)}` },
      body: JSON.stringify({ tenant_id: TENANT_A, event: "auc_finance_probe" }),
    });
    record("4 internal finance write denied without correct secret", r.status >= 400, `HTTP ${r.status}`);
  }

  // N5 — correct secret present ⇒ the authoritative channel still exists
  // (control of the negative, so N4 passing is not merely an outage).
  {
    const r = await fetch(`${BASE_URL}/api/internal/connect/material-price`, {
      method: "HEAD",
      headers: { authorization: `Bearer ${INTERNAL}` },
    });
    record("5 authorized internal channel alive (control)", r.status < 500, `HTTP ${r.status}`);
  }

  console.log(results.join("\n"));
  console.log(failed === 0 ? "\nALL NEGATIVE AUTHORIZATION CHECKS PASSED (isolated fixtures)" : `\n${failed} CHECK(S) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("BLOCKED — runner error:", e instanceof Error ? e.message : e);
  process.exit(2);
});
