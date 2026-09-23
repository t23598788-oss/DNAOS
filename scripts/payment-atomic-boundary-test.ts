/**
 * B-04R2 — atomic payment commit boundary: structural checks + LOCAL database proof.
 *
 * Layers, and what each one honestly proves:
 *   1. STRUCTURAL (always runs): the migration carries the canonical security model
 *      (SECURITY DEFINER + explicit search_path + revoke from public/anon/authenticated +
 *      grant only to service_role), locks the receipt first and the target invoices in
 *      sorted id order, re-reads every monetary fact inside the transaction, refuses to
 *      take paid/outstanding/company/status from the caller, never clamps or re-routes
 *      money, and clears stale target ids on reallocation.
 *   2. WRITE PATH: the TypeScript canonical writer is the single runtime commit path and
 *      is deliberately NOT wired to the RPC yet — applying the migration and wiring the
 *      adapter must be one ordered release, otherwise the live confirm path would call a
 *      function that does not exist on the target database.
 *   3. LOCAL DATABASE PROOF (runs when a local Postgres with the canonical schema is
 *      reachable, else reported as NOT_EXECUTED): applies the migration locally and runs
 *      the functional invariants plus four real concurrency cases in SEPARATE sessions —
 *      C1 two confirms on one receipt, C2 two receipts on one invoice, C3 two reallocations
 *      of the same row, C4 rollback after a mid-transaction failure.
 *
 * It only ever talks to a local Postgres cluster; production is never touched.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");
const stripSqlComments = (src: string) => src.replace(/^[ \t]*--.*$/gm, "");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const MIGRATION = "supabase/migrations/20260923000001_canonical_payment_allocation_atomic_v1_1.sql";
const WRITER = "engines/canonical/payment-write.ts";
const LOCAL_DB = process.env.BOUNDARY_TEST_DB || "dna_os_local";

function psql(args: string[]): { code: number | null; out: string } {
  const r = spawnSync("psql", args, { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const q = (sql: string) => psql(["-d", LOCAL_DB, "-tAc", sql]).out.trim();

function testSqlStructure() {
  const raw = read(MIGRATION);
  const sql = stripSqlComments(raw);
  const flat = sql.replace(/\s+/g, " ");

  assert.ok(raw.includes("security definer"), "both functions must be SECURITY DEFINER");
  assert.ok(raw.includes("set search_path = public"), "every DEFINER function needs an explicit search_path");
  assert.ok(raw.includes("revoke all on function public.confirm_payment_allocation"), "PUBLIC execute must be revoked (confirm)");
  assert.ok(raw.includes("revoke all on function public.reallocate_payment_allocation"), "PUBLIC execute must be revoked (reallocate)");
  assert.ok(raw.includes("grant execute on function public.confirm_payment_allocation"), "service_role must be granted explicitly");
  assert.ok(raw.includes("pg_roles where rolname = 'service_role'"), "grants must be guarded for environments lacking Supabase roles");

  const receiptLocks = (sql.match(/from public\.receipt_documents rd[^;]{0,140}?for update/g) ?? []).length;
  assert.ok(receiptLocks >= 2, `both functions must lock the receipt row first (found ${receiptLocks})`);
  assert.ok(/where i\.id = any \(v_invoice_ids\) order by i\.id for update/.test(flat), "target invoices must be locked in sorted id order");
  assert.ok(/from public\.invoices i where i\.id = p_target_id for update/.test(flat), "reallocation must lock its destination invoice");

  for (const code of [
    "receipt_already_allocated", "receipt_total_exceeded", "overpayment_not_allowed", "company_mismatch",
    "invoice_void", "invoice_not_found", "receipt_amount_required", "receipt_not_eligible", "actor_required",
  ]) {
    assert.ok(sql.includes(code), `missing invariant error code: ${code}`);
  }

  for (const forbidden of ["least(amount", "greatest(0", "interest_penalty_portion"]) {
    assert.equal(sql.includes(forbidden), false, `the SQL must not clamp or re-route money (${forbidden})`);
  }

  const head = raw.slice(raw.indexOf("create or replace function public.confirm_payment_allocation"), raw.indexOf("returns jsonb"));
  for (const forbiddenParam of ["paid_amount", "outstanding", "company_id", "invoice_status"]) {
    assert.equal(head.includes(forbiddenParam), false, `RPC input must not carry ${forbiddenParam}`);
  }

  assert.ok(/invoice_id\s+= case when p_target_kind = 'invoice' then p_target_id else null end/.test(sql), "reallocation must clear stale invoice/standalone ids");
  assert.ok(/debt_event_id\s+= case when p_target_kind = 'debt_event' then p_target_id else null end/.test(sql), "reallocation must clear debt_event_id when moving to an invoice");
}

function testNotWiredAndCensus() {
  const writer = stripComments(read(WRITER));
  assert.equal(/\.rpc\(/.test(writer), false, "payment-write.ts must not call the RPC while it is unapplied");
  assert.ok(writer.includes("assertInvoiceAllocationAllowed(") && writer.includes("assertReceiptAllocationTotal("),
    "the application guards must stay as fail-fast validation");

  const dirs = ["app", "core", "engines", "services", "gateway", "scripts"];
  const writers: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(entry.name)) {
        const src = stripComments(readFileSync(join(ROOT, rel), "utf-8"));
        let idx = src.indexOf('from("payment_allocations")');
        while (idx !== -1) {
          if (/\.(insert|upsert|update|delete)\(/.test(src.slice(idx, idx + 160))) {
            writers.push(rel);
            break;
          }
          idx = src.indexOf('from("payment_allocations")', idx + 1);
        }
      }
    }
  };
  for (const d of dirs) walk(d);
  const unique = [...new Set(writers)];
  assert.deepEqual(unique, [WRITER], `exactly one runtime payment writer expected, got: ${unique.join(", ")}`);
  return unique;
}


// ── SQL fixtures (local database only) ───────────────────────────────────────

const FIXTURE = `
begin;
delete from public.payment_allocations where receipt_document_id::text like 'b3000000-%';
delete from public.debt_events where customer_company_id::text like 'c3000000-%';
delete from public.receipt_documents where id::text like 'b3000000-%';
delete from public.invoices where id::text like 'a3000000-%';
delete from public.debt_snapshots where customer_company_id::text like 'c3000000-%';
delete from public.companies where id::text like 'c3000000-%';
insert into public.companies (id,name,type,status,updated_at,is_individual) values
  ('c3000000-0000-4000-8000-000000000001','Boundary Co','CUSTOMER','ACTIVE',now(),false),
  ('c3000000-0000-4000-8000-000000000002','Boundary Co 2','CUSTOMER','ACTIVE',now(),false);
insert into public.invoices (id,invoice_no,customer_company_id,invoice_date,subtotal,vat_amount,total_amount,net_payable,invoice_status,updated_at) values
  ('a3000000-0000-4000-8000-000000000001','INV-B-1','c3000000-0000-4000-8000-000000000001',current_date,100000,0,100000,100000,'SENT',now()),
  ('a3000000-0000-4000-8000-000000000002','INV-B-2','c3000000-0000-4000-8000-000000000001',current_date,30000,0,30000,30000,'SENT',now()),
  ('a3000000-0000-4000-8000-000000000003','INV-B-3','c3000000-0000-4000-8000-000000000001',current_date,100000,0,100000,100000,'SENT',now()),
  ('a3000000-0000-4000-8000-000000000004','INV-B-VOID','c3000000-0000-4000-8000-000000000001',current_date,10000,0,10000,10000,'VOID',now()),
  ('a3000000-0000-4000-8000-000000000005','INV-B-OTHER','c3000000-0000-4000-8000-000000000002',current_date,50000,0,50000,50000,'SENT',now());
insert into public.debt_snapshots (customer_company_id,total_outstanding,collection_state,updated_at) values
  ('c3000000-0000-4000-8000-000000000001',100000,'CURRENT',now());
insert into public.debt_events (customer_company_id,event_type,amount,occurred_at,source)
  values ('c3000000-0000-4000-8000-000000000001','debt_started',100000,current_date,'boundary-test');
insert into public.receipt_documents (id,media_path,document_type,status,amount,customer_company_id,allocation_state) values
  ('b3000000-0000-4000-8000-000000000001','local:b1.jpg','transfer_slip','ai_read',40000,'c3000000-0000-4000-8000-000000000001','unallocated'),
  ('b3000000-0000-4000-8000-000000000002','local:b2.jpg','transfer_slip','ai_read',50000,'c3000000-0000-4000-8000-000000000001','unallocated'),
  ('b3000000-0000-4000-8000-000000000003','local:b3.jpg','other','ai_read',1000,'c3000000-0000-4000-8000-000000000001','unallocated'),
  ('b3000000-0000-4000-8000-000000000004','local:c1.jpg','transfer_slip','ai_read',100,'c3000000-0000-4000-8000-000000000001','unallocated'),
  ('b3000000-0000-4000-8000-000000000005','local:c2a.jpg','transfer_slip','ai_read',70000,'c3000000-0000-4000-8000-000000000001','unallocated'),
  ('b3000000-0000-4000-8000-000000000006','local:c2b.jpg','transfer_slip','ai_read',70000,'c3000000-0000-4000-8000-000000000001','unallocated'),
  ('b3000000-0000-4000-8000-000000000007','local:c3.jpg','transfer_slip','ai_read',40000,'c3000000-0000-4000-8000-000000000001','unallocated'),
  ('b3000000-0000-4000-8000-000000000008','local:c4.jpg','transfer_slip','ai_read',5000,'c3000000-0000-4000-8000-000000000001','unallocated'),
  ('b3000000-0000-4000-8000-000000000009','local:c4b.jpg','transfer_slip','ai_read',5000,'c3000000-0000-4000-8000-000000000001','unallocated');
commit;
`;


/** functional cases 1/2 — every case emits `CHECK <name> PASS` or `CHECK <name> FAIL <reason>` */
const FUNCTIONAL_CORE = `
do $$ begin
  perform public.confirm_payment_allocation('b3000000-0000-4000-8000-000000000001',
    '[{"target_kind":"invoice","target_id":"a3000000-0000-4000-8000-000000000001","allocation_kind":"principal","amount":40000}]'::jsonb,'t:actor',null);
  if (select paid_amount from public.invoice_payment_summary where invoice_id='a3000000-0000-4000-8000-000000000001') = 40000
     and (select derived_status from public.invoice_payment_summary where invoice_id='a3000000-0000-4000-8000-000000000001') = 'PARTIALLY_PAID'
  then raise notice 'CHECK happy_partial_invoice PASS';
  else raise notice 'CHECK happy_partial_invoice FAIL wrong projection'; end if;
exception when others then raise notice 'CHECK happy_partial_invoice FAIL %', sqlerrm; end $$;

do $$ declare v jsonb; begin
  v := public.confirm_payment_allocation('b3000000-0000-4000-8000-000000000007',
    '[{"target_kind":"anchor","allocation_kind":"principal","amount":40000}]'::jsonb,'t:anchor','receipt_received');
  if (select total_outstanding from public.debt_snapshots where customer_company_id='c3000000-0000-4000-8000-000000000001') = 60000
     and (v->>'receipt_allocation_state') = 'allocated'
  then raise notice 'CHECK anchor_ledger_projection PASS';
  else raise notice 'CHECK anchor_ledger_projection FAIL %', v; end if;
exception when others then raise notice 'CHECK anchor_ledger_projection FAIL %', sqlerrm; end $$;

do $$ declare v jsonb; begin
  v := public.reallocate_payment_allocation(
        (select id from public.payment_allocations where receipt_document_id='b3000000-0000-4000-8000-000000000007'),
        'invoice','a3000000-0000-4000-8000-000000000001',null,'t:realloc','move to INV-B-1');
  if (select count(*) from public.payment_allocations where receipt_document_id='b3000000-0000-4000-8000-000000000007'
        and invoice_id='a3000000-0000-4000-8000-000000000001' and debt_event_id is null) = 1
     and (select coalesce(sum(amount),0) from public.payment_allocations where receipt_document_id='b3000000-0000-4000-8000-000000000007') = 40000
  then raise notice 'CHECK realloc_anchor_to_invoice PASS';
  else raise notice 'CHECK realloc_anchor_to_invoice FAIL %', v; end if;
exception when others then raise notice 'CHECK realloc_anchor_to_invoice FAIL %', sqlerrm; end $$;
`;


/** functional cases 2/2 — refusal paths (all fail-closed with a deterministic code) */
const FUNCTIONAL_GUARD = `
do $$ begin
  perform public.confirm_payment_allocation('b3000000-0000-4000-8000-000000000001',
    '[{"target_kind":"invoice","target_id":"a3000000-0000-4000-8000-000000000001","allocation_kind":"principal","amount":1}]'::jsonb,'t:actor',null);
  raise notice 'CHECK receipt_already_allocated FAIL no error';
exception when others then
  if sqlerrm = 'receipt_already_allocated' then raise notice 'CHECK receipt_already_allocated PASS';
  else raise notice 'CHECK receipt_already_allocated FAIL %', sqlerrm; end if; end $$;

do $$ begin
  perform public.confirm_payment_allocation('b3000000-0000-4000-8000-000000000002',
    '[{"target_kind":"invoice","target_id":"a3000000-0000-4000-8000-000000000002","allocation_kind":"principal","amount":50000}]'::jsonb,'t:actor',null);
  raise notice 'CHECK overpayment_refused FAIL no error';
exception when others then
  if sqlerrm like 'overpayment_not_allowed%' then raise notice 'CHECK overpayment_refused PASS';
  else raise notice 'CHECK overpayment_refused FAIL %', sqlerrm; end if; end $$;

do $$ begin
  perform public.confirm_payment_allocation('b3000000-0000-4000-8000-000000000002',
    '[{"target_kind":"invoice","target_id":"a3000000-0000-4000-8000-000000000005","allocation_kind":"principal","amount":1000}]'::jsonb,'t:actor',null);
  raise notice 'CHECK company_mismatch_refused FAIL no error';
exception when others then
  if sqlerrm = 'company_mismatch' then raise notice 'CHECK company_mismatch_refused PASS';
  else raise notice 'CHECK company_mismatch_refused FAIL %', sqlerrm; end if; end $$;

do $$ begin
  perform public.confirm_payment_allocation('b3000000-0000-4000-8000-000000000002',
    '[{"target_kind":"invoice","target_id":"a3000000-0000-4000-8000-000000000004","allocation_kind":"principal","amount":1000}]'::jsonb,'t:actor',null);
  raise notice 'CHECK void_invoice_refused FAIL no error';
exception when others then
  if sqlerrm = 'invoice_void' then raise notice 'CHECK void_invoice_refused PASS';
  else raise notice 'CHECK void_invoice_refused FAIL %', sqlerrm; end if; end $$;

do $$ begin
  perform public.confirm_payment_allocation('b3000000-0000-4000-8000-000000000002',
    '[{"target_kind":"invoice","target_id":"a3000000-0000-4000-8000-000000000001","allocation_kind":"principal","amount":40000},
      {"target_kind":"invoice","target_id":"a3000000-0000-4000-8000-000000000002","allocation_kind":"principal","amount":20000}]'::jsonb,'t:actor',null);
  raise notice 'CHECK receipt_total_refused FAIL no error';
exception when others then
  if sqlerrm like 'receipt_total_exceeded%' then raise notice 'CHECK receipt_total_refused PASS';
  else raise notice 'CHECK receipt_total_refused FAIL %', sqlerrm; end if; end $$;

do $$ begin
  perform public.confirm_payment_allocation('b3000000-0000-4000-8000-000000000003',
    '[{"target_kind":"invoice","target_id":"a3000000-0000-4000-8000-000000000001","allocation_kind":"principal","amount":100}]'::jsonb,'t:actor',null);
  raise notice 'CHECK receipt_eligibility_refused FAIL no error';
exception when others then
  if sqlerrm = 'receipt_not_eligible' then raise notice 'CHECK receipt_eligibility_refused PASS';
  else raise notice 'CHECK receipt_eligibility_refused FAIL %', sqlerrm; end if; end $$;

do $$ begin
  perform public.confirm_payment_allocation('b3000000-0000-4000-8000-000000000002',
    '[{"target_kind":"invoice","target_id":"a3000000-0000-4000-8000-000000000001","allocation_kind":"principal","amount":1000}]'::jsonb, null, null);
  raise notice 'CHECK actor_required FAIL no error';
exception when others then
  if sqlerrm = 'actor_required' then raise notice 'CHECK actor_required PASS';
  else raise notice 'CHECK actor_required FAIL %', sqlerrm; end if; end $$;

do $$ begin
  perform public.reallocate_payment_allocation(
    (select id from public.payment_allocations where receipt_document_id='b3000000-0000-4000-8000-000000000007'),
    'invoice','a3000000-0000-4000-8000-000000000004',null,'t:realloc','void target');
  raise notice 'CHECK realloc_void_refused FAIL no error';
exception when others then
  if sqlerrm = 'invoice_void' then raise notice 'CHECK realloc_void_refused PASS';
  else raise notice 'CHECK realloc_void_refused FAIL %', sqlerrm; end if; end $$;

do $$ begin
  perform public.reallocate_payment_allocation(
    (select id from public.payment_allocations where receipt_document_id='b3000000-0000-4000-8000-000000000007'),
    'invoice','a3000000-0000-4000-8000-000000000001',null,'t:realloc','');
  raise notice 'CHECK realloc_reason_required FAIL no error';
exception when others then
  if sqlerrm = 'reallocation_reason_required' then raise notice 'CHECK realloc_reason_required PASS';
  else raise notice 'CHECK realloc_reason_required FAIL %', sqlerrm; end if; end $$;
`;


// ── concurrency sessions (separate psql processes; the loser blocks on FOR UPDATE) ──

const confirmSession = (receiptId: string, invoiceId: string, amount: number, tag: string, hold: number) => `
begin;
do $$ begin
  perform public.confirm_payment_allocation('${receiptId}',
    '[{"target_kind":"invoice","target_id":"${invoiceId}","allocation_kind":"principal","amount":${amount}}]'::jsonb,'${tag}',null);
  raise notice 'SESSION_${tag} -> SUCCESS';
exception when others then raise notice 'SESSION_${tag} -> %', sqlerrm; end $$;
${hold > 0 ? `select pg_sleep(${hold});` : ""}
commit;
`;

const reallocSession = (receiptId: string, invoiceId: string, tag: string, hold: number) => `
begin;
do $$ declare v jsonb; begin
  v := public.reallocate_payment_allocation(
        (select id from public.payment_allocations where receipt_document_id='${receiptId}' limit 1),
        'invoice','${invoiceId}',null,'${tag}','concurrency move');
  raise notice 'SESSION_${tag} -> target %', v->>'target_id';
exception when others then raise notice 'SESSION_${tag} -> %', sqlerrm; end $$;
${hold > 0 ? `select pg_sleep(${hold});` : ""}
commit;
`;

async function runPair(dir: string, tag: string, aSql: string, bSql: string) {
  const aFile = join(dir, `${tag}_a.sql`);
  const bFile = join(dir, `${tag}_b.sql`);
  writeFileSync(aFile, aSql);
  writeFileSync(bFile, bSql);
  const child = spawn("psql", ["-q", "-d", LOCAL_DB, "-f", aFile], { stdio: ["ignore", "pipe", "pipe"] });
  let aOut = "";
  child.stdout?.on("data", (d) => { aOut += String(d); });
  child.stderr?.on("data", (d) => { aOut += String(d); });
  await sleep(400); // let A take its locks first
  const b = psql(["-q", "-d", LOCAL_DB, "-f", bFile]);
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null) return resolve();
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* ignore */ } resolve(); }, 20000);
    child.on("close", () => { clearTimeout(timer); resolve(); });
  });
  return { a: aOut, b: b.out };
}


async function runLocalProof(): Promise<string> {
  const ping = psql(["-d", LOCAL_DB, "-tAc", "select 1"]);
  if (ping.code !== 0) return `NOT_EXECUTED (no local Postgres database "${LOCAL_DB}")`;
  const have = Number(q("select count(*) from information_schema.tables where table_schema='public' and table_name in ('receipt_documents','payment_allocations','invoices','debt_events','debt_snapshots','audit_logs')"));
  if (have < 6) return `NOT_EXECUTED (local "${LOCAL_DB}" has no canonical schema: ${have}/6 tables)`;

  const dir = mkdtempSync(join(tmpdir(), "b04r2-"));
  const apply = psql(["-d", LOCAL_DB, "-v", "ON_ERROR_STOP=1", "-f", join(ROOT, MIGRATION)]);
  assert.equal(apply.code, 0, `the migration must apply on the local database: ${apply.out.slice(0, 300)}`);

  const fixtureFile = join(dir, "fixture.sql");
  writeFileSync(fixtureFile, FIXTURE);
  const fx = psql(["-d", LOCAL_DB, "-v", "ON_ERROR_STOP=1", "-f", fixtureFile]);
  assert.equal(fx.code, 0, `the fixture must apply: ${fx.out.slice(0, 300)}`);

  const fnFile = join(dir, "functional.sql");
  writeFileSync(fnFile, FUNCTIONAL_CORE + FUNCTIONAL_GUARD);
  const fr = psql(["-d", LOCAL_DB, "-f", fnFile]);
  const checks = [...fr.out.matchAll(/CHECK ([\w_]+) (PASS|FAIL[^\n]*)/g)].map((m) => ({ name: m[1], ok: m[2].startsWith("PASS") }));
  assert.ok(checks.length >= 10, `the functional suite must report its checks (got ${checks.length}: ${fr.out.slice(0, 300)})`);
  const failed = checks.filter((c) => !c.ok);
  assert.deepEqual(failed.map((c) => c.name), [], `functional boundary checks failed: ${failed.map((c) => c.name).join(", ")}`);

  // C1 — two confirms of 70 against a 100 receipt (loser refused, total stays ≤ 100)
  const c1 = await runPair(dir, "c1",
    confirmSession("b3000000-0000-4000-8000-000000000004", "a3000000-0000-4000-8000-000000000003", 70, "C1_A", 1.5),
    confirmSession("b3000000-0000-4000-8000-000000000004", "a3000000-0000-4000-8000-000000000003", 70, "C1_B", 0));
  assert.ok(/SESSION_C1_A -> SUCCESS/.test(c1.a), `C1 session A should win: ${c1.a.slice(0, 200)}`);
  assert.ok(/SESSION_C1_B -> receipt_already_allocated/.test(c1.b), `C1 session B must be refused: ${c1.b.slice(0, 200)}`);
  const c1Total = Number(q("select coalesce(sum(amount),0) from public.payment_allocations where receipt_document_id='b3000000-0000-4000-8000-000000000004'"));
  assert.ok(c1Total <= 100, `C1 receipt total must stay ≤ 100, got ${c1Total}`);

  // C2 — two receipts of 70,000 against one 100,000 invoice (no overpayment)
  const c2 = await runPair(dir, "c2",
    confirmSession("b3000000-0000-4000-8000-000000000005", "a3000000-0000-4000-8000-000000000003", 70000, "C2_A", 1.5),
    confirmSession("b3000000-0000-4000-8000-000000000006", "a3000000-0000-4000-8000-000000000003", 70000, "C2_B", 0));
  assert.ok(/SESSION_C2_A -> SUCCESS/.test(c2.a), `C2 session A should win: ${c2.a.slice(0, 200)}`);
  assert.ok(/SESSION_C2_B -> overpayment_not_allowed/.test(c2.b), `C2 session B must be refused: ${c2.b.slice(0, 200)}`);
  const c2Paid = Number(q("select coalesce(paid_amount,0) from public.invoices where id='a3000000-0000-4000-8000-000000000003'"));
  assert.ok(c2Paid <= 100000, `C2 invoice paid must stay ≤ receivable, got ${c2Paid}`);


  // C3 — two reallocations of the SAME row: serialized by the row lock, total unchanged
  psql(["-q", "-d", LOCAL_DB, "-c",
    "select public.confirm_payment_allocation('b3000000-0000-4000-8000-000000000008','[{\"target_kind\":\"anchor\",\"allocation_kind\":\"principal\",\"amount\":5000}]'::jsonb,'t:c3seed','receipt_received')"]);
  const c3 = await runPair(dir, "c3",
    reallocSession("b3000000-0000-4000-8000-000000000008", "a3000000-0000-4000-8000-000000000001", "C3_A", 1.5),
    reallocSession("b3000000-0000-4000-8000-000000000008", "a3000000-0000-4000-8000-000000000002", "C3_B", 0));
  assert.ok(/SESSION_C3_A -> target/.test(c3.a) && /SESSION_C3_B -> target/.test(c3.b),
    `C3 both moves must complete in order: ${c3.a.slice(0, 160)} | ${c3.b.slice(0, 160)}`);
  const c3Rows = Number(q("select count(*) from public.payment_allocations where receipt_document_id='b3000000-0000-4000-8000-000000000008'"));
  const c3Total = Number(q("select coalesce(sum(amount),0) from public.payment_allocations where receipt_document_id='b3000000-0000-4000-8000-000000000008'"));
  const c3Single = Number(q("select count(*) from public.payment_allocations where receipt_document_id='b3000000-0000-4000-8000-000000000008' and num_nonnulls(invoice_id, standalone_document_id, debt_event_id) = 1"));
  assert.equal(c3Rows, 1, `C3 must leave exactly one row, got ${c3Rows}`);
  assert.equal(c3Single, 1, "C3 must leave exactly one target id");
  assert.equal(c3Total, 5000, `C3 must not change the receipt total, got ${c3Total}`);

  // C4 — a failure after the first insert must leave no partial state (one transaction)
  const c4Sql = `
do $$ begin
  perform public.confirm_payment_allocation('b3000000-0000-4000-8000-000000000009',
    '[{"target_kind":"invoice","target_id":"a3000000-0000-4000-8000-000000000001","allocation_kind":"principal","amount":2000},
      {"target_kind":"standalone_document","target_id":"ffffffff-ffff-4fff-8fff-ffffffffffff","allocation_kind":"principal","amount":3000}]'::jsonb,
    't:c4', null);
  raise notice 'SESSION_C4 -> NO ERROR (BAD)';
exception when others then raise notice 'SESSION_C4 -> %', sqlerrm; end $$;
`;
  const c4File = join(dir, "c4.sql");
  writeFileSync(c4File, c4Sql);
  const c4 = psql(["-q", "-d", LOCAL_DB, "-f", c4File]);
  assert.ok(/SESSION_C4 -> .*foreign key constraint/.test(c4.out), `C4 must fail on the FK: ${c4.out.slice(0, 220)}`);
  const c4Rows = Number(q("select count(*) from public.payment_allocations where receipt_document_id='b3000000-0000-4000-8000-000000000009'"));
  assert.equal(c4Rows, 0, `C4 must leave NO partial insert for that receipt, got ${c4Rows}`);
  const c4State = q("select allocation_state from public.receipt_documents where id='b3000000-0000-4000-8000-000000000009'");
  assert.equal(c4State, "unallocated", `C4 must leave the receipt allocation_state untouched, got ${c4State}`);

  return `PROVEN_LOCAL (${checks.length} functional checks + C1/C2/C3/C4 on "${LOCAL_DB}" · production untouched)`;
}

async function main() {
  testSqlStructure();
  const authorities = testNotWiredAndCensus();
  const local = await runLocalProof();

  console.log("payment-atomic-boundary:test PASS");
  console.log(
    `checks: security model (definer + search_path + revoke/grant) · lock order (receipt → sorted invoices) · A1-A9 + A11/A12 codes · no clamp/penalty · no client authority params · stale target ids cleared · writer intentionally UNWIRED · authority=${authorities.join(",")} (count=${authorities.length})`,
  );
  console.log(`local database proof = ${local}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

