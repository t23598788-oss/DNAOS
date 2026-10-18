/**
 * STEP 5 — MIGRATION ORDER + ROLLBACK VERIFICATION (local Postgres, disposable)
 *
 * พิสูจน์ "แผน migration และแผนถอย" ด้วยการรันจริงบนฐานข้อมูลชั่วคราวในเครื่อง:
 *   M1 migration order: full_schema → migrations ที่เกี่ยวข้อง → tenant V1 → V2 → V3
 *      apply ด้วย ON_ERROR_STOP (ผิดลำดับ/อ้างตารางที่ยังไม่มี = ล้มทันที)
 *   M2 additive compatibility: V1–V3 ไม่ DROP/ไม่แก้ชนิดคอลัมน์เดิม — เทียบ
 *      คอลัมน์ของตารางธุรกิจที่ V3 แตะก่อน/หลัง apply (จำนวนคอลัมน์ต้องเพิ่มเท่านั้น)
 *   M3 rollback: ถอยตามลำดับย้อนกลับ V3 → V2 → V1 (ไฟล์ supabase/rollback/*_rollback.sql)
 *      รันครบโดยไม่ error
 *   M4 หลังถอย: policy ของ tenant หายหมด · helper function หาย · คอลัมน์ organization_id
 *      ยังอยู่ (rollback ไม่ทำลาย mapping โดยอัตโนมัติ ตามที่เขียนไว้ในไฟล์)
 *   M5 ไม่มีข้อมูลถูกแตะ: นับแถว companies/invoices ก่อน–หลัง rollback เท่ากัน
 *
 * ไม่ apply production · ไม่แตะข้อมูลจริง · ใช้ SYNTH-* เท่านั้น
 * Run: npm run tenant-migration:test
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import path from "node:path";

const REPO = path.resolve(__dirname, "..");
const MIG = path.join(REPO, "supabase/migrations");
const RB = path.join(REPO, "supabase/rollback");
const LOCAL = path.join(REPO, "supabase/local-migration");

let pass = 0;
let fail = 0;
function ck(id: string, ok: boolean, label: string, detail = "") {
  if (ok) { pass++; console.log(`PASS [${id}] ${label}`); }
  else { fail++; console.log(`FAIL [${id}] ${label}${detail ? ` — ${detail}` : ""}`); }
}

const TENANT_MIGRATIONS = [
  "20261018000001_tenant_core_v1.sql",
  "20261018000002_tenant_org_scope_v2.sql",
  "20261018000003_tenant_org_binding_v3.sql",
];
const TENANT_ROLLBACKS = [
  "20261018000003_tenant_org_binding_v3_rollback.sql",
  "20261018000002_tenant_org_scope_v2_rollback.sql",
  "20261018000001_tenant_core_v1_rollback.sql",
];
const BASE_MIGRATIONS = [
  "20260622000003_conversation_state_and_entity_registry.sql",
  "20260706000002_conversation_states_new_project.sql",
  "20260720000001_line_events_realtime.sql",
  "20260922000001_canonical_foundation_v1_1.sql",
  "20260923000003_connect_external_identity.sql",
  "20260705000002_transaction_state_machine.sql",
  "20260804000004_storage_intelligence.sql",
  "20260804000011_file_existence_intelligence.sql",
  "20261008000000_resource_transactions_canonical.sql",
  "20261016000003_company_members_and_invites.sql",
];
/** ตารางที่ V3 เพิ่ม organization_id — ใช้ตรวจ additive + rollback */
const V3_TABLES = ["bank_statement_transactions", "bank_notifications", "storage_evidence", "file_snapshots", "transactions", "resource_transactions"];

async function main() {
  const pgBin = (name: string) => {
    const out = spawnSync("which", [name], { encoding: "utf8" }).stdout?.trim();
    if (!out) throw new Error(`ไม่พบ ${name} ใน PATH`);
    return out;
  };
  const INITDB = pgBin("initdb"), PGCTL = pgBin("pg_ctl"), PSQL = pgBin("psql");
  const port = await new Promise<number>((res, rej) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", rej);
    srv.listen(0, () => { const p = (srv.address() as { port: number }).port; srv.close(() => res(p)); });
  });
  const work = mkdtempSync(path.join(tmpdir(), "tenant-mig-"));
  const PGDATA = path.join(work, "data");
  mkdirSync(PGDATA, { recursive: true });
  execFileSync(INITDB, ["-U", "postgres", "--auth=trust", "--encoding=UTF8", "-D", PGDATA], { stdio: "pipe" });
  execFileSync(PGCTL, ["-o", `-p ${port}`, "-D", PGDATA, "-l", path.join(work, "server.log"), "start"], { stdio: "pipe" });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (spawnSync(PSQL, ["-U", "postgres", "-p", String(port), "-h", "127.0.0.1", "-d", "postgres", "-tc", "SELECT 1"], { encoding: "utf8" }).status === 0) { ready = true; break; }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!ready) throw new Error("postgres ไม่พร้อมภายใน 15s");
  execFileSync(PSQL, ["-U", "postgres", "-p", String(port), "-d", "postgres", "-c", "CREATE DATABASE tenant_mig"], { stdio: "pipe" });
  const conn = ["-U", "postgres", "-p", String(port), "-h", "127.0.0.1", "-d", "tenant_mig", "-v", "ON_ERROR_STOP=1", "-q", "-tA"];

  const sql = (q: string, mustSucceed = true) => {
    const r = spawnSync(PSQL, conn, { input: q, encoding: "utf8" });
    if (r.status !== 0 && mustSucceed) throw new Error(`SQL FAIL: ${r.stderr.slice(0, 800)}`);
    return { status: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
  };
  const val = (q: string, fallback = "") => {
    const r = sql(`SELECT * FROM (${q}) t;`, false);
    return r.status === 0 ? (r.out.trim().split("\n").filter(Boolean).pop() ?? fallback) : fallback;
  };
  const sanitize = (t: string) =>
    t.split("\n")
      .filter((l) => !/CREATE EXTENSION/i.test(l))
      .filter((l) => !/OWNER TO/i.test(l))
      .filter((l) => !/^GRANT /i.test(l))
      .filter((l) => !/^REVOKE /i.test(l))
      .filter((l) => !/geometry/i.test(l))
      .join("\n");
  const applyFile = (file: string, dir: string, mustSucceed = true) => {
    const tmp = path.join(work, "f_" + path.basename(file));
    writeFileSync(tmp, sanitize(readFileSync(path.join(dir, file), "utf8")));
    const r = spawnSync(PSQL, conn, { input: `\\i ${tmp}`, encoding: "utf8" });
    if (r.status !== 0 && mustSucceed) throw new Error(`${file} FAIL: ${r.stderr.slice(0, 700)}`);
    return r;
  };

  try {
    // ── prelude (supabase auth layer) ──
    sql(`DO $$ begin
  if not exists (select 1 from pg_publication where pubname='supabase_realtime') then
    create publication supabase_realtime;
  end if;
exception when others then null; end $$;
create schema if not exists extensions;
create extension if not exists pgcrypto schema extensions;
create extension if not exists "uuid-ossp" schema extensions;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema if not exists auth;
create table auth.users (id uuid primary key);
create table if not exists public.jobs (id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(), site_latitude numeric, site_longitude numeric);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
grant usage on schema auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to authenticated, service_role;`);
    const base = sanitize(readFileSync(path.join(LOCAL, "full_schema.sql"), "utf8"));
    writeFileSync(path.join(work, "00_base.sql"), base);
    const baseRun = spawnSync(PSQL, conn, { input: `\\i ${path.join(work, "00_base.sql")}`, encoding: "utf8" });
    if (baseRun.status !== 0) throw new Error(`full_schema.sql FAIL: ${baseRun.stderr.slice(0, 900)}`);

    // ── M1 migration order ──
    for (const f of BASE_MIGRATIONS) { if (!existsSync(path.join(MIG, f))) throw new Error(`migration หาย: ${f}`); applyFile(f, MIG); }
    const colsBefore = V3_TABLES.map((t) => Number(val(`select count(*)::int from information_schema.columns where table_schema='public' and table_name='${t}'`, "-1")));
    applyFile(TENANT_MIGRATIONS[0], MIG);
    applyFile(TENANT_MIGRATIONS[1], MIG);
    applyFile(TENANT_MIGRATIONS[2], MIG);
    ck("M1.1", true, "apply เรียงลำดับ full_schema → base → tenant V1 → V2 → V3 (ON_ERROR_STOP) สำเร็จ");

    // ── M2 additive compatibility ──
    const colsAfter = V3_TABLES.map((t) => Number(val(`select count(*)::int from information_schema.columns where table_schema='public' and table_name='${t}'`, "-1")));
    const additive = colsBefore.every((n, i) => n >= 0 && colsAfter[i] === n + 1);
    ck("M2.1", additive, "V3 เป็น additive จริง: 6 ตารางได้ organization_id เพิ่ม 1 คอลัมน์ ไม่มีคอลัมน์เดิมหาย", JSON.stringify({ colsBefore, colsAfter }));
    const policyCount = Number(val(`select count(*)::int from pg_policies where schemaname='public' and (policyname like 'tenant_%' or policyname like '%member%')`, "-1"));
    ck("M2.2", policyCount > 0, "policy tenant ถูกสร้างจริงหลัง apply", `policies=${policyCount}`);
    const fnExists = val(`select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('tenant_has_membership','tenant_org_of_line_user')`, "0");
    ck("M2.3", fnExists === "2", "helper function ของ V2 มีจริง (2 ตัว)", `found=${fnExists}`);

    // ข้อมูล SYNTH-* สำหรับตรวจว่า rollback ไม่ลบแถว
    sql(`insert into auth.users (id) values ('01000000-0000-4000-8000-0000000000a1');
insert into organizations (id, name, created_by) values ('00000000-0000-4000-8000-0000000000aa', 'SYNTH-ORG-A', '01000000-0000-4000-8000-0000000000a1');
insert into companies (id, name, tax_id, type, status, is_individual, updated_at, organization_id) values
 ('03000000-0000-4000-8000-0000000000a0', 'SYNTH-COMPANY-A', 'SYNTH-TAX-A', 'CUSTOMER', 'ACTIVE', false, now(), '00000000-0000-4000-8000-0000000000aa');`);
    const rowsBefore = Number(val(`select count(*)::int from companies`, "-1")) + Number(val(`select count(*)::int from organizations`, "-1"));

    // ── M3 rollback (ลำดับย้อนกลับ) ──
    let rollbackError = "";
    for (const f of TENANT_ROLLBACKS) {
      const p = path.join(RB, f);
      if (!existsSync(p)) { rollbackError = `rollback หาย: ${f}`; break; }
      const r = applyFile(f, RB, false);
      if (r.status !== 0) { rollbackError = `${f}: ${r.stderr.slice(0, 400)}`; break; }
    }
    ck("M3.1", rollbackError === "", "rollback ทั้ง 3 ไฟล์รันครบโดยไม่ error (V3 → V2 → V1)", rollbackError);

    // ── M4 สถานะหลังถอย ──
    const policiesLeft = Number(val(`select count(*)::int from pg_policies where schemaname='public' and policyname like 'tenant%'`, "-1"));
    const fnsLeft = val(`select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('tenant_has_membership','tenant_org_of_line_user')`, "-1");
    ck("M4.1", policiesLeft === 0, "policy ของ tenant หายหมดหลังถอย", `left=${policiesLeft}`);
    ck("M4.2", fnsLeft === "0", "helper functions หายหลังถอย", `left=${fnsLeft}`);
    const orgColsLeft = V3_TABLES.map((t) => Number(val(`select count(*)::int from information_schema.columns where table_schema='public' and table_name='${t}' and column_name='organization_id'`, "-1")));
    ck("M4.3", orgColsLeft.every((n) => n === 1), "คอลัมน์ organization_id ยังอยู่ (rollback ไม่ทำลาย mapping โดยอัตโนมัติ ตามเอกสาร)", JSON.stringify(orgColsLeft));

    // ── M5 ข้อมูลไม่ถูกแตะ ──
    const rowsAfter = Number(val(`select count(*)::int from companies`, "-1")) + Number(val(`select count(*)::int from organizations`, "-1"));
    ck("M5.1", rowsBefore === rowsAfter && rowsAfter === 2, "rollback ไม่ลบ/ไม่แก้ข้อมูล (companies+organizations เท่าเดิม)", `before=${rowsBefore} after=${rowsAfter}`);
  } finally {
    try { execFileSync(PGCTL, ["-D", PGDATA, "stop", "-m", "immediate"], { stdio: "pipe" }); } catch { /* already stopped */ }
  }

  console.log(`\n═══ TENANT MIGRATION/ROLLBACK: ${pass} PASS / ${fail} FAIL ═══`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
