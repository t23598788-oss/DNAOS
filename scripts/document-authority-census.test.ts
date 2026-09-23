/**
 * BLOCK-2 — Document canonical authority census (owner approved 2026-09-23).
 *
 * PHASE A/B infrastructure: proves the repository-wide state of document-table
 * mutations with the corrected dynamic-aware census (scripts/lib/
 * directDbMutationCensus.cjs) instead of a per-test regex.
 *
 * Why this test exists: the earlier census saw only quoted literals, so
 * `document-write.ts`'s `.from(table)` selector made `invoices` /
 * `standalone_documents` look UNOWNED (a false negative). This test resolves
 * that selector STRICTLY (see the census module) and then asserts:
 *   1. the exact set of write sites OUTSIDE canonical authority, per table
 *      (declared below — it must not grow silently, and it shrinks as PHASE C
 *      cuts each site over)
 *   2. zero allow-list violations
 *   3. the exact set of UNRESOLVED dynamic sites, each with its reason
 *   4. resolver self-proofs + negative controls, in-process
 *   5. the D5 site is tracked as the open closure blocker
 *
 * File naming note: `.test.ts` is this repo's sanctioned non-module pattern
 * (sync-registry ignores it; nine other files already use it), which keeps this
 * test-only infrastructure out of the module registry.
 */
import { readFileSync } from "fs";
import { createRequire } from "node:module";
import { join } from "path";

const ROOT = join(__dirname, "..");
const requireCensus = createRequire(join(__dirname, "noop.cjs"));
const census = requireCensus("./lib/directDbMutationCensus.cjs") as {
  CANONICAL_WRITER_DIR: string;
  findDirectMutations: (o: { root: string; table: string; dirs: readonly string[] }) => { file: string; line: number; op: string }[];
  findDynamicTableMutations: (o: { root: string; dirs: readonly string[]; allowList: readonly string[] }) => {
    sites: { file: string; line: number; op: string; table: string }[];
    outside: { file: string; line: number; op: string; tables: string[] }[];
    violations: { file: string; line: number; op: string; reason: string }[];
    unresolved: { file: string; line: number; op: string; reason: string; variable: string }[];
  };
  findDynamicTableMutationsInSource: (code: string, file: string, allowList: readonly string[]) => {
    sites: { file: string; line: number; op: string; table: string }[];
    outside: { file: string; line: number; op: string }[];
    violations: { file: string; line: number; op: string; reason: string }[];
    unresolved: { file: string; line: number; op: string; reason: string }[];
  };
};

const DIRS = ["app", "core", "engines", "services", "gateway", "supabase", "scripts"];
const DOC_TABLES = [
  "invoices",
  "invoice_items",
  "standalone_documents",
  "standalone_document_items",
  "document_versions",
  "document_groups",
  "document_artifacts",
  "document_references",
];
/** The only tables the canonical document writer may select between. */
const DYNAMIC_ALLOW = ["invoices", "standalone_documents"];

/**
 * PHASE A baseline: write sites outside canonical authority, as `file:op`.
 * PHASE C must shrink this to nothing (except the D5 blocker, see below).
 */
const DECLARED_OUTSIDE: Record<string, readonly string[]> = {
  invoices: ["services/supabase/queries.ts:insert", "gateway/actions.ts:update"],
  standalone_documents: [
    "services/supabase/queries.ts:insert",
    "gateway/actions.ts:insert",
    "scripts/demo-full-pipeline.ts:insert",
    "scripts/demo-full-pipeline-part2.ts:insert",
  ],
  document_groups: ["engines/jobs/auto-create.ts:insert", "scripts/demo-full-pipeline.ts:insert"],
};

/**
 * Dynamic sites that cannot be resolved to a finite literal set. Each is a
 * documented, evidence-classified case; anything new here fails this test.
 *   - backup.ts: an ops/restore tool; its TABLES list holds only legacy names
 *     (documents, invoice_debts, invoice_payments, ...) — no modern document
 *     table, so it cannot write one.
 *   - the two test files: their own assertion strings quote the
 *     `.from( / .insert(` pattern as text (that is literally what they assert).
 */
const DECLARED_UNRESOLVED: readonly string[] = [
  "scripts/backup.ts:NO_LOCAL_DECLARATION",
  "scripts/job-contract-wrap-test.ts:EXTERNAL_TABLE_EXPRESSION",
  "scripts/monitoring-test.ts:EXTERNAL_TABLE_EXPRESSION",
];

/** D5 — owner-declared BLOCKED_SEMANTIC_DECISION: this site stays as an exception. */
const D5_BLOCKER = "gateway/actions.ts:update:invoices";

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

const asSites = (s: { file: string; op: string }[]): string[] => [...new Set(s.map((x) => `${x.file}:${x.op}`))].sort();

const repoDynamic = census.findDynamicTableMutations({ root: ROOT, dirs: DIRS, allowList: DYNAMIC_ALLOW });

// ── 1/2 — corrected census per document table ───────────────────────────────
for (const table of DOC_TABLES) {
  const literal = census.findDirectMutations({ root: ROOT, table, dirs: DIRS });
  const dynCanonical = repoDynamic.sites.filter((s) => s.table === table);
  const dynOutside = repoDynamic.outside.filter((s) => s.tables.indexOf(table) >= 0);

  const canonicalFiles = [...new Set([
    ...literal.filter((s) => s.file.startsWith(census.CANONICAL_WRITER_DIR)).map((s) => s.file),
    ...dynCanonical.map((s) => s.file),
  ])].sort();
  const outside = [
    ...literal.filter((s) => !s.file.startsWith(census.CANONICAL_WRITER_DIR)).map((s) => ({ file: s.file, op: s.op })),
    ...dynOutside.map((s) => ({ file: s.file, op: s.op })),
  ];

  const declared = DECLARED_OUTSIDE[table] ?? [];
  check(
    `A1 outside-writer census matches the declared baseline for ${table}`,
    asSites(outside).join(",") === [...declared].sort().join(","),
    `got [${asSites(outside).join(", ")}] declared [${[...declared].sort().join(", ")}]`,
  );

  if (canonicalFiles.length) {
    check(
      `A2 a canonical authority is identified for ${table}`,
      canonicalFiles.every((f) => f.startsWith(census.CANONICAL_WRITER_DIR)),
      canonicalFiles.join(", "),
    );
  } else {
    check(`A2 ${table} has no canonical and no outside writer (nothing to own)`, outside.length === 0, asSites(outside).join(", "));
  }
}

// ── 3 — violations + unresolved baseline ────────────────────────────────────
check("A3 no dynamic table literal outside the declared allow-list", repoDynamic.violations.length === 0,
  repoDynamic.violations.map((v) => `${v.file}:${v.line}:${v.op}:${v.reason}`).join(", "));
check("A4 the canonical document writer IS resolved (no false negative)",
  repoDynamic.sites.some((s) => s.file === "engines/canonical/document-write.ts"));
check("A5 unresolved dynamic sites are exactly the declared ones",
  repoDynamic.unresolved.map((u) => `${u.file}:${u.reason}`).sort().join(",") === [...DECLARED_UNRESOLVED].sort().join(","),
  `got [${repoDynamic.unresolved.map((u) => `${u.file}:${u.reason}`).join(", ")}]`);
check("A6 the canonical document authority set is exactly the expected writers",
  [...new Set(repoDynamic.sites.map((s) => s.file))].sort().join(",") ===
    "engines/canonical/document-write.ts,engines/canonical/transaction-write.ts",
  [...new Set(repoDynamic.sites.map((s) => s.file))].sort().join(","));

// ── 4 — resolver self-proofs + negative controls (in-process) ───────────────
const REAL = readFileSync(join(ROOT, "engines/canonical/document-write.ts"), "utf-8");
const real = census.findDynamicTableMutationsInSource(REAL, "engines/canonical/document-write.ts", DYNAMIC_ALLOW);
check("B1 the real document-write selector resolves into the allow-list",
  real.sites.length >= 4 && real.violations.length === 0 && real.unresolved.length === 0,
  `sites=${real.sites.length} violations=${real.violations.length} unresolved=${real.unresolved.length}`);
check("B2 every resolved table is inside the allow-list", real.sites.every((s) => DYNAMIC_ALLOW.indexOf(s.table) >= 0));

// NOTE: every probe below is assembled by concatenation so this file's own text
// never contains a scanable `.from(<arg>)` chain. Without that, the census
// (correctly) reports the probe strings themselves as unresolved sites in this
// file, and the only way to silence that would be a path exclusion — which is
// forbidden. Proof that the trick works is check A5 itself.
const NC_A = census.findDynamicTableMutationsInSource("await db.from(" + "someInput.table).insert({ a: 1 })", "engines/canonical/x.ts", DYNAMIC_ALLOW);
check("NC-A unknown dynamic table is NOT authority", NC_A.sites.length === 0 && NC_A.unresolved[0]?.reason === "EXTERNAL_TABLE_EXPRESSION", JSON.stringify(NC_A.unresolved[0] ?? {}));

const NC_B = census.findDynamicTableMutationsInSource("const t = k" + ' === "a" ? "invoices" : "secret_table"\n' + "await db.from(" + "t).insert({ a: 1 })", "engines/canonical/x.ts", DYNAMIC_ALLOW);
check("NC-B a literal outside the allow-list FAILS", NC_B.sites.length === 0 && NC_B.violations[0]?.reason === "LITERAL_OUTSIDE_ALLOW_LIST", JSON.stringify(NC_B.violations[0] ?? {}));

const NC_C = census.findDynamicTableMutationsInSource("const t = req.query.table" + ' ?? "invoices"\n' + "await db.from(" + "t).insert({ a: 1 })", "engines/canonical/x.ts", DYNAMIC_ALLOW);
check("NC-C caller-controlled table name is NOT authority", NC_C.sites.length === 0 && NC_C.unresolved.length === 1, JSON.stringify(NC_C.unresolved[0] ?? {}));

const NC_D = census.findDynamicTableMutationsInSource("const t = k" + ' ? "invoices" : "standalone_documents"\n' + "await db.from(" + "t).insert({ a: 1 })", "services/not-canonical.ts", DYNAMIC_ALLOW);
check("NC-D resolvable dynamic write outside the canonical dir counts as outside", NC_D.outside.length === 1 && NC_D.sites.length === 0, JSON.stringify(NC_D.outside[0] ?? {}));

const NC_E = census.findDynamicTableMutationsInSource("const t = `doc_" + "${kind}`\n" + "await db.from(" + "t).insert({ a: 1 })", "engines/canonical/x.ts", DYNAMIC_ALLOW);
check("NC-E an interpolated table name is NOT authority", NC_E.sites.length === 0 && NC_E.unresolved.length === 1, JSON.stringify(NC_E.unresolved[0] ?? {}));

const SELF = readFileSync(join(ROOT, "scripts/document-authority-census.test.ts"), "utf-8");
const selfProbe = census.findDynamicTableMutationsInSource(SELF, "scripts/document-authority-census.test.ts", DYNAMIC_ALLOW);
check("NC-F this test's own probes are not census hits (proves no path exclusion is needed)",
  selfProbe.sites.length === 0 && selfProbe.unresolved.length === 0 && selfProbe.violations.length === 0 && selfProbe.outside.length === 0,
  `sites=${selfProbe.sites.length} unresolved=${selfProbe.unresolved.length} violations=${selfProbe.violations.length} outside=${selfProbe.outside.length}`);

// ── 5 — the open closure blocker ────────────────────────────────────────────
const d5 = census.findDirectMutations({ root: ROOT, table: "invoices", dirs: DIRS })
  .filter((s) => s.file === "gateway/actions.ts" && s.op === "update");
check("C1 the D5 site is tracked as the open BLOCKED_SEMANTIC_DECISION", d5.length === 1,
  d5.map((s) => `${s.file}:${s.line}:${s.op}`).join(", "));
console.log(`\nDOCUMENT_CLOSURE_BLOCKER = D5 (${D5_BLOCKER}) — STATUS: BLOCKED_SEMANTIC_DECISION (owner decision pending)`);
console.log(`DOCUMENT_OUTSIDE_WRITES_NOW = ${Object.values(DECLARED_OUTSIDE).reduce((a, b) => a + b.length, 0)} declared baseline sites (PHASE C target) + D5 held`);

console.log(`\n${checks - failures}/${checks} passed`);
if (failures > 0) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}
