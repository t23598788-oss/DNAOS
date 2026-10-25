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
import { readFileSync, readdirSync } from "fs";
import { createRequire } from "node:module";
import { join } from "path";
import { sendInvoiceToLine, executeDocumentCreate } from "@/gateway/actions";

const ROOT = join(__dirname, "..");
const requireCensus = createRequire(join(__dirname, "noop.cjs"));
const census = requireCensus("./lib/directDbMutationCensus.cjs") as {
  CANONICAL_WRITER_DIR: string;
  findDirectMutations: (o: { root: string; table: string; dirs: readonly string[] }) => { file: string; line: number; op: string }[];
  findMutationSitesInSource: (code: string, file: string, table: string) => { file: string; line: number; op: string }[];
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
  // PHASE C + PHASE D closed every direct writer on all eight document tables.
  invoices: [],
  invoice_items: [],
  standalone_documents: [],
  standalone_document_items: [],
  document_versions: [],
  document_groups: [],
  document_artifacts: [],
  document_references: [],
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

/** D5 resolution reference (owner decision 2026-09-23): the gateway's direct
 *  `invoices.update(invoice_status="SENT")` is gone — document lifecycle is owned
 *  by issueDocument(), delivery is evidence in line_events. */
const D5_OLD_SITE = "gateway/actions.ts:update:invoices";

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

// ── 5 — the D5 semantic separation is now enforced ──────────────────────────
const GATEWAY = readFileSync(join(ROOT, "gateway/actions.ts"), "utf-8");
const sendBody = GATEWAY.slice(GATEWAY.indexOf("export async function sendInvoiceToLine"));
check("C1 D5 resolved: the send path no longer mutates document status",
  !/\.from\("invoices"\)\s*\n?\s*\.update\(/.test(sendBody) && !sendBody.includes('invoice_status: "SENT", updated_at'),
  "gateway still updates invoice_status from the delivery path");
check("C2 delivery is recorded as EVIDENCE (line_events direction out)",
  sendBody.includes('.from("line_events").insert(') && sendBody.includes('direction: "out"') && sendBody.includes("document_id: invoiceId"));
check("C3 retry/idempotency reads delivery evidence, not document status",
  sendBody.includes('extracted->>document_id') && !sendBody.includes('if (invoice.invoice_status === "SENT")'),
  "retry guard still keyed on invoice_status");
check("C4 document lifecycle goes through the canonical authority (issueDocument)",
  sendBody.includes("await issueDocument({ document_kind: \"invoice\", document_id: invoiceId, actor })"));
check("C5 issuance happens BEFORE transport (a delivery failure cannot roll it back)",
  sendBody.indexOf("await issueDocument(") < sendBody.indexOf("await sendLineMessage("));

// ── 6 — negative controls NC1–NC8 (owner list) ──────────────────────────────
// NC1–NC3 probes are assembled by concatenation so this test's own text is never
// a census hit (same rule as the resolver probes; no path exclusion anywhere).
const NC1 = census.findDirectMutations({ root: ROOT, table: "invoices", dirs: DIRS });
check("NC1 a direct invoices mutation outside authority is DETECTED",
  census.findMutationSitesInSource("await db.from(" + '"invoices").insert({ invoice_no: "x" })', "services/rogue.ts", "invoices").length === 1
    && NC1.filter((s) => !s.file.startsWith(census.CANONICAL_WRITER_DIR)).length === 0);
check("NC2 a direct standalone_documents mutation is DETECTED",
  census.findMutationSitesInSource("await db.from(" + "'standalone_documents').update({}).eq('id', 1)", "services/rogue.ts", "standalone_documents").length === 1);
check("NC3 a direct document_groups writer is DETECTED",
  census.findMutationSitesInSource("await db.from(" + '"document_groups").insert({})', "services/rogue.ts", "document_groups").length === 1);

// NC4 — a second document creation authority: every canonical write to a document
// table must come from the two known writers (adding a third file fails this).
const canonicalDocWriters = [
  ...new Set([
    ...DIRS.flatMap((d) => DOC_TABLES.flatMap((t) => census.findDirectMutations({ root: ROOT, table: t, dirs: [d] })))
      .filter((s) => s.file.startsWith(census.CANONICAL_WRITER_DIR))
      .map((s) => s.file),
    ...repoDynamic.sites.map((s) => s.file),
  ]),
].sort();
check("NC4 the canonical document authority set is exactly the known writers",
  canonicalDocWriters.join(",") === "engines/canonical/artifact-write.ts,engines/canonical/document-write.ts,engines/canonical/transaction-write.ts",
  canonicalDocWriters.join(", "));

// NC5 — caller-controlled dynamic table (already proved by NC-C, re-asserted here)
check("NC5 caller-controlled dynamic table is never authority", NC_C.sites.length === 0 && NC_C.unresolved.length === 1);

// NC6 — client/AI actor spoof must be REJECTED (real runtime calls; both check the
// actor BEFORE any database access, so this stays offline and side-effect free).
void (async () => {
  const spoofDoc = await executeDocumentCreate({ document_type: "quotation", party_name: "x", net_amount: 1 }, "");
  const spoofSend = await sendInvoiceToLine("00000000-0000-0000-0000-000000000000", "");
  check("NC6 an empty (client-derived) actor is REJECTED by both entry points",
    spoofDoc.ok === false && String(spoofDoc.error).startsWith("AUDIT_ACTOR_REQUIRED")
      && spoofSend.ok === false && String(spoofSend.error).startsWith("AUDIT_ACTOR_REQUIRED"),
    `${spoofDoc.error} | ${spoofSend.error}`);
  const routesWithActor = ["app/api/chat/confirm/route.ts", "app/api/admin/invoices/[invoiceId]/send/route.ts"]
    .every((f) => readFileSync(join(ROOT, f), "utf-8").includes("auth.email"));
  check("NC6b callers pass the SERVER actor (auth.email), never a request-body actor",
    routesWithActor && !GATEWAY.includes("body.actor") && !GATEWAY.includes("payload.actor"));

  // NC7 / NC8 — provider delivery cannot own the lifecycle, and a failed delivery
  // cannot damage canonical state.
  check("NC7 the delivery path never sets document lifecycle state",
    !/invoice_status:\s*"SENT"/.test(sendBody.replace(/\/\/[^\n]*/g, "")));
  check("NC8 failure branch precedes the evidence write and performs no status change",
    sendBody.indexOf("if (!lineRes.success)") < sendBody.indexOf('.from("line_events").insert(')
      && !/status:\s*"(VOID|DRAFT)"/.test(sendBody));

  // NC9–NC14 (PHASE D/E) ─────────────────────────────────────────────────────
  const chatRoute = readFileSync(join(ROOT, "app/api/chat/confirm/route.ts"), "utf-8");
  const autoCreate = readFileSync(join(ROOT, "engines/jobs/auto-create.ts"), "utf-8");
  const writerSrc = readFileSync(join(ROOT, "engines/canonical/document-write.ts"), "utf-8");
  const txWriter = readFileSync(join(ROOT, "engines/canonical/transaction-write.ts"), "utf-8");
  const demo1 = readFileSync(join(ROOT, "scripts/demo-full-pipeline.ts"), "utf-8");

  // NC14c support (PHASE E): who calls the atomic primitive directly?
  const rpcCallers = ["app", "core", "engines", "services", "gateway", "supabase", "scripts"].flatMap((dir) => {
    const hits: string[] = [];
    const walkRpc = (rel: string): void => {
      let entries;
      try {
        entries = readdirSync(join(ROOT, rel), { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const child = `${rel}/${e.name}`;
        if (e.isDirectory()) {
          if (e.name === "node_modules" || e.name.startsWith(".")) continue;
          walkRpc(child);
          continue;
        }
        if (!e.name.endsWith(".ts") && !e.name.endsWith(".tsx")) continue;
        if (/\.rpc\(\s*["']confirm_invoice["']/.test(readFileSync(join(ROOT, child), "utf-8"))) hits.push(child);
      }
    };
    walkRpc(dir);
    return hits;
  });

  // NC9 — the existing causal ordering is preserved, not rearranged.
  check("NC9a preview → execute ordering kept (issueToken before dispatch, execute after confirm)",
    GATEWAY.indexOf("export async function previewDocumentCreate") < GATEWAY.indexOf("export async function executeDocumentCreate")
      && chatRoute.includes('mode: "execute"') && chatRoute.indexOf("requireAuth") < chatRoute.indexOf("dispatchAction"));
  check("NC9b auto-create ordering kept: transaction first, then event LINK, then TRANSITION",
    autoCreate.indexOf("await createTransaction(") < autoCreate.indexOf("await linkBusinessEventTransaction(")
      && autoCreate.indexOf("await linkBusinessEventTransaction(") < autoCreate.indexOf("await transitionBusinessEvent("));
  check("NC9c invoice send: issuance precedes transport (recorded in PHASE C, still true)",
    sendBody.indexOf("await issueDocument(") < sendBody.indexOf("await sendLineMessage("));

  // NC10 — an AI/provider result can never own document lifecycle state.
  check("NC10 no AI/provider module writes document lifecycle tables",
    DOC_TABLES.every((t) => census.findDirectMutations({ root: ROOT, table: t, dirs: DIRS })
      .filter((s) => !s.file.startsWith(census.CANONICAL_WRITER_DIR)).length === 0));
  check("NC10b the lifecycle writer accepts no provider identity",
    !/\bprovider\b|lineUserId|anthropic|openai|ollama|gemini|api\.line\.me/i.test(writerSrc.replace(/\/\/[^\n]*/g, "")));

  // NC11 — swapping the provider cannot change the document contract.
  check("NC11 the document contract is provider-free and outbound stays behind the one gateway",
    !/anthropic|openai|ollama|gemini|api\.line\.me/.test(writerSrc)
      && GATEWAY.includes('from "@/registry/communication"')
      && !/api\.line\.me/.test(GATEWAY));

  // NC12 — createTransaction now carries the real delivery_note field; QUOTED stays a
  // canonical workflow state reached by transition (not a new creation-time state).
  check("NC12a createTransaction accepts and writes delivery_note (real nullable column)",
    txWriter.includes("delivery_note?: string | null") && txWriter.includes("delivery_note: ctx.delivery_note ?? null"));
  check("NC12b QUOTED is reached through the canonical transition, not invented at creation",
    demo1.includes('await changeTransactionStatus({ order_id: order.id, status: "QUOTED"')
      && !demo1.slice(demo1.indexOf("await createTransaction("), demo1.indexOf("await changeTransactionStatus(")).includes("QUOTED"));

  // NC13 — demo-only data must not expand the production contract.
  check("NC13 the canonical contract still has no recipient_address (demo folded it into notes)",
    !writerSrc.includes("recipient_address") && demo1.includes("ที่อยู่ผู้รับ: ${CUSTOMER_GPS.address}"));

  // NC14 / PHASE E — the invoice atomic primitive is now UNDER the canonical
  // authority: exactly one creation entry, and the RPC is reachable only from it.
  const invoiceItemsMigration = readFileSync(join(ROOT, "supabase/migrations/20260717000003_invoice_items.sql"), "utf-8");
  check("NC14a the pre-promotion RPC definition is intact in migration history",
    invoiceItemsMigration.includes("create or replace function public.confirm_invoice("));
  const promotedMigration = readFileSync(join(ROOT, "supabase/migrations/20260923000004_canonical_document_atomic_v1_1.sql"), "utf-8");
  check("NC14b the promotion keeps one function (old signature dropped, history untouched)",
    promotedMigration.includes("drop function if exists public.confirm_invoice(")
      && promotedMigration.includes("create or replace function public.confirm_invoice(")
      && promotedMigration.includes("document_versions"));
  check("NC14c the canonical writer is the ONLY caller of the atomic primitive",
    rpcCallers.length === 1 && rpcCallers[0] === "engines/canonical/document-write.ts");
  check("NC14d the invoice path is the RPC (atomic), not the compensating write",
    writerSrc.indexOf("db.rpc(\"confirm_invoice\"") > 0
      && writerSrc.indexOf("db.rpc(\"confirm_invoice\"") < writerSrc.indexOf("rollbackPartialDocument(")
      && writerSrc.includes('if (input.kind === "invoice")'));
  check("NC14e the compensating rollback survives only for the standalone path (reported, not hidden)",
    writerSrc.includes("STANDALONE_DOCUMENT: same TS path as before"));
  check("NC14f the RPC never recomputes money (totals arrive from the TS ladder)",
    !/round\(|percentile|sum\(/i.test(promotedMigration.match(/as \$\$[\s\S]*?\$\$;/)?.[0] ?? ""));
  check("NC14g the RPC writes the initial version inside the same transaction",
    promotedMigration.indexOf("insert into public.document_versions") < promotedMigration.indexOf("return jsonb_build_object"));

  console.log(`\nDOCUMENT_OUTSIDE_WRITES_NOW = ${Object.values(DECLARED_OUTSIDE).reduce((a, b) => a + b.length, 0)} declared sites remaining`);
  console.log(`D5_OLD_SITE = ${D5_OLD_SITE} — RESOLVED (document state ≠ delivery state)`);
  console.log(`INVOICE_ATOMICITY = promoted into canonical authority (migration 20260923000004, APPLY = NO — local proof only)`);

  console.log(`\n${checks - failures}/${checks} passed`);
  if (failures > 0) {
    console.log(`${failures} FAILED`);
    process.exit(1);
  }
})();
