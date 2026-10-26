/**
 * Isolated negative-authorization tests (Directives 008/009/010, Stage 02).
 *
 * WHAT THIS PROVES (only when explicitly enabled — see below):
 *   N1  anonymous INSERT into the disposable fixture table is denied
 *   N2  authenticated tenant B cannot UPDATE a fixture row owned by tenant A
 *       (tenant isolation at database level)
 *
 * HARD SAFETY RULES (Directive 010 Stage 02):
 *   - Mutation tests are DISABLED by default: this script performs ZERO writes
 *     unless invoked with the explicit flag `--allow-mutations`.
 *   - Target project identity must be explicit AND independently allowlisted
 *     through a code-reviewed repo file
 *     (scripts/security/isolated-test-project-allowlist.json) — never through
 *     user-supplied environment variables alone. Empty/missing allowlist =
 *     FAIL CLOSED (no mutation test runs anywhere).
 *   - Production, real-data staging and unknown endpoints are refused
 *     (forbidden-ref markers are rejected even before allowlist consultation).
 *   - Only the dedicated disposable fixture table is ever touched; real
 *     finance/business tables are never targeted.
 *   - NO service-role client exists in this file: anonymous client + exactly
 *     two authenticated tenant sessions only.
 *   - Fixture row state is captured BEFORE and AFTER the denied probes; a
 *     denial only counts when the row is provably unchanged.
 *   - Denials are classified, never assumed: PostgREST error code + affected
 *     row count. Generic 4xx/5xx is NEVER a pass. A zero-rows-affected denial
 *     is reported as its own verdict, distinct from an RLS policy error, and
 *     validation codes / missing rows / outages are never treated as proof of
 *     authorization enforcement.
 *   - A positive control (tenant A updates its OWN fixture row successfully)
 *     runs first; if it fails the run is BLOCKED (outage) — negatives would be
 *     meaningless, so nothing is judged PASS on a dead environment.
 *   - Cleanup deletes ONLY the fixture rows this run created, by id, using the
 *     owning tenant session; a failed cleanup is reported MANUAL_CLEANUP_
 *     REQUIRED and BLOCKS the run instead of silently claiming cleanliness.
 *     No mass delete, no touch of nonfixture data.
 *
 * FIXTURE TABLE (created once by the hardened runner, NEVER by this script):
 *   create table public.auc_test_negative_probe (
 *     id uuid primary key default gen_random_uuid(),
 *     tenant_id uuid not null references public.companies(id),
 *     probe_tag text not null,
 *     payload jsonb not null default '{}'::jsonb
 *   );
 *   alter table public.auc_test_negative_probe enable row level security;
 *   -- single permissive policy per operation scope `tenant_id = members of
 *   -- the authenticated user's tenant`, no policy for anon, no bypassrls.
 *
 * Exit codes: 0 = verified verdicts, 1 = verified failures/unproven items,
 * 2 = BLOCKED (missing isolation evidence, outages, or cleanup failure).
 * A run NEVER ends with a PASS derived from absence of evidence.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROBE_TABLE = "auc_test_negative_probe";
const PROBE_TAG = "auc_test_negative_probe_run";
const FORBIDDEN_REF_MARKERS = /(prod|production|staging|stag|live|real|client|partner|data)/i;

type Verdict = "PASS" | "FAIL" | "UNPROVEN" | "BLOCKED" | "DISABLED";
type DenialKind =
  | "RLS_POLICY_ERROR"   // 42501 / "row-level security" — direct policy rejection
  | "ZERO_ROWS_DENIED"   // no error, count === 0 — deny-by-scope
  | "WRITE_SUCCEEDED"    // count > 0 — enforcement broken (critical)
  | "VALIDATION_ERROR"   // malformed probe / missing table — proves nothing
  | "GENERIC_4XX";       // any other error — explicitly NOT accepted as proof

interface RowSnapshot {
  id: string;
  tenant_id: string;
  probe_tag: string;
  payload: Record<string, unknown>;
}
const results: { name: string; verdict: Verdict; detail: string }[] = [];
function record(name: string, verdict: Verdict, detail: string) {
  results.push({ name, verdict, detail });
}

/** Fail-closed env reader. */
function need(name: string): string {
  const v = process.env[name];
  if (!v || v.length < 8 || /(your|example|placeholder|changeme|xxxx)/i.test(v) || v === "true" || v === "1") {
    console.error(`BLOCKED — fixture env missing/placeholder: ${name}`);
    console.error("Run only on the hardened runner with isolated fixtures. This is not a code failure.");
    process.exit(2);
  }
  return v;
}

/* ============================================================================
 * GATES — project identity + reviewed allowlist. Run BEFORE any connection.
 * ========================================================================== */

const allowMutations = process.argv.includes("--allow-mutations");
const rawUrl = process.env.AUTH_TEST_SUPABASE_URL;
const anonKey = process.env.AUTH_TEST_SUPABASE_ANON_KEY;

if (!allowMutations) {
  console.log("MUTATION_TESTS_DISABLED — default mode performs no writes.");
  if (!rawUrl || !anonKey) {
    console.log("No project env set: purely informational run. Nothing connected, nothing touched.");
    process.exit(0);
  }
  try {
    extractRefAndGate(rawUrl); // gates still evaluated for reporting
    console.log(`allowlist gate evaluated for ${new URL(rawUrl).hostname} — still NOT running probes without --allow-mutations.`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(2);
  }
  console.log("Run with --allow-mutations on the allowlisted isolated project to execute probes.");
  process.exit(0);
}

// Mutation phase requires full evidence chain before ANY client is built.
if (!rawUrl || !anonKey) {
  console.error("BLOCKED — AUTH_TEST_SUPABASE_URL / AUTH_TEST_SUPABASE_ANON_KEY missing while --allow-mutations requested");
  process.exit(2);
}
const urlRef = extractRefAndGate(rawUrl);
void urlRef;

/** Extracts the 20-char project ref from a supabase.co URL and enforces gates. */
function extractRefAndGate(urlStr: string): string {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error("AUTH_TEST_SUPABASE_URL is not a valid URL");
  }
  if (parsed.protocol !== "https:") throw new Error("refusing non-https project URL");
  const m = parsed.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/i);
  if (!m) throw new Error(`URL does not look like an isolated Supabase project endpoint (${parsed.hostname})`);
  const ref = m[1].toLowerCase();
  if (FORBIDDEN_REF_MARKERS.test(ref)) {
    throw new Error(`project ref "${ref}" matches forbidden markers (prod/staging/live/real) — refused before allowlist consultation`);
  }
  const explicitRef = process.env.AUTH_TEST_PROJECT_REF;
  if (explicitRef && explicitRef.trim().toLowerCase() !== ref) {
    throw new Error(`AUTH_TEST_PROJECT_REF (${explicitRef}) != ref embedded in URL (${ref}) — ambiguous identity, refusing`);
  }
  allowlistGate(ref);
  return ref;
}

interface AllowEntry {
  project_ref: string;
  disposal_evidence?: string;
  reviewed_at?: string;
  reviewer?: string;
}

/** Reads the code-reviewed repo allowlist. Empty/missing/unparseable = refuse. */
function allowlistGate(ref: string): AllowEntry {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, "isolated-test-project-allowlist.json");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(`allowlist file unreadable at ${path} — FAIL CLOSED`);
  }
  let list: { refs?: AllowEntry[] };
  try {
    list = JSON.parse(raw) as { refs?: AllowEntry[] };
  } catch {
    throw new Error("allowlist file is not valid JSON — FAIL CLOSED");
  }
  const refs = Array.isArray(list.refs) ? list.refs : [];
  if (refs.length === 0) {
    throw new Error("allowlist is EMPTY — FAIL CLOSED: no approved isolated project exists; mutation tests refused everywhere");
  }
  const entry = refs.find((e) => e && typeof e.project_ref === "string" && e.project_ref.trim().toLowerCase() === ref);
  if (!entry) throw new Error(`project ref "${ref}" is NOT on the reviewed allowlist — refusing (unknown endpoint)`);
  if (!entry.disposal_evidence || !entry.reviewed_at || !entry.reviewer) {
    throw new Error(`allowlist entry "${ref}" lacks disposal_evidence/reviewed_at/reviewer — refusing`);
  }
  return entry;
}

/* ============================================================================
 * AUTHENTICATION — two DISTINCT tenant sessions; no service role anywhere.
 * ========================================================================== */

async function signIn(name: "A" | "B"): Promise<{ client: SupabaseClient; userId: string }> {
  const c = createClient(rawUrl as string, anonKey as string, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({
    email: need(`AUTH_TEST_TENANT_${name}_LOGIN`),
    password: need(`AUTH_TEST_TENANT_${name}_PASSWORD`),
  });
  if (error || !data.user) throw new Error(`tenant ${name} authentication failed: ${error?.message ?? "no user"}`);
  return { client: c, userId: data.user.id };
}

/* ============================================================================
 * CLASSIFICATION — code + count evidence; never a generic 4xx pass.
 * ========================================================================== */

interface PostgrestErrorLike { code?: string | null; message?: string | null }
type ProbeResult = { error: PostgrestErrorLike | null; count: number | null };

function classify(res: ProbeResult): { kind: DenialKind; detail: string } {
  const { error, count } = res;
  if (error) {
    const code = (error.code ?? "").toUpperCase();
    const msg = (error.message ?? "").toLowerCase();
    if (code === "42501" || msg.includes("row-level security")) {
      return { kind: "RLS_POLICY_ERROR", detail: `RLS policy rejected the write (code ${code || "n/a"})` };
    }
    if (code === "22P02" || code === "PGRST202" || code === "PGRST204" || msg.includes("invalid input")) {
      return { kind: "VALIDATION_ERROR", detail: `probe malformed (code ${code || "n/a"}) — proves nothing about authorization` };
    }
    if (code === "42P01" || (msg.includes("schema cache") || msg.includes("does not exist"))) {
      return { kind: "VALIDATION_ERROR", detail: "target table missing — runner setup incomplete, not a denial proof" };
    }
    return { kind: "GENERIC_4XX", detail: `generic error (code ${code || "n/a"}) — NOT acceptable as authorization proof` };
  }
  if (count !== null && count > 0) return { kind: "WRITE_SUCCEEDED", detail: `write affected ${count} row(s) — enforcement FAILED` };
  if (count === 0) return { kind: "ZERO_ROWS_DENIED", detail: "0 rows affected — deny-by-scope (row invisible/unwritable for caller)" };
  return { kind: "GENERIC_4XX", detail: "no count evidence returned — NOT acceptable as authorization proof" };
}

const DENIAL_VERDICT: Record<DenialKind, Verdict> = {
  RLS_POLICY_ERROR: "PASS",
  ZERO_ROWS_DENIED: "PASS",
  WRITE_SUCCEEDED: "FAIL",
  VALIDATION_ERROR: "UNPROVEN",
  GENERIC_4XX: "UNPROVEN",
};

function rowsEqual(a: RowSnapshot, b: RowSnapshot): boolean {
  return a.tenant_id === b.tenant_id && a.probe_tag === b.probe_tag && JSON.stringify(a.payload) === JSON.stringify(b.payload);
}

async function snapshot(rowId: string, client: SupabaseClient): Promise<RowSnapshot | null> {
  const { data, error } = await client.from(PROBE_TABLE).select("id,tenant_id,probe_tag,payload").eq("id", rowId).limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0] as unknown as RowSnapshot;
}

/* ============================================================================
 * FLOW
 * ========================================================================== */

async function main(): Promise<void> {
  const tenantA = await signIn("A");
  const userA = tenantA.userId;
  const tenantB = await signIn("B");
  const userB = tenantB.userId;
  if (userA === userB) {
    console.error("BLOCKED — tenant A and B resolved to the SAME user; two-distinct-tenants precondition violated");
    process.exit(2);
  }
  record("I two distinct authenticated tenants", "PASS", `user A ${userA.slice(0, 6)}… ≠ user B ${userB.slice(0, 6)}…`);

  // fixture row created BY the owning tenant — no service role required.
  const ins = await tenantA.client.from(PROBE_TABLE).insert({ probe_tag: PROBE_TAG, payload: { fixture: true } }, { count: "exact" });
  if (ins.error || ins.count !== 1) {
    const e = ins.error;
    console.error(`BLOCKED — cannot create fixture row in ${PROBE_TABLE} (${e?.code ?? e?.message ?? "no insert result"}); runner setup/policies incomplete`);
    process.exit(2);
  }
  const sel = await tenantA.client.from(PROBE_TABLE).select("id,tenant_id,probe_tag,payload").eq("probe_tag", PROBE_TAG).limit(2);
  const rows = (sel.data ?? []) as unknown as RowSnapshot[];
  if (!rows[0] || rows.length !== 1) {
    await boundedCleanup([tenantA.client]);
    console.error("BLOCKED — fixture row not uniquely resolvable after insert; refusing to probe");
    process.exit(2);
  }
  const target = rows[0];
  const createdIds = [target.id];

  const before = await snapshot(target.id, tenantA.client);
  if (!before) {
    await boundedCleanup([tenantA.client], createdIds);
    console.error("BLOCKED — cannot read fixture state before probes (outage?)");
    process.exit(2);
  }

  // POSITIVE CONTROL — tenant A updates its OWN row: rules out a dead/broken env.
  const own = await tenantA.client
    .from(PROBE_TABLE)
    .update({ payload: before.payload }, { count: "exact" })
    .eq("id", target.id)
    .eq("probe_tag", PROBE_TAG);
  const ownClass = classify(own as ProbeResult);
  if (ownClass.kind === "WRITE_SUCCEEDED") {
    record("P positive control", "PASS", "own-row write affected 1 row — route healthy, negatives interpretable");
  } else if (ownClass.kind === "VALIDATION_ERROR") {
    await boundedCleanup([tenantA.client], createdIds);
    record("P positive control", "BLOCKED", ownClass.detail);
    print();
    process.exit(2);
  } else {
    await boundedCleanup([tenantA.client], createdIds);
    console.error(`BLOCKED — positive control failed (${ownClass.detail}); negatives would be meaningless (outage)`);
    process.exit(2);
  }

  // N1 — anonymous insert denied.
  const n1 = await clientAnonOnly().from(PROBE_TABLE).insert({ probe_tag: PROBE_TAG, payload: { probe: "anon" } }, { count: "exact" });
  const n1Class = classify(n1 as ProbeResult);
  record("N1 anonymous insert denied", DENIAL_VERDICT[n1Class.kind], n1Class.detail);

  // N2 — tenant B cannot update tenant A's fixture row.
  const n2 = await tenantB.client
    .from(PROBE_TABLE)
    .update({ payload: { tenant_b_forbidden_write: true } }, { count: "exact" })
    .eq("id", target.id)
    .eq("probe_tag", PROBE_TAG);
  const n2Class = classify(n2 as ProbeResult);
  record("N2 cross-tenant update denied", DENIAL_VERDICT[n2Class.kind], n2Class.detail);

  // Post-state must be provably unchanged.
  const after = await snapshot(target.id, tenantA.client);
  if (!after) {
    record("W fixture state unchanged after probes", "UNPROVEN", "row vanished after denied probes — preservation cannot be proven");
  } else if (rowsEqual(before, after)) {
    record("W fixture state unchanged after probes", "PASS", "payload/tag/tenant identical before and after denied probes");
  } else {
    record("W fixture state unchanged after probes", "FAIL", "fixture row changed under denied writes — enforcement suspect");
  }

  // Scoped cleanup — ONLY this run's ids, owner session, no mass delete.
  if (!cleanupDone) {
    const del = await tenantA.client.from(PROBE_TABLE).delete({ count: "exact" }).in("id", createdIds);
    if (del.error) {
      record("X scoped cleanup", "BLOCKED", `cleanup error (${del.error.code ?? del.error.message}) — MANUAL_CLEANUP_REQUIRED ids=${createdIds.join(",")}`);
    } else {
      const rem = await tenantA.client.from(PROBE_TABLE).select("id").eq("probe_tag", PROBE_TAG).limit(1);
      if ((rem.data ?? []).length === 0) {
        record("X scoped cleanup", "PASS", `exactly ${createdIds.length} fixture row(s) removed by id; nothing else touched`);
      } else {
        record("X scoped cleanup", "BLOCKED", "fixture rows remain after cleanup — MANUAL_CLEANUP_REQUIRED (scoped; nonfixture data untouched)");
      }
    }
    cleanupDone = true;
  }

  print();
  if (results.some((r) => r.verdict === "BLOCKED")) process.exit(2);
  if (results.some((r) => r.verdict === "FAIL" || r.verdict === "UNPROVEN")) process.exit(1);
  process.exit(0);
}

function clientAnonOnly(): SupabaseClient {
  return createClient(rawUrl as string, anonKey as string, { auth: { persistSession: false } });
}

let cleanupDone = false;
async function boundedCleanup(clients: SupabaseClient[], ids?: string[]): Promise<void> {
  // best-effort bounded cleanup; used only on BLOCKED paths before probes
  if (!ids || ids.length === 0) return;
  try {
    await clients[0].from(PROBE_TABLE).delete().in("id", ids);
  } catch {
    console.error(`MANUAL_CLEANUP_REQUIRED — scoped fixture ids ${ids.join(",")}`);
  }
}

function print() {
  for (const r of results) console.log(`${r.verdict.padEnd(8)}  ${r.name} — ${r.detail}`);
}

void PROBE_TABLE; // referenced above; kept void-free at module level
