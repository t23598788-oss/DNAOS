/**
 * DOCUMENT OWNERSHIP MODEL A — RLS REHEARSAL (local, disposable)
 *
 * Apply the prepared migrations on synthetic data and prove the four access
 * criteria with real PostgreSQL RLS + simulated JWTs (no service role):
 *   20261019000002 (additive columns) → 20261019000003 (model A policies)
 *
 * Requirements proven:
 *   1 seller reads its own documents (owner + admin of the issuer org)
 *   2 buyer reads ONLY documents explicitly granted to it
 *   3 buyer cannot see the seller's internal ledger (company_expenses)
 *   4 seller A cannot read seller B's documents
 *   + legacy rows with no issuer stay invisible to everyone (OWNERSHIP_UNKNOWN)
 *   + anon reads nothing; grants are issuer-managed (buyer cannot mint one)
 *   + rollback returns the previous policy shape without touching rows
 *
 * Run: npx tsx scripts/document-ownership-rls-rehearsal.ts
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO = path.resolve(__dirname, "..");
const M_COLUMNS = path.join(REPO, "supabase/migrations/20261019000002_document_issuer_ownership_proposal.sql");
const M_MODEL = path.join(REPO, "supabase/migrations/20261019000003_document_ownership_model_a.sql");
const RB_MODEL = path.join(REPO, "supabase/rollback/20261019000003_document_ownership_model_a_rollback.sql");

let pass = 0;
let fail = 0;
function ck(id: string, ok: boolean, label: string, detail = "") {
  if (ok) { pass++; console.log(`PASS [${id}] ${label}`); }
  else { fail++; console.log(`FAIL [${id}] ${label}${detail ? ` — ${detail}` : ""}`); }
}

const orgA = "aaaaaaaa-0000-4000-8000-000000000001";
const orgB = "bbbbbbbb-0000-4000-8000-000000000002";
const orgX = "cccccccc-0000-4000-8000-000000000003"; // buyer X's OWN tenant (never the seller's)
const orgY = "dddddddd-0000-4000-8000-000000000004"; // buyer Y's OWN tenant
const sellerA = "11111111-0000-4000-8000-0000000000a1";
const sellerB = "22222222-0000-4000-8000-0000000000b1";
const buyerX = "99999999-0000-4000-8000-0000000000c1";
const buyerY = "99999999-0000-4000-8000-0000000000c2";
const ownerA = "0a0a0a0a-0000-4000-8000-00000000000a";
const adminA = "0a0a0a0a-0000-4000-8000-0000000000a2";
const ownerB = "0b0b0b0b-0000-4000-8000-00000000000b";
const ownerX = "0c0c0c0c-0000-4000-8000-00000000000c";
const outsider = "0d0d0d0d-0000-4000-8000-00000000000d";

const D1 = "d1000000-0000-4000-8000-000000000001"; // A → X, granted to X
const D2 = "d2000000-0000-4000-8000-000000000002"; // A → Y, no grant
const D3 = "d3000000-0000-4000-8000-000000000003"; // B → X
const D4 = "d4000000-0000-4000-8000-000000000004"; // legacy, no issuer
const SD1 = "e1000000-0000-4000-8000-000000000001"; // standalone A → X, granted
const EXP = "f5000000-0000-4000-8000-0000000000e5"; // seller A internal expense

/** Supabase-shaped auth + only what these two migrations touch */
const BOOTSTRAP = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(
    current_setting('request.jwt.claim.sub', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb) ->> 'sub'
  ), '')::uuid;
$$;
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
create table if not exists public.org_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text,
  organization_id uuid references public.organizations(id)
);
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_no text,
  customer_company_id uuid references public.companies(id)
);
create table public.line_events (
  id uuid primary key default gen_random_uuid(),
  line_user_id text
);
create table public.conversation_states (id uuid primary key default gen_random_uuid());
create table public.standalone_documents (
  id uuid primary key default gen_random_uuid(),
  document_no text,
  customer_company_id uuid references public.companies(id),
  partner_company_id uuid references public.companies(id)
);
create table public.receipt_documents (
  id uuid primary key default gen_random_uuid(),
  customer_company_id uuid references public.companies(id),
  line_event_id uuid references public.line_events(id)
);
create table public.company_expenses (
  id uuid primary key default gen_random_uuid(),
  amount numeric,
  receipt_document_id uuid references public.receipt_documents(id)
);
alter table public.organizations enable row level security;
alter table public.org_members enable row level security;
alter table public.companies enable row level security;
alter table public.line_events enable row level security;
alter table public.invoices enable row level security;
alter table public.standalone_documents enable row level security;
alter table public.receipt_documents enable row level security;
alter table public.company_expenses enable row level security;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
-- V2 helper (already live) — membership decision, security definer
create or replace function public.tenant_has_membership(org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.org_members where user_id = auth.uid() and organization_id = org);
$$;
revoke all on function public.tenant_has_membership(uuid) from anon, public;
grant execute on function public.tenant_has_membership(uuid) to authenticated;
-- V2 line-identity helper (live) — required by the rollback's restored policy
create or replace function public.tenant_org_of_line_user(line_user text)
returns uuid language sql stable security definer set search_path = public as $$
  -- rehearsal fixture has no LINE identity links; the restored policy only needs
  -- the function to exist and be callable (returns null → fail-closed)
  select null::uuid;
$$;
revoke all on function public.tenant_org_of_line_user(text) from anon, public;
grant execute on function public.tenant_org_of_line_user(text) to authenticated;
-- V2's receipt policy shape (the one model A replaces, and rollback restores)
create policy tenant_line_scope_select on public.receipt_documents for select to authenticated
  using (exists (
    select 1 from public.line_events le
    where le.id = receipt_documents.line_event_id
      and public.tenant_has_membership(public.tenant_org_of_line_user(le.line_user_id))
  ));
-- V2's counterparty-side invoices policy (the shape being replaced)
create policy tenant_company_scope_select on public.invoices for select to authenticated
  using (exists (
    select 1 from public.companies cmp
    where cmp.id = invoices.customer_company_id
      and cmp.organization_id is not null
      and public.tenant_has_membership(cmp.organization_id)
  ));
`;

const SEED = `
insert into auth.users (id) values ('${ownerA}'),('${adminA}'),('${ownerB}'),('${ownerX}'),('${outsider}');
insert into public.organizations (id,name,created_by) values
 ('${orgA}','Seller A','${ownerA}'),('${orgB}','Seller B','${ownerB}'),
 ('${orgX}','Buyer X org','${ownerX}'),('${orgY}','Buyer Y org',null);
insert into public.org_members (organization_id,user_id,role) values
 ('${orgA}','${ownerA}','owner'),('${orgA}','${adminA}','admin'),
 ('${orgB}','${ownerB}','owner'),
 ('${orgX}','${ownerX}','owner');
-- buyers stay in their OWN organizations — never moved into the seller's org
insert into public.companies (id,name,organization_id) values
 ('${sellerA}','Seller Co A','${orgA}'),
 ('${sellerB}','Seller Co B','${orgB}'),
 ('${buyerX}','Buyer Co X','${orgX}'),
 ('${buyerY}','Buyer Co Y','${orgY}');
insert into public.invoices (id,invoice_no,customer_company_id) values
 ('${D1}','INV-A-1','${buyerX}'),
 ('${D2}','INV-A-2','${buyerY}'),
 ('${D3}','INV-B-1','${buyerX}'),
 ('${D4}','INV-LEGACY','${buyerX}');
insert into public.standalone_documents (id,document_no,customer_company_id) values ('${SD1}','DOC-A-1','${buyerX}');
insert into public.receipt_documents (id,customer_company_id) values ('d5000000-0000-4000-8000-000000000005','${sellerA}');
insert into public.company_expenses (id,amount,receipt_document_id) values ('${EXP}',1750,'d5000000-0000-4000-8000-000000000005');
`;

/** issuers + one explicit grant (what an approved writer would stamp) */
const STAMP = `
update public.invoices set issuer_company_id='${sellerA}' where id in ('${D1}','${D2}');
update public.invoices set issuer_company_id='${sellerB}' where id='${D3}';
update public.standalone_documents set issuer_company_id='${sellerA}' where id='${SD1}';
insert into public.document_recipient_grants(document_id,recipient_company_id) values
 ('${D1}','${buyerX}'), ('${SD1}','${buyerX}');
`;

async function main() {
  const bin = (name: string) => {
    const out = spawnSync("which", [name], { encoding: "utf8" }).stdout?.trim();
    if (!out) throw new Error(`ไม่พบ ${name} ใน PATH`);
    return out;
  };
  const INITDB = bin("initdb"), PGCTL = bin("pg_ctl"), PSQL = bin("psql");
  const port = await new Promise<number>((res, rej) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", rej);
    srv.listen(0, () => { const p = (srv.address() as { port: number }).port; srv.close(() => res(p)); });
  });
  const work = mkdtempSync(path.join(tmpdir(), "doc-model-a-"));
  const PGDATA = path.join(work, "data");
  mkdirSync(PGDATA, { recursive: true });
  execFileSync(INITDB, ["-U", "postgres", "--auth=trust", "--encoding=UTF8", "-D", PGDATA], { stdio: "pipe" });
  execFileSync(PGCTL, ["-o", `-p ${port}`, "-D", PGDATA, "-l", path.join(work, "server.log"), "start"], { stdio: "pipe" });

  const conn = ["-U", "postgres", "-p", String(port), "-h", "127.0.0.1", "-d", "docmodel", "-v", "ON_ERROR_STOP=1", "-q", "-tA"];
  const run = (q: string, mustSucceed = true) => {
    const r = spawnSync(PSQL, conn, { input: q, encoding: "utf8" });
    if (r.status !== 0 && mustSucceed) throw new Error(`SQL FAIL: ${(r.stderr ?? "").slice(0, 900)}`);
    return r;
  };
  const asUser = (uid: string, q: string) =>
    spawnSync(PSQL, conn, { input: `set role authenticated; set request.jwt.claims = '{"sub":"${uid}"}'; ${q}`, encoding: "utf8" });
  const asAnon = (q: string) => spawnSync(PSQL, conn, { input: `set role anon; ${q}`, encoding: "utf8" });
  /** anon has no table privilege at all: permission denied IS the pass condition. */
  const anonAccess = (q: string) => {
    const r = asAnon(q);
    if (r.status !== 0) return /permission denied|row-level security/.test(r.stderr ?? "") ? "denied" : "error";
    return valStd(r);
  };
  const val = (r: { stdout?: string | null }) => (r.stdout ?? "").trim().split("\n").filter(Boolean).pop() ?? "";
  const valStd = val;
  // (anonAccess is defined above and uses valStd — keep the order explicit)
  const expect = (id: string, label: string, r: { stdout?: string | null }, want: string) =>
    ck(id, val(r) === want, label, `expected [${want}] got [${val(r)}]`);

  try {
    execFileSync(PSQL, ["-U", "postgres", "-p", String(port), "-h", "127.0.0.1", "-d", "postgres", "-c", "create database docmodel"], { stdio: "pipe" });
    run(BOOTSTRAP);
    run(SEED);

    // pre-change state: V2 counterparty policy leaks A's doc to a mapped buyer only;
    // with unmapped buyers nobody sees anything — that is the ORG_UNMAPPED state.
    expect("P.1", "pre-change: seller A sees none of its own invoices (counterparty-only rule)", asUser(ownerA, "select count(*) from public.invoices;"), "0");

    run(readFileSync(M_COLUMNS, "utf8"));
    run(readFileSync(M_MODEL, "utf8"));
    ck("P.2", true, "migrations 20261019000002 + 20261019000003 apply cleanly (ON_ERROR_STOP)");

    // stamp issuers AFTER the empty-grants assertion (grants must start empty)
    expect("M.1", "grants table starts empty (no grants minted by the migration)", run("select count(*) from public.document_recipient_grants;"), "0");
    run(STAMP);

    // ── 1: seller reads its own documents ──
    expect("1.1", "seller A sees exactly its own 2 invoices (D1,D2)", asUser(ownerA, "select count(*) from public.invoices;"), "2");
    expect("1.2", "seller A's admin sees the same 2", asUser(adminA, "select count(*) from public.invoices;"), "2");
    expect("1.3", "seller A sees its own standalone document", asUser(ownerA, "select count(*) from public.standalone_documents;"), "1");

    // ── 4: seller isolation ──
    expect("4.1", "seller A cannot see seller B's invoice (D3)", asUser(ownerA, `select count(*) from public.invoices where id='${D3}';`), "0");
    expect("4.2", "seller B cannot see seller A's invoices", asUser(ownerB, `select count(*) from public.invoices where id in ('${D1}','${D2}');`), "0");
    expect("4.3", "seller B sees only its own invoice", asUser(ownerB, "select count(*) from public.invoices;"), "1");

    // ── legacy ──
    expect("L.1", "legacy invoice with no issuer (D4) is invisible to the issuer org", asUser(ownerA, `select count(*) from public.invoices where id='${D4}';`), "0");
    expect("L.2", "legacy invoice (D4) is invisible to any buyer", asUser(ownerX, `select count(*) from public.invoices where id='${D4}';`), "0");

    // ── 2: buyer sees only the granted document ──
    expect("2.1", "buyer X sees exactly the 1 invoice granted to it", asUser(ownerX, "select count(*) from public.invoices;"), "1");
    expect("2.2", "buyer X sees the granted invoice D1", asUser(ownerX, `select count(*) from public.invoices where id='${D1}';`), "1");
    expect("2.3", "buyer X cannot see the ungranted D2", asUser(ownerX, `select count(*) from public.invoices where id='${D2}';`), "0");
    expect("2.4", "buyer X cannot see seller B's invoice D3", asUser(ownerX, `select count(*) from public.invoices where id='${D3}';`), "0");
    expect("2.5", "buyer X sees the granted standalone document", asUser(ownerX, "select count(*) from public.standalone_documents;"), "1");

    // ── 3: buyer cannot see the seller's internal ledger ──
    expect("3.1", "buyer X reads no company_expenses", asUser(ownerX, "select count(*) from public.company_expenses;"), "0");
    expect("3.2", "buyer X reads no receipt_documents", asUser(ownerX, "select count(*) from public.receipt_documents;"), "0");
    expect("3.3", "seller A reads its own expense", asUser(ownerA, "select count(*) from public.company_expenses;"), "1");

    // ── grants are issuer-managed ──
    expect("G.1", "buyer X cannot mint a grant for itself", (() => {
      const r = asUser(ownerX, `insert into public.document_recipient_grants(document_id,recipient_company_id) values ('${D2}','${buyerX}');`);
      return { stdout: r.status === 0 ? "allowed" : /row-level security/.test(r.stderr ?? "") ? "denied" : "other" };
    })(), "denied");
    expect("G.2", "issuer can grant its own document (D2 → X)", asUser(ownerA, `with x as (insert into public.document_recipient_grants(document_id,recipient_company_id) values ('${D2}','${buyerX}') returning 1) select count(*) from x;`), "1");
    expect("G.3", "issuer cannot grant another org's document (D3)", (() => {
      const r = asUser(ownerA, `insert into public.document_recipient_grants(document_id,recipient_company_id) values ('${D3}','${buyerX}');`);
      return { stdout: r.status === 0 ? "allowed" : /row-level security/.test(r.stderr ?? "") ? "denied" : "other" };
    })(), "denied");

    // ── anon / outsider ──
    expect("S.1", "anon reads no invoices", asAnon("select count(*) from public.invoices;"), "0");
    expect("S.2", "anon has no access to grants at all", { stdout: anonAccess("select count(*) from public.document_recipient_grants;") }, "denied");
    expect("S.3", "authenticated user with no membership reads no invoices", asUser(outsider, "select count(*) from public.invoices;"), "0");
    expect("S.4", "no grant policy targets anon", run("select count(*) from pg_policies where tablename='document_recipient_grants' and 'anon' = any(roles);"), "0");

    // ── rollback ──
    run(readFileSync(RB_MODEL, "utf8"));
    expect("R.1", "rollback: grants table removed", run("select count(*) from information_schema.tables where table_schema='public' and table_name='document_recipient_grants';"), "0");
    expect("R.2", "rollback: issuer helpers removed", run("select count(*) from pg_proc where proname like 'tenant_is_%_issuer' or proname like 'tenant_is_%_recipient';"), "0");
    expect("R.3", "rollback: V2 counterparty policy restored", run("select count(*) from pg_policies where tablename='invoices' and policyname='tenant_company_scope_select';"), "1");
    expect("R.4", "rollback: invoice rows untouched (4)", run("select count(*) from public.invoices;"), "4");
    expect("R.5", "rollback: issuer columns kept (owned by 20261019000002)", run("select count(*) from information_schema.columns where table_name='invoices' and column_name='issuer_company_id';"), "1");
  } finally {
    try { execFileSync(PGCTL, ["-D", PGDATA, "stop", "-m", "immediate"], { stdio: "pipe" }); } catch { /* already stopped */ }
  }

  console.log(`\n═══ DOCUMENT MODEL A RLS: ${pass} PASS / ${fail} FAIL ═══`);
  console.log("disposable local database with synthetic rows — production documents untouched, nothing backfilled");
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(2);
});
