/**
 * RLS RECURSION FIX — BACKUP + ROLLBACK REHEARSAL (local, disposable)
 *
 * พิสูจน์แผนก่อน apply `20261019000001_org_members_rls_recursion_fix.sql`:
 *   R1 PRE-CHANGE BACKUP  pg_dump (schema+data) ก่อนแก้ → restore ลง DB ที่สอง
 *                         แล้วเทียบจำนวนแถว org/organizations/companies
 *   R2 OLD STATE           policy เดิม (V1) ทำให้เกิด 42P17 จริงบน DB ทดสอบ
 *   R3 FIX                 apply migration ที่เตรียมไว้ → matrix ผู้ใช้ A/B/C/admin
 *                         (อ่าน/เขียน/ข้ามองค์กร/anon/no-claims) ผ่านครบ
 *   R4 ROLLBACK            apply ไฟล์ supabase/rollback/...rollback.sql → helper หาย,
 *                         policy เดิมกลับมา, ข้อมูลไม่หาย และยืนยันว่ารัฐที่ถอยกลับ
 *                         ยัง recursion (คือ \"ไม่ใช่สถานะที่ใช้งานได้\" ตามที่เขียนไว้)
 *   R5 NO DATA LOSS        นับแถวก่อน/หลังทั้ง fix และ rollback เท่าเดิม
 *
 * ใช้ PostgreSQL ชั่วคราวในเครื่อง (initdb ใน temp dir) — ไม่แตะ production,
 * ไม่ใช้ service role แทนสิทธิ์ผู้ใช้, ไม่มีข้อมูลจริง.
 *
 * Run: npx tsx scripts/rls-recursion-fix-rehearsal.ts
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO = path.resolve(__dirname, "..");
const MIGRATION = path.join(REPO, "supabase/migrations/20261019000001_org_members_rls_recursion_fix.sql");
const ROLLBACK = path.join(REPO, "supabase/rollback/20261019000001_org_members_rls_recursion_fix_rollback.sql");

let pass = 0;
let fail = 0;
function ck(id: string, ok: boolean, label: string, detail = "") {
  if (ok) { pass++; console.log(`PASS [${id}] ${label}`); }
  else { fail++; console.log(`FAIL [${id}] ${label}${detail ? ` — ${detail}` : ""}`); }
}

// ── fixtures: จำลอง JWT ของผู้ใช้จริง 3 คน + admin ของ A ──
const orgA = "11111111-1111-4111-8111-111111111111";
const orgB = "22222222-2222-4222-8222-222222222222";
const userA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";   // owner ของ A
const adminA = "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1";  // admin ของ A
const userB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";   // owner ของ B
const userC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";   // ไม่มี membership
const compA = "1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a";
const compB = "2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b";

/** Minimal schema ที่มีเฉพาะ object ที่ migration แตะ + tenant_has_membership ของ V2 */
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
alter table public.organizations enable row level security;
alter table public.org_members enable row level security;
alter table public.companies enable row level security;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
create or replace function public.tenant_has_membership(org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.org_members where user_id = auth.uid() and organization_id = org);
$$;
revoke all on function public.tenant_has_membership(uuid) from anon, public;
grant execute on function public.tenant_has_membership(uuid) to authenticated;
`;

const FIXTURES = `
insert into auth.users (id) values ('${userA}'), ('${adminA}'), ('${userB}'), ('${userC}');
insert into public.organizations (id, name, created_by) values
 ('${orgA}', 'Org A', '${userA}'),
 ('${orgB}', 'Org B', '${userB}');
insert into public.org_members (organization_id, user_id, role) values
 ('${orgA}', '${userA}', 'owner'),
 ('${orgA}', '${adminA}', 'admin'),
 ('${orgB}', '${userB}', 'owner');
insert into public.companies (id, name, organization_id) values
 ('${compA}', 'Company A', '${orgA}'),
 ('${compB}', 'Company B', '${orgB}');
`;

/** policy เดิมจาก 20261018000001_tenant_core_v1.sql (เฉพาะคู่ที่ทำให้เกิด recursion) */
const V1_RECURSIVE = `
create policy organizations_select_member_only
  on public.organizations for select
  using (exists (select 1 from public.org_members m where m.organization_id = organizations.id and m.user_id = auth.uid()));
create policy org_members_select_own_or_staff
  on public.org_members for select
  using (
    user_id = auth.uid()
    or exists (select 1 from public.org_members m
               where m.organization_id = org_members.organization_id
                 and m.user_id = auth.uid() and m.role in ('owner','admin'))
  );
`;

async function main() {
  const bin = (name: string) => {
    const out = spawnSync("which", [name], { encoding: "utf8" }).stdout?.trim();
    if (!out) throw new Error(`ไม่พบ ${name} ใน PATH`);
    return out;
  };
  const INITDB = bin("initdb"), PGCTL = bin("pg_ctl"), PSQL = bin("psql");
  const PG_DUMP = bin("pg_dump"), PG_RESTORE = bin("pg_restore");

  const port = await new Promise<number>((res, rej) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", rej);
    srv.listen(0, () => { const p = (srv.address() as { port: number }).port; srv.close(() => res(p)); });
  });
  const work = mkdtempSync(path.join(tmpdir(), "rls-rehearsal-"));
  const PGDATA = path.join(work, "data");
  mkdirSync(PGDATA, { recursive: true });
  execFileSync(INITDB, ["-U", "postgres", "--auth=trust", "--encoding=UTF8", "-D", PGDATA], { stdio: "pipe" });
  execFileSync(PGCTL, ["-o", `-p ${port}`, "-D", PGDATA, "-l", path.join(work, "server.log"), "start"], { stdio: "pipe" });

  const base = ["-U", "postgres", "-p", String(port), "-h", "127.0.0.1", "-v", "ON_ERROR_STOP=1", "-q", "-tA"];
  const sql = (db: string, q: string, mustSucceed = true) => {
    const r = spawnSync(PSQL, [...base, "-d", db], { input: q, encoding: "utf8" });
    if (r.status !== 0 && mustSucceed) throw new Error(`SQL FAIL: ${(r.stderr ?? "").slice(0, 900)}`);
    return { status: r.status ?? 1, out: (r.stdout ?? "").trim(), err: r.stderr ?? "" };
  };
  const val = (q: string, fallback = "") => {
    const r = sql("postgres", q, false);
    return r.status === 0 ? (r.out.split("\n").filter(Boolean).pop() ?? fallback) : fallback;
  };
  const asUser = (uid: string, q: string) =>
    spawnSync(PSQL, [...base, "-d", "rls_rehearsal"], {
      input: `set role authenticated; set request.jwt.claims = '{"sub":"${uid}"}'; ${q}`,
      encoding: "utf8",
    });
  const asAnon = (q: string) =>
    spawnSync(PSQL, [...base, "-d", "rls_rehearsal"], { input: `set role anon; ${q}`, encoding: "utf8" });
  /** sql() returns `out`; spawnSync returns `stdout` — accept both. */
  const last = (r: { stdout?: string | null; out?: string }) => ((r.out ?? r.stdout) ?? "").trim().split("\n").filter(Boolean).pop() ?? "";
  const expect = (id: string, label: string, r: { stdout?: string | null; out?: string }, want: string) => {
    const got = last(r);
    ck(id, got === want, label, `expected [${want}] got [${got}]`);
  };

  try {
    execFileSync(PSQL, [...base, "-d", "postgres", "-c", "create database rls_rehearsal"], { stdio: "pipe" });
    sql("rls_rehearsal", BOOTSTRAP);
    sql("rls_rehearsal", FIXTURES);

    // ── R2: old recursive state really fails ──
    sql("rls_rehearsal", V1_RECURSIVE);
    const oldRead = asUser(userA, "select count(*) from public.org_members;");
    ck("R2.1", oldRead.status !== 0 && /infinite recursion/.test(oldRead.stderr ?? ""),
      "old V1 policy reproduces 42P17 infinite recursion", (oldRead.stderr ?? "").slice(-160));

    // ── R1: pre-change backup → restore into a second database ──
    const dumpFile = path.join(work, "prechange.dump");
    execFileSync(PG_DUMP, ["-U", "postgres", "-p", String(port), "-h", "127.0.0.1", "-Fc", "-f", dumpFile, "rls_rehearsal"], { stdio: "pipe" });
    const dumpBytes = statSync(dumpFile).size;
    execFileSync(PSQL, [...base, "-d", "postgres", "-c", "create database rls_restore"], { stdio: "pipe" });
    execFileSync(PG_RESTORE, ["-U", "postgres", "-p", String(port), "-h", "127.0.0.1", "-d", "rls_restore", dumpFile], { stdio: "pipe" });
    const restored = sql("rls_restore", "select (select count(*) from organizations)||'/'||(select count(*) from org_members)||'/'||(select count(*) from companies);").out;
    ck("R1.1", dumpBytes > 0 && restored === "2/3/2", "pre-change pg_dump restored row-for-row (2 orgs / 3 members / 2 companies)", `bytes=${dumpBytes} rows=${restored}`);

    // ── R3: apply prepared fix, JWT matrix ──
    sql("rls_rehearsal", readFileSync(MIGRATION, "utf8"));
    expect("R3.1", "A reads own organization (1)", asUser(userA, "select count(*) from public.organizations;"), "1");
    expect("R3.2", "A cannot read organization B (0)", asUser(userA, `select count(*) from public.organizations where id='${orgB}';`), "0");
    expect("R3.3", "B reads own organization (1)", asUser(userB, `select count(*) from public.organizations where id='${orgB}';`), "1");
    expect("R3.4", "B cannot read organization A (0)", asUser(userB, `select count(*) from public.organizations where id='${orgA}';`), "0");
    expect("R3.5", "C (no membership) reads no organization (0)", asUser(userC, "select count(*) from public.organizations;"), "0");
    expect("R3.6", "A reads own org membership rows (2)", asUser(userA, "select count(*) from public.org_members;"), "2");
    expect("R3.7", "A cannot read B's memberships (0)", asUser(userA, `select count(*) from public.org_members where organization_id='${orgB}';`), "0");
    expect("R3.8", "C reads no memberships (0)", asUser(userC, "select count(*) from public.org_members;"), "0");
    expect("R3.9", "A reads own company (1)", asUser(userA, "select count(*) from public.companies;"), "1");
    expect("R3.10", "A cannot read B's company (0)", asUser(userA, `select count(*) from public.companies where id='${compB}';`), "0");
    expect("R3.11", "B cannot read A's company (0)", asUser(userB, `select count(*) from public.companies where id='${compA}';`), "0");
    expect("R3.12", "C reads no company (0)", asUser(userC, "select count(*) from public.companies;"), "0");
    expect("R3.13", "admin A cannot update organization B (0)", asUser(adminA, `with x as (update public.organizations set name=name where id='${orgB}' returning 1) select count(*) from x;`), "0");
    expect("R3.14", "admin A can update organization A (1)", asUser(adminA, `with x as (update public.organizations set name=name where id='${orgA}' returning 1) select count(*) from x;`), "1");
    expect("R3.15", "admin A cannot rewrite owner membership (0)", asUser(adminA, `with x as (update public.org_members set role='member' where organization_id='${orgA}' and user_id='${userA}' returning 1) select count(*) from x;`), "0");
    expect("R3.16", "owner A can update its admin membership (1)", asUser(userA, `with x as (update public.org_members set role=role where organization_id='${orgA}' and user_id='${adminA}' returning 1) select count(*) from x;`), "1");
    expect("R3.17", "admin A adds user C to org A (1)", asUser(adminA, `with x as (insert into public.org_members(organization_id,user_id,role) values ('${orgA}','${userC}','member') returning 1) select count(*) from x;`), "1");
    const crossInsert = asUser(adminA, `insert into public.org_members(organization_id,user_id,role) values ('${orgB}','${userC}','member');`);
    ck("R3.18", crossInsert.status !== 0 && /row-level security/.test(crossInsert.stderr ?? ""), "admin A cannot add a member to organization B (RLS denied)", (crossInsert.stderr ?? "").slice(-120));
    expect("R3.19", "owner A removes user C from org A (1)", asUser(userA, `with x as (delete from public.org_members where organization_id='${orgA}' and user_id='${userC}' returning 1) select count(*) from x;`), "1");
    expect("R3.20", "tenant_has_membership(A,A)=true", asUser(userA, `select public.tenant_has_membership('${orgA}');`), "t");
    expect("R3.21", "tenant_has_membership(A,B)=false", asUser(userA, `select public.tenant_has_membership('${orgB}');`), "f");
    expect("R3.22", "anonymous reads no organizations (0)", asAnon("select count(*) from public.organizations;"), "0");
    expect("R3.23", "anonymous reads no memberships (0)", asAnon("select count(*) from public.org_members;"), "0");
    expect("R3.24", "authenticated without claims reads nothing (0)", spawnSync(PSQL, [...base, "-d", "rls_rehearsal"], { input: "set role authenticated; select count(*) from public.organizations;", encoding: "utf8" }), "0");
    expect("R3.25", "no org_members policy selects org_members (0)", sql("rls_rehearsal", "select count(*) from pg_policies where tablename='org_members' and qual like '%FROM public.org_members%';"), "0");
    expect("R3.26", "org_members has 4 policies", sql("rls_rehearsal", "select count(*) from pg_policies where tablename='org_members';"), "4");
    expect("R3.27", "organizations has 2 policies", sql("rls_rehearsal", "select count(*) from pg_policies where tablename='organizations';"), "2");
    expect("R3.28", "fix does not grant service_role", sql("rls_rehearsal", "select count(*) from pg_policies where 'service_role' = any(roles) and tablename in ('organizations','org_members','companies');"), "0");
    expect("R3.29", "rows unchanged after fix (2/3/2)", sql("rls_rehearsal", "select (select count(*) from organizations)||'/'||(select count(*) from org_members)||'/'||(select count(*) from companies);"), "2/3/2");

    // ── R4: rollback file restores prior state (and prior failure) ──
    sql("rls_rehearsal", readFileSync(ROLLBACK, "utf8"));
    expect("R4.1", "fix helpers removed (0)", sql("rls_rehearsal", "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('tenant_is_org_member','tenant_is_org_admin','tenant_is_org_owner');"), "0");
    expect("R4.2", "recursive org_members policy restored (1)", sql("rls_rehearsal", "select count(*) from pg_policies where tablename='org_members' and policyname='org_members_select_own_or_staff' and qual like '%org_members%';"), "1");
    const afterRollback = asUser(userA, "select count(*) from public.org_members;");
    ck("R4.3", afterRollback.status !== 0 && /infinite recursion/.test(afterRollback.stderr ?? ""), "rollback restores the 42P17 state (documented: not a working state)", (afterRollback.stderr ?? "").slice(-120));
    expect("R4.4", "rows unchanged after rollback (2/3/2)", sql("rls_rehearsal", "select (select count(*) from organizations)||'/'||(select count(*) from org_members)||'/'||(select count(*) from companies);"), "2/3/2");
    expect("R4.5", "backup still restorable after rollback (2/3/2)", sql("rls_restore", "select (select count(*) from organizations)||'/'||(select count(*) from org_members)||'/'||(select count(*) from companies);"), "2/3/2");
  } finally {
    try { execFileSync(PGCTL, ["-D", PGDATA, "stop", "-m", "immediate"], { stdio: "pipe" }); } catch { /* already stopped */ }
  }

  console.log(`\n═══ RLS BACKUP/ROLLBACK REHEARSAL: ${pass} PASS / ${fail} FAIL ═══`);
  console.log("local disposable database only — production untouched, no service-role used for user checks");
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(2);
});
