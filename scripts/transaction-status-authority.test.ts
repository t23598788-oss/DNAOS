/**
 * D1 — CANONICAL TRANSACTION STATUS CUTOVER guard (owner round D1, 2026-09-25).
 *
 * Goal: `Transaction / Job status write = ONE CANONICAL WRITER`. Every runtime
 * path that changes `customer_orders.status` must go through
 * engines/canonical/transaction-write.ts#changeTransactionStatus — the routes
 * keep their own state-machine validation (resolveTransition + cancel guard)
 * and hand the TARGET status to the canonical writer exactly once per request.
 *
 * Proves against real source (never mocked):
 *   1. advance route: 0 direct customer_orders updates, 0 direct audit inserts,
 *      canonical call in both branches.
 *   2. [id] route: the ONLY customer_orders update left is the non-status PATCH
 *      (allow-listed fields); DELETE goes canonical; 0 direct audit inserts.
 *   3. Repo-wide counters: DIRECT_TRANSACTION_STATUS_WRITERS_OUTSIDE_CANONICAL
 *      / *_AUDIT_WRITERS_* = 0 · RUNTIME_CHANGE_TRANSACTION_STATUS_CALLERS >= 1
 *      (exactly the 2 routes) · authority = 1 status update + 1 audit/call.
 *   4. State machine unchanged (real resolveTransition contract values).
 *   5. Response contract strings of both routes unchanged (404/422/200).
 *   6. Negative controls: injected direct status update IS caught; commented
 *      one is not; non-status update is not misclassified.
 *
 * Live-DB execution of route handlers needs auth + PostgREST and is NOT
 * claimed here (repo pattern: payment-invariant-test discloses the same).
 * DB-free invariants (state machine, contract shapes, single-write structure)
 * are proven statically.
 *
 * Run: npm run transaction-status-authority:test
 */
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { resolveTransition, getWorkflow } from "@/engines/transactions/state-machine";

const ROOT = join(__dirname, "..");

const ADVANCE_ROUTE = "app/api/admin/transactions/[id]/advance/route.ts";
const ID_ROUTE = "app/api/admin/transactions/[id]/route.ts";
const CANONICAL = "engines/canonical/transaction-write.ts";

/** runtime dirs (scripts/ + supabase/ out of scope — provider tier = connect-boundary-census-test) */
const RUNTIME_DIRS = ["app", "components", "engines", "services", "gateway", "core", "cognitive", "presenter"];

let failures = 0;
let checks = 0;
function check(name: string, ok: boolean, detail = ""): void {
  checks += 1;
  if (ok) {
    console.log(`PASS  ${name}`);
    return;
  }
  failures += 1;
  console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
}

const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

/** strip block + line comments so prose (e.g. this header) never becomes a write site */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** every `.from("customer_orders") … .update(` chain, with the update argument.
 *  chains are multiline; capture ends at the first `).<builder>` after the arg. */
function customerOrdersUpdateSites(code: string): { arg: string }[] {
  const sites: { arg: string }[] = [];
  const re = /\.from\(\s*["']customer_orders["']\s*\)\s*\.\s*update\(\s*([\s\S]{0,400}?)\)\s*\.\s*(eq|select|single|delete)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) sites.push({ arg: m[1].trim() });
  return sites;
}

function isStatusArg(arg: string): boolean {
  return /\bstatus\s*:/.test(arg);
}

function auditInsertCount(code: string): number {
  const re = /\.from\(\s*["']audit_logs["']\s*\)\s*\.\s*insert\(/g;
  return (code.match(re) ?? []).length;
}

function walk(dir: string, out: string[] = []): string[] {
  try {
    readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next" || e.name === ".git") continue;
      walk(p, out);
    } else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
console.log("=== D1 — CANONICAL TRANSACTION STATUS CUTOVER GUARD ===\n");

const advance = stripComments(read(ADVANCE_ROUTE));
const idRoute = stripComments(read(ID_ROUTE));
const canonical = stripComments(read(CANONICAL));

// ── 1. advance route ──────────────────────────────────────────────────────
const advanceUpdates = customerOrdersUpdateSites(advance);
check(
  "A1 advance: direct customer_orders.update sites = 0",
  advanceUpdates.length === 0,
  JSON.stringify(advanceUpdates),
);
check("A2 advance: direct audit_logs.insert sites = 0", auditInsertCount(advance) === 0, `${auditInsertCount(advance)}`);
check(
  "A3 advance imports and calls changeTransactionStatus in BOTH branches (cancel + transition)",
  /import\s*\{\s*changeTransactionStatus\s*\}\s*from\s*"@\/engines\/canonical\/transaction-write"/.test(advance)
    && (advance.match(/changeTransactionStatus\(\{/g) ?? []).length === 2,
  `calls=${(advance.match(/changeTransactionStatus\(\{/g) ?? []).length}`,
);
check(
  "A4 advance still owns state-machine validation (resolveTransition on the route — canonical never re-computes it)",
  advance.includes('resolveTransition("sale", order.status, action)'),
);
check(
  "A5 advance cancel guard unchanged (CANCELLED/PAID → 422 before any write)",
  advance.includes('order.status === "CANCELLED" || order.status === "PAID"')
    && advance.includes("ไม่สามารถยกเลิกจากสถานะ"),
);
// exclusive branches: cancel returns new_state before resolveTransition is reached
const cancelIdx = advance.indexOf('action === "cancel"');
const cancelReturnIdx = advance.indexOf('new_state: "CANCELLED"');
const resolveIdx = advance.indexOf("resolveTransition(");
check(
  "A6 advance branches are exclusive (cancel returns before resolveTransition — status written once per request)",
  cancelIdx >= 0 && cancelReturnIdx > cancelIdx && cancelReturnIdx < resolveIdx,
  `cancel=${cancelIdx} return=${cancelReturnIdx} resolve=${resolveIdx}`,
);

// ── 2. [id] route ─────────────────────────────────────────────────────────
const idUpdates = customerOrdersUpdateSites(idRoute);
check(
  "B1 [id]: exactly 1 customer_orders.update site left = the non-status PATCH (.update(update))",
  idUpdates.length === 1 && idUpdates[0].arg === "update",
  JSON.stringify(idUpdates),
);
check("B2 [id]: no object-literal status update anywhere in the route", !/\.update\(\s*\{\s*status/.test(idRoute));
const patchAssignments = (idRoute.match(/update\.[A-Za-z_]+ =/g) ?? []).map((s) => s.split(".")[1].split(" ")[0]);
const allowedPatchFields = ["delivery_note", "requested_delivery_at"];
check(
  "B3 [id]: PATCH only writes allow-listed non-status fields (behavior unchanged)",
  patchAssignments.every((f) => allowedPatchFields.includes(f)) && patchAssignments.length <= allowedPatchFields.length,
  JSON.stringify(patchAssignments),
);
check("B4 [id]: direct audit_logs.insert sites = 0", auditInsertCount(idRoute) === 0, `${auditInsertCount(idRoute)}`);
check(
  "B5 [id]: DELETE goes through changeTransactionStatus (import + exactly 1 call)",
  /import\s*\{\s*changeTransactionStatus\s*\}\s*from\s*"@\/engines\/canonical\/transaction-write"/.test(idRoute)
    && (idRoute.match(/changeTransactionStatus\(\{/g) ?? []).length === 1,
  `calls=${(idRoute.match(/changeTransactionStatus\(\{/g) ?? []).length}`,
);

// ── 3. response contract strings (shapes consumers rely on) ───────────────
check("C1 advance 404 contract intact", advance.includes("ไม่พบ transaction") && advance.includes("status: 404"));
check("C2 advance 422 contracts intact (invalid transition message)", advance.includes("ไม่สามารถทำ") && advance.includes("status: 422"));
check(
  "C3 advance success shapes intact (new_state for both branches)",
  advance.includes('new_state: "CANCELLED"') && advance.includes("new_state: transition.to"),
);
check("C4 [id] DELETE success shape intact ({ ok: true })", idRoute.includes("NextResponse.json({ ok: true })"));
check("C5 [id] PATCH success shape intact ({ transaction: data })", idRoute.includes("NextResponse.json({ transaction: data })"));
check("C6 [id] GET envelope (legacy keys) untouched", idRoute.includes("events: canonical.business_events"));

// ── 4. canonical authority: exactly 1 status update + 1 audit per call ────
const canonicalBody = stripComments(canonical.slice(canonical.indexOf("export async function changeTransactionStatus")));
const canonicalStatusUpdates = customerOrdersUpdateSites(canonicalBody).filter((s) => isStatusArg(s.arg));
check(
  "D1 canonical changeTransactionStatus: exactly 1 status update site",
  canonicalStatusUpdates.length === 1,
  `${canonicalStatusUpdates.length}`,
);
check(
  "D2 canonical changeTransactionStatus: exactly 1 recordCanonicalAudit call (audit once per request)",
  (canonicalBody.match(/recordCanonicalAudit\(\{/g) ?? []).length === 1,
  `${(canonicalBody.match(/recordCanonicalAudit\(\{/g) ?? []).length}`,
);
check(
  "D3 canonical validates the current state exists (no write + no audit for a ghost order)",
  canonicalBody.includes("TRANSACTION_NOT_FOUND"),
);
check(
  "D4 canonical uses the canonical audit vocabulary (transaction.status_changed)",
  canonical.includes('action: "transaction.status_changed"'),
);

// ── 5. repo-wide census ───────────────────────────────────────────────────
let statusWritersOutside = 0;
let statusAuditWritersOutside = 0;
const unresolvedSites: string[] = [];
const runtimeCallerFiles: string[] = [];
for (const dir of RUNTIME_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const rel = file.slice(ROOT.length + 1).replace(/\\/g, "/");
    if (rel === CANONICAL) continue;
    const src = stripComments(readFileSync(file, "utf8"));
    for (const s of customerOrdersUpdateSites(src)) {
      if (isStatusArg(s.arg)) {
        statusWritersOutside += 1;
        console.log(`       status-writer offender: ${rel}`);
      } else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s.arg) && rel !== ID_ROUTE) {
        // identifier-arg update outside the known PATCH = unreviewed write path
        unresolvedSites.push(`${rel} (.update(${s.arg}))`);
      }
    }
    if (/from\(\s*["']audit_logs["']\s*\)\s*\.\s*insert\(/.test(src) && /entity_type:\s*["']customer_order["']/.test(src)) {
      statusAuditWritersOutside += 1;
      console.log(`       audit offender: ${rel}`);
    }
    if (/changeTransactionStatus\(\{/.test(src)) runtimeCallerFiles.push(rel);
  }
}
check(
  "E1 DIRECT_TRANSACTION_STATUS_WRITERS_OUTSIDE_CANONICAL=0",
  statusWritersOutside === 0,
  `count=${statusWritersOutside}`,
);
check(
  "E2 DIRECT_TRANSACTION_STATUS_AUDIT_WRITERS_OUTSIDE_CANONICAL=0",
  statusAuditWritersOutside === 0,
  `count=${statusAuditWritersOutside}`,
);
check(
  "E3 RUNTIME_CHANGE_TRANSACTION_STATUS_CALLERS>=1 (exactly the two cutover routes)",
  runtimeCallerFiles.length >= 1
    && [...runtimeCallerFiles].sort().join(",") === [ADVANCE_ROUTE, ID_ROUTE].sort().join(","),
  JSON.stringify(runtimeCallerFiles),
);
check(
  "E4 no unresolved identifier-arg customer_orders updates outside the known PATCH",
  unresolvedSites.length === 0,
  unresolvedSites.join(" | "),
);

// ── 6. state machine unchanged (real module, real values) ─────────────────
const valid = resolveTransition("sale", "DRAFT", "submit");
check(
  "F1 valid advance: DRAFT + submit → SUBMITTED (same target as pre-cutover)",
  valid?.to === "SUBMITTED" && valid?.biz_event === "quotation_sent",
  JSON.stringify(valid),
);
const invalid = resolveTransition("sale", "DRAFT", "deliver");
check("F2 invalid transition: DRAFT + deliver → rejected (undefined)", invalid === undefined, JSON.stringify(invalid));
const finalState = resolveTransition("sale", "PAID", "pay");
check("F3 final state: PAID has no next step (undefined)", finalState === undefined, JSON.stringify(finalState));
const cancelled = resolveTransition("sale", "CANCELLED", "create");
check(
  "F4 CANCELLED is a terminal branch outside the linear steps (route-level guard owns it)",
  cancelled === undefined,
  JSON.stringify(cancelled),
);
const wf = getWorkflow("sale");
check(
  "F5 sale workflow contract intact (11 steps, DRAFT first, PAID last)",
  wf.steps.length === 11 && wf.steps[0]?.event === "DRAFT" && wf.steps[wf.steps.length - 1]?.event === "PAID",
  `steps=${wf.steps.length}`,
);

// ── 7. negative controls (the scanner really catches a reintroduction) ────
const injected =
  "await db.from(" + '"customer_orders")\n    .update({ status: "X", updated_at: new Date().toISOString() })\n    .eq("id", id);';
const injectedSites = customerOrdersUpdateSites(injected);
check(
  "NC1 an injected direct status update IS detected (and would fail E1)",
  injectedSites.length === 1 && isStatusArg(injectedSites[0].arg),
  JSON.stringify(injectedSites),
);
const commented = "// await db.from(" + '"customer_orders").update({ status: "X" }).eq("id", id);';
check(
  "NC2 a commented-out write is NOT counted (comment stripping is real)",
  customerOrdersUpdateSites(stripComments(commented)).length === 0,
);
const nonStatus = "await db.from(" + '"customer_orders").update({ delivery_note: "x" }).eq("id", id);';
const nonStatusSites = customerOrdersUpdateSites(nonStatus);
check(
  "NC3 a non-status update is NOT classified as a status writer",
  nonStatusSites.length === 1 && !isStatusArg(nonStatusSites[0].arg),
  JSON.stringify(nonStatusSites),
);
const auditInjected = "await db.from(" + '"audit_logs").insert({ entity_type: "customer_order", action: "cancel" });';
check("NC4 an injected legacy status-audit insert IS detected", auditInsertCount(auditInjected) === 1);

// ── summary ───────────────────────────────────────────────────────────────
console.log("\n=== CENSUS COUNTERS ===");
console.log(`DIRECT_TRANSACTION_STATUS_WRITERS_OUTSIDE_CANONICAL=${statusWritersOutside}`);
console.log(`DIRECT_TRANSACTION_STATUS_AUDIT_WRITERS_OUTSIDE_CANONICAL=${statusAuditWritersOutside}`);
console.log(`RUNTIME_CHANGE_TRANSACTION_STATUS_CALLERS=${runtimeCallerFiles.length} (>=1 required)`);
console.log("CANONICAL_STATUS_AUTHORITIES=1 (engines/canonical/transaction-write.ts#changeTransactionStatus)");
console.log(`\n${checks - failures}/${checks} passed`);
if (failures > 0) {
  console.log(`FAILED: ${failures} check(s)`);
  process.exit(1);
}
console.log("transaction-status-authority:test PASS");



