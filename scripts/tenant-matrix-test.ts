/**
 * TENANT MATRIX TEST — Phase 4 (owner mission SOFTWARE PLATFORM — MULTI-TENANT COMPLETION)
 *
 * ทดสอบกับ "ฐานข้อมูลทดสอบจริง" (local Postgres ผุดขึ้นแล้วทิ้งอัตโนมัติ):
 *   - apply full_schema.sql (snapshot จริงของ production schema — sanitized) + migrations จริง
 *     (conversation/receipt/debt/line realtime/canonical foundation/connect identity/
 *      company members/tenant core V1/org scope V2) ด้วย ON_ERROR_STOP
 *   - simulate JWT session: SET ROLE authenticated + request.jwt.claim.sub — วิธีเดียวกับ
 *     ที่ Supabase PostgREST ให้ session จริงใช้ (RLS ทำงานจริง, ไม่ใช่ static check)
 *   - SYNTHETIC FIXTURES เท่านั้น (เอกสารภารกิจ: ห้ามใช้ข้อมูลบริษัทจริงเป็น fixtures)
 *   - writer/API gate: ตรวจ decision จุดเดียวเดียวกับ tenantAuthority.assertWriteScope
 *     (resolveTenantDecision + company→org mapping จาก DB จริง) — HTTP layer (PostgREST)
 *     ผุดไม่ได้บนเครื่องที่ไม่มี Docker/Supabase stack → รายงาน REMAINING_GAPS แยก
 *
 * วิ่งด้วย: npm run tenant-matrix:test · exit != 0 เมื่อข้อใด FAIL (ไม่กลั่น output)
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import path from "node:path";
import { resolveTenantDecision, type OrgMembership } from "../core/auth/orgScope";

const REPO = path.resolve(__dirname, "..");
const MIG = path.join(REPO, "supabase/migrations");
const LOCAL = path.join(REPO, "supabase/local-migration");

function pgBin(name: string): string {
  const out = spawnSync("which", [name], { encoding: "utf8" }).stdout?.trim();
  if (!out) throw new Error(`ไม่พบ ${name} ใน PATH (ห้าม auto-install ตาม INSTALL-CONTRACT)`);
  return out;
}
const INITDB = pgBin("initdb"), PGCTL = pgBin("pg_ctl"), PSQL = pgBin("psql");

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.unref(); srv.on("error", rej);
    srv.listen(0, () => { const p = (srv.address() as { port: number }).port; srv.close(() => res(p)); });
  });
}

const results: { id: string; name: string; pass: boolean; detail?: string }[] = [];
function record(id: string, name: string, pass: boolean, detail?: string) {
  results.push({ id, name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} [${id}] ${name}${detail ? ` — ${detail}` : ""}`);
}

const SYNTH = {
  orgA: "00000000-0000-4000-8000-0000000000aa",
  orgB: "00000000-0000-4000-8000-0000000000bb",
  userA: "01000000-0000-4000-8000-0000000000a1",
  userA2: "01000000-0000-4000-8000-0000000000a2",
  userB: "01000000-0000-4000-8000-0000000000b1",
  userPlatform: "02000000-0000-4000-8000-0000000000ff",
  compA: "03000000-0000-4000-8000-0000000000a0",
  compB: "03000000-0000-4000-8000-0000000000b0",
  lineA: "SYNTH-LINE-USER-A",
  lineB: "SYNTH-LINE-USER-B",
};

async function main() {
  const PORT = await freePort();
  const work = mkdtempSync(path.join(tmpdir(), "tenant-matrix-"));
  const PGDATA = path.join(work, "data");
  try {
    console.log(`[setup] PGDATA=${PGDATA} PORT=${PORT}`);
    mkdirSync(PGDATA, { recursive: true });
    execFileSync(INITDB, ["-U", "postgres", "--auth=trust", "--encoding=UTF8", "-D", PGDATA], { stdio: "pipe" });
    execFileSync(PGCTL, ["-o", `-p ${PORT}`, "-D", PGDATA, "-l", path.join(work, "server.log"), "start"], { stdio: "pipe" });

    let ready = false;
    for (let i = 0; i < 60; i++) {
      if (spawnSync(PSQL, ["-U", "postgres", "-p", String(PORT), "-h", "127.0.0.1", "-d", "postgres", "-tc", "SELECT 1"], { encoding: "utf8" }).status === 0) { ready = true; break; }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!ready) throw new Error("postgres ยังไม่พร้อมภายใน 15s");

    execFileSync(PSQL, ["-U", "postgres", "-p", String(PORT), "-d", "postgres", "-c", "CREATE DATABASE tenant_matrix"], { stdio: "pipe" });
    const conn = ["-U", "postgres", "-p", String(PORT), "-h", "127.0.0.1", "-d", "tenant_matrix", "-v", "ON_ERROR_STOP=1", "-q", "-tA"];

    function sql(query: string, mustSucceed = true): { status: number; out: string; err: string } {
      const r = spawnSync(PSQL, conn, { input: query, encoding: "utf8" });
      if (r.status !== 0 && mustSucceed) throw new Error(`SQL FAIL: ${r.stderr.slice(0, 800)}`);
      return { status: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
    }
    /** session จริงตามแบบ Supabase: role + JWT claims + RLS ทำงานจริง */
    function asUser(userId: string, claimsRole: string, query: string, mustSucceed = true): { status: number; out: string; err: string } {
      return sql(`
BEGIN;
SELECT set_config('request.jwt.claim.sub', '${userId}', true);
SELECT set_config('request.jwt.claim.role', '${claimsRole}', true);
SET LOCAL ROLE authenticated;
${query}
COMMIT;`, mustSucceed);
    }
    function rowCount(userId: string | null, query: string): number {
      const r = userId ? asUser(userId, "authenticated", `SELECT count(*) FROM (${query}) c;`, false) : sql(`SELECT count(*) FROM (${query}) c;`, false);
      // privilege-level deny (เช่นตาราง identity ที่ revoke จาก authenticated) = deny เดียวกัน — นับเป็น 0 แถวที่มองเห็น
      if (r.status !== 0 && /permission denied/i.test(r.err)) return 0;
      const t = r.out.trim().split("\n").filter(Boolean).pop() ?? "0";
      const n = parseInt(t, 10);
      return Number.isFinite(n) ? n : -1;
    }

    // ── prelude (supabase auth layer ที่ snapshot ไม่มี — ไม่ฝังข้อมูล/ผู้ใช้จริงใด) ──
    // BS-chr = backslash (String.fromCharCode(92)) เลี่ยงปัญหา shell escaping ทั้งหมด
    const BS = String.fromCharCode(92);
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
-- jobs stub: production มีจริงแต่ repo ไม่มี CREATE (20260620 ระบุตรง ๆ) — stub เพื่อให้ FK ของ
-- resource_transactions ตรวจได้เหมือนจริง (คอลัมน์เท่าที่ 20260620 ประกาศ)
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  site_latitude numeric,
  site_longitude numeric
);
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as
$$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
grant usage on schema auth to anon, authenticated, service_role;
grant all on all tables in schema public to authenticated, service_role;
grant all on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;
alter default privileges in schema public grant all on tables to authenticated, service_role;
grant select on auth.users to anon, authenticated, service_role;`);

    // ── full_schema.sql (sanitized: เอา extension/owner/grant ที่เครื่องนี้ไม่มีออก) ──
    const sanitize = (t: string) =>
      t.split("\n")
        .filter((l) => !/CREATE EXTENSION/i.test(l))
        .filter((l) => !/OWNER TO/i.test(l))
        .filter((l) => !/^GRANT /i.test(l))
        .filter((l) => !/^REVOKE /i.test(l))
        .filter((l) => !/geometry/i.test(l))
        
        .join("\n");
    const base = sanitize(readFileSync(path.join(LOCAL, "full_schema.sql"), "utf8"));
    writeFileSync(path.join(work, "00_base.sql"), base);
    const rb = spawnSync(PSQL, conn, { input: `\\i ${path.join(work, "00_base.sql")}`, encoding: "utf8" });
    if (rb.status !== 0) throw new Error(`full_schema.sql FAIL: ${rb.stderr.slice(0, 1200)}`);
    console.log("[setup] full_schema.sql applied (sanitized)");

    // ── migrations จริง (subset เกี่ยวกับ tenant) ──
    const applyList = [
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
      "20261018000001_tenant_core_v1.sql",
      "20261018000002_tenant_org_scope_v2.sql",
      "20261018000003_tenant_org_binding_v3.sql",
    ];
    for (const f of applyList) {
      const p = path.join(MIG, f);
      if (!existsSync(p)) throw new Error(`migration หาย: ${f}`);
      const tmp = path.join(work, "mig_" + f);
      writeFileSync(tmp, sanitize(readFileSync(p, "utf8")));
      const r = spawnSync(PSQL, conn, { input: `\\i ${tmp}`, encoding: "utf8" });
      if (r.status !== 0) {
        const t = readFileSync(tmp, "utf8").split("\n");
        let ctx = "";
        const m = r.stderr.match(/:([0-9]+): ERROR/);
        if (m) { const ln = parseInt(m[1], 10); ctx = t.slice(Math.max(0, ln - 6), ln + 3).map((l, i) => (ln - 6 + i + 1) + ": " + JSON.stringify(l.slice(0, 120))).join("\n"); }
        throw new Error(`migration ${f} FAIL: ${r.stderr.slice(0, 600)}\nCONTEXT:\n${ctx}`);
      }
      console.log(`[setup] applied ${f}`);
    }

    // ── synthetic fixtures (SYNTH-* ล้วน) ──
    sql(`insert into auth.users (id) values
 ('${SYNTH.userA}'), ('${SYNTH.userA2}'), ('${SYNTH.userB}'), ('${SYNTH.userPlatform}');
insert into organizations (id, name, created_by) values
 ('${SYNTH.orgA}', 'SYNTH-ORG-A', '${SYNTH.userA}'),
 ('${SYNTH.orgB}', 'SYNTH-ORG-B', '${SYNTH.userB}');
insert into org_members (organization_id, user_id, role) values
 ('${SYNTH.orgA}', '${SYNTH.userA}', 'admin'),
 ('${SYNTH.orgA}', '${SYNTH.userA2}', 'member'),
 ('${SYNTH.orgB}', '${SYNTH.userB}', 'admin');
insert into companies (id, name, tax_id, type, status, is_individual, updated_at, organization_id) values
 ('${SYNTH.compA}', 'SYNTH-COMPANY-A', 'SYNTH-TAX-A', 'CUSTOMER', 'ACTIVE', false, now(), '${SYNTH.orgA}'),
 ('${SYNTH.compB}', 'SYNTH-COMPANY-B', 'SYNTH-TAX-B', 'CUSTOMER', 'ACTIVE', false, now(), '${SYNTH.orgB}');
-- company_line_links เป็น read-only projection ของ Connect identity (guard trigger จริง)
-- → seeding LINE link ผ่านทาง canonical: connect_external_identities (provider 'line')
insert into connect_external_identities (id, provider, external_subject_id, company_id, display_name, role) values
 ('07000000-0000-4000-8000-0000000000ac', 'line', '${SYNTH.lineA}', '${SYNTH.compA}', 'SYNTH-LINE-A', 'owner'),
 ('07000000-0000-4000-8000-0000000000bc', 'line', '${SYNTH.lineB}', '${SYNTH.compB}', 'SYNTH-LINE-B', 'owner');
insert into invoices (id, invoice_no, invoice_status, customer_company_id, subtotal, vat_amount, total_amount, updated_at) values
 ('04000000-0000-4000-8000-0000000000a1', 'SYNTH-INV-A-1', 'SENT', '${SYNTH.compA}', 1000, 70, 1070, now()),
 ('04000000-0000-4000-8000-0000000000b1', 'SYNTH-INV-B-1', 'SENT', '${SYNTH.compB}', 2000, 140, 2140, now());
insert into debt_events (id, customer_company_id, event_type, amount, occurred_at, source) values
 ('05000000-0000-4000-8000-0000000000a1', '${SYNTH.compA}', 'debt_started', 1070, current_date, 'synthetic'),
 ('05000000-0000-4000-8000-0000000000b1', '${SYNTH.compB}', 'debt_started', 2140, current_date, 'synthetic');
insert into company_expenses (id, document_type, amount, submitted_by_line_user_id, submitted_by_role) values
 ('06000000-0000-4000-8000-0000000000a1', 'receipt', 300, '${SYNTH.lineA}', 'owner'),
 ('06000000-0000-4000-8000-0000000000b1', 'receipt', 400, '${SYNTH.lineB}', 'owner');
insert into connect_external_identities (id, provider, external_subject_id, company_id, display_name, role) values
 ('07000000-0000-4000-8000-0000000000a1', 'slack', 'SYNTH-SUBJ-A', '${SYNTH.compA}', 'SYNTH-A', 'manager'),
 ('07000000-0000-4000-8000-0000000000b1', 'slack', 'SYNTH-SUBJ-B', '${SYNTH.compB}', 'SYNTH-B', 'manager');`);
    console.log("[setup] synthetic fixtures seeded (SYNTH-* only)");

    // ───────────────── MATRIX 10 ข้อ ─────────────────
    const visA = () => rowCount(SYNTH.userA, `select id from companies where organization_id='${SYNTH.orgA}'`);
    const visB = () => rowCount(SYNTH.userB, `select id from companies where organization_id='${SYNTH.orgB}'`);

    record("M1", "A อ่านข้อมูล A (RLS member scope)", visA() === 1, `companies(A) visible=${scalar(SYNTH.userA, "select count(*) from companies")}`);

    const crossTables: [string, string][] = [
      ["companies", "organization_id='" + SYNTH.orgB + "'"],
      ["invoices", "customer_company_id='" + SYNTH.compB + "'"],
      ["debt_events", "customer_company_id='" + SYNTH.compB + "'"],
      ["company_expenses", "submitted_by_line_user_id='" + SYNTH.lineB + "'"],
      ["connect_external_identities", "company_id='" + SYNTH.compB + "'"],
      ["conversation_states", "line_user_id='" + SYNTH.lineB + "'"],
      ["line_customer_memory", "line_user_id='" + SYNTH.lineB + "'"],
    ];
    function scalar(userId: string, query: string): string {
      const r = asUser(userId, "authenticated", `SELECT (${query})::text;`, false);
      return r.out.trim().split("\n").filter(Boolean).pop() ?? "";
    }
    let leak = "";
    for (const [tbl, cond] of crossTables) {
      const n = rowCount(SYNTH.userA, `select 1 from ${tbl} where ${cond}`);
      if (n !== 0) leak += `${tbl}(n=${n}) `;
    }
    record("M2", "A อ่านข้อมูล B ไม่ได้ (7 ตาราง)", !leak, leak || "org-mapped B rows invisible to A");

    const leakB: string[] = [];
    for (const [tbl, cond] of crossTables) {
      const acond = cond.replace(SYNTH.orgB, SYNTH.orgA).replace(SYNTH.compB, SYNTH.compA).replace(SYNTH.lineB, SYNTH.lineA);
      const n = rowCount(SYNTH.userB, `select 1 from ${tbl} where ${acond}`);
      if (n !== 0) leakB.push(tbl);
    }
    record("M3", "B อ่านข้อมูล A ไม่ได้", leakB.length === 0, leakB.join(",") || "symmetric deny confirmed");

    const platLeak: string[] = [];
    for (const [tbl] of [["companies"], ["invoices"], ["debt_events"]] as [string][]) {
      const n = rowCount(SYNTH.userPlatform, `select 1 from ${tbl}`);
      if (n !== 0) platLeak.push(tbl);
    }
    record("M3b", "Platform developer ไม่อ่านธุรกิจอัตโนมัติ (ไม่ hardcode เจ้าของ platform)", platLeak.length === 0, platLeak.join(",") || "no implicit tenant for platform owner");

    const upd = asUser(SYNTH.userA, "authenticated", `update companies set name='HACKED' where id='${SYNTH.compB}';`);
    const hackSeen = rowCount(null, `select 1 from companies where name='HACKED'`);
    record("M4", "Admin A แก้ข้อมูล B ไม่ได้ (write ผ่าน session = deny)", hackSeen === 0 && upd.status === 0, `changed_rows=${hackSeen}`);

    function writerGateDecision(orgId: string, userId: string | null, resourceCompany: string) {
      const memOut = spawnSync(PSQL, conn, { input: `select coalesce(jsonb_agg(jsonb_build_object('organizationId',organization_id,'role',role)),'[]'::jsonb)::text from org_members where user_id='${userId}';`, encoding: "utf8" }).stdout.split("\n").filter(Boolean).pop() ?? "[]";
      const memberships: OrgMembership[] = JSON.parse(memOut);
      const mapped = spawnSync(PSQL, conn, { input: `select coalesce(organization_id::text,'NULL') from companies where id='${resourceCompany}';`, encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean).pop() ?? "NULL";
      const mappedOrg = mapped.replace(/"/g, "");
      const d = resolveTenantDecision({
        auth: userId ? { id: userId } : null,
        memberships,
        requestedOrganizationId: orgId,
        action: "write",
      });
      if (!d.allowed) return d;
      if (!mappedOrg || mappedOrg === "NULL") return { allowed: false, code: "ORG_UNMAPPED", reason: "ORG_UNMAPPED" };
      if (mappedOrg !== orgId) return { allowed: false, code: "RESOURCE_NOT_OWNED", reason: "RESOURCE_NOT_OWNED" };
      return d;
    }
    const d5a = writerGateDecision(SYNTH.orgA, SYNTH.userA, SYNTH.compB);
    const d5b = writerGateDecision(SYNTH.orgB, SYNTH.userB, SYNTH.compA);
    const d5c = writerGateDecision(SYNTH.orgA, SYNTH.userA2, SYNTH.compA);
    record("M5", "AI/writer gate ข้ามองค์กรไม่ได้ (decision จุดเดียวต่อ DB จริง)",
      !d5a.allowed && !d5b.allowed && !d5c.allowed,
      `A→B=${d5a.code} B→A=${d5b.code} memberA-write=${d5c.code}`);

    sql(`insert into conversation_states (line_user_id, current_intent, status, expires_at) values
 ('${SYNTH.lineA}','SYNTH-INTENT-A','open', now() + interval '1 day'),
 ('${SYNTH.lineB}','SYNTH-INTENT-B','open', now() + interval '1 day');`);
    const lineASeenByB = rowCount(SYNTH.userB, `select 1 from conversation_states where line_user_id='${SYNTH.lineA}'`);
    const lineASeenByA = rowCount(SYNTH.userA, `select 1 from conversation_states where line_user_id='${SYNTH.lineA}'`);
    record("M6", "LINE A ไม่ปะปน LINE B (line-scope policy)", lineASeenByB === 0 && lineASeenByA === 1, `seenByB=${lineASeenByB} seenByA=${lineASeenByA}`);

    const docLeak = rowCount(SYNTH.userB, `select 1 from invoices where invoice_no='SYNTH-INV-A-1'`);
    const docOwn = rowCount(SYNTH.userA, `select 1 from invoices where invoice_no='SYNTH-INV-A-1'`);
    record("M7", "เอกสาร A ไม่ปรากฏใน B", docLeak === 0 && docOwn === 1, `invA seenByB=${docLeak} seenByA=${docOwn}`);

    const wrongWrite = asUser(SYNTH.userA, "authenticated", `insert into debt_events (id, customer_company_id, event_type, amount, occurred_at, source) values ('05000000-0000-4000-8000-00000000e001','${SYNTH.compB}','debt_started',1,current_date,'synthetic');`, false);
    const wrongWritten = rowCount(null, `select 1 from debt_events where id='05000000-0000-4000-8000-00000000e001'`);
    const gateBlocksWrong = !writerGateDecision(SYNTH.orgA, SYNTH.userA, SYNTH.compB).allowed;
    record("M8", "Financial writer ไม่เขียนผิดองค์กร (RLS session deny + writer gate deny คู่กัน)", wrongWritten === 0 && gateBlocksWrong, `rls_written=${wrongWritten} gate_blocks=${gateBlocksWrong} (insert err=${wrongWrite.status !== 0})`);

    const svcRows = rowCount(null, `select 1 from companies`);
    const gateSvc = !writerGateDecision(SYNTH.orgA, null, SYNTH.compA).allowed;
    const gateIdentity = !writerGateDecision(SYNTH.orgB, "02000000-0000-4000-8000-0000000000ff", SYNTH.compA).allowed;
    record("M9", "Service role ไม่ข้ามสิทธิ์โดยไม่ตั้งใจ (bypass มี gate คุมที่ decision layer)",
      svcRows === 2 && gateSvc && gateIdentity,
      `service_visible=${svcRows} · gate บังคับ actor+membership (AUTH_REQUIRED/ORG_NOT_MEMBER) แม้ service bypass`);

    let concOk = true; let concNote = "";
    for (let i = 0; i < 12; i++) {
      const a = rowCount(SYNTH.userA, `select id from companies where organization_id='${SYNTH.orgA}'`);
      const b = rowCount(SYNTH.userB, `select id from companies where organization_id='${SYNTH.orgB}'`);
      const aVisB = rowCount(SYNTH.userA, `select id from companies where organization_id='${SYNTH.orgB}'`);
      const bVisA = rowCount(SYNTH.userB, `select id from companies where organization_id='${SYNTH.orgA}'`);
      if (a !== 1 || b !== 1 || aVisB !== 0 || bVisA !== 0) { concOk = false; concNote = `round ${i}: a=${a} b=${b} aVisB=${aVisB} bVisA=${bVisA}`; break; }
    }
    record("M10", "Concurrent requests ไม่ปะปน context (12 รอบสลับ session)", concOk, concNote || "12 rounds stable");


    // ═══ STEP 1 — DATABASE ORG BINDING (GAP 3 กลุ่ม · migration V3) ═══
    // fixtures SYNTH ล้วน · org A/B map ชัดเจน · มี 1 แถว "unmapped" ต่อกลุ่มเพื่อพิสูจน์ fail-closed
    sql(`insert into jobs (id) values ('08000000-0000-4000-8000-0000000000a1'), ('08000000-0000-4000-8000-0000000000b1');
insert into storage_scan_runs (id, machine_id, actor, correlation_id) values
 ('0a000000-0000-4000-8000-0000000000a1', 'SYNTH-MACHINE-A', 'SYNTH-ACTOR-A', '0b000000-0000-4000-8000-0000000000a1'),
 ('0a000000-0000-4000-8000-0000000000b1', 'SYNTH-MACHINE-B', 'SYNTH-ACTOR-B', '0b000000-0000-4000-8000-0000000000b1');
insert into storage_resources (id, scan_run_id, path, size_bytes, state) values
 ('0c000000-0000-4000-8000-0000000000a1', '0a000000-0000-4000-8000-0000000000a1', 'SYNTH/evidence-a.pdf', 10, 'DISCOVERED'),
 ('0c000000-0000-4000-8000-0000000000b1', '0a000000-0000-4000-8000-0000000000b1', 'SYNTH/evidence-b.pdf', 20, 'DISCOVERED');
insert into bank_statement_transactions (id, account_number, transaction_date, amount, description, organization_id) values
 ('0d000000-0000-4000-8000-0000000000a1', 'SYNTH-ACC-A', '01-10-26', 100, 'SYNTH-BANK-A', '${SYNTH.orgA}'),
 ('0d000000-0000-4000-8000-0000000000b1', 'SYNTH-ACC-B', '01-10-26', 200, 'SYNTH-BANK-B', '${SYNTH.orgB}'),
 ('0d000000-0000-4000-8000-0000000000c1', 'SYNTH-ACC-U', '01-10-26', 300, 'SYNTH-BANK-UNMAPPED', null);
insert into bank_notifications (id, gmail_message_id, amount, organization_id) values
 ('0e000000-0000-4000-8000-0000000000a1', 'SYNTH-GMAIL-A', 100, '${SYNTH.orgA}'),
 ('0e000000-0000-4000-8000-0000000000b1', 'SYNTH-GMAIL-B', 200, '${SYNTH.orgB}');
insert into storage_evidence (id, resource_id, kind, detail, organization_id) values
 ('0f000000-0000-4000-8000-0000000000a1', '0c000000-0000-4000-8000-0000000000a1', 'sha256', 'SYNTH-EVIDENCE-A', '${SYNTH.orgA}'),
 ('0f000000-0000-4000-8000-0000000000b1', '0c000000-0000-4000-8000-0000000000b1', 'sha256', 'SYNTH-EVIDENCE-B', '${SYNTH.orgB}');
insert into file_snapshots (content_hash, original_path, size_bytes, storage_path, organization_id) values
 ('SYNTH-HASH-A', 'SYNTH/a.ts', 10, 'SYNTH/store/a', '${SYNTH.orgA}'),
 ('SYNTH-HASH-B', 'SYNTH/b.ts', 20, 'SYNTH/store/b', '${SYNTH.orgB}');
insert into transactions (id, title, state, net_amount, organization_id) values
 ('09000000-0000-4000-8000-0000000000a1', 'SYNTH-LEDGER-A', 'initiated', 100, '${SYNTH.orgA}'),
 ('09000000-0000-4000-8000-0000000000b1', 'SYNTH-LEDGER-B', 'initiated', 200, '${SYNTH.orgB}');
insert into resource_transactions (id, job_id, resource_type, resource_label, quantity, unit, source_event_id, organization_id) values
 ('10000000-0000-4000-8000-0000000000a1', '08000000-0000-4000-8000-0000000000a1', 'machinery_hours', 'SYNTH-RES-A', 1, 'ชั่วโมง', 'SYNTH-SRC-A', '${SYNTH.orgA}'),
 ('10000000-0000-4000-8000-0000000000b1', '08000000-0000-4000-8000-0000000000b1', 'machinery_hours', 'SYNTH-RES-B', 1, 'ชั่วโมง', 'SYNTH-SRC-B', '${SYNTH.orgB}');`);

    const bankA = rowCount(SYNTH.userA, `select 1 from bank_statement_transactions where organization_id='${SYNTH.orgA}'`);
    const bankXA = rowCount(SYNTH.userA, `select 1 from bank_statement_transactions where organization_id='${SYNTH.orgB}'`);
    const bankB = rowCount(SYNTH.userB, `select 1 from bank_statement_transactions where organization_id='${SYNTH.orgB}'`);
    const bankXB = rowCount(SYNTH.userB, `select 1 from bank_statement_transactions where organization_id='${SYNTH.orgA}'`);
    const bankUnmapped = rowCount(SYNTH.userA, `select 1 from bank_statement_transactions where organization_id is null`);
    const noteA = rowCount(SYNTH.userA, `select 1 from bank_notifications where organization_id='${SYNTH.orgA}'`);
    const noteXA = rowCount(SYNTH.userA, `select 1 from bank_notifications where organization_id='${SYNTH.orgB}'`);
    record("S1-BANK", "Bank statements/notifications: A↔B แยกจริง + unmapped ไม่โผล่",
      bankA === 1 && bankB === 1 && bankXA === 0 && bankXB === 0 && bankUnmapped === 0 && noteA === 1 && noteXA === 0,
      `A=${bankA} B=${bankB} A×B=${bankXA} B×A=${bankXB} unmapped=${bankUnmapped} notesA=${noteA} notesA×B=${noteXA}`);

    const evA = rowCount(SYNTH.userA, `select 1 from storage_evidence where organization_id='${SYNTH.orgA}'`);
    const evXA = rowCount(SYNTH.userA, `select 1 from storage_evidence where organization_id='${SYNTH.orgB}'`);
    const fsA = rowCount(SYNTH.userA, `select 1 from file_snapshots where organization_id='${SYNTH.orgA}'`);
    const fsXB = rowCount(SYNTH.userB, `select 1 from file_snapshots where organization_id='${SYNTH.orgA}'`);
    record("S1-EVIDENCE", "Evidence/File snapshots: A↔B แยกจริง",
      evA === 1 && evXA === 0 && fsA === 1 && fsXB === 0,
      `evidenceA=${evA} evidenceA×B=${evXA} snapshotA=${fsA} snapshotA×B=${fsXB}`);

    const ledA = rowCount(SYNTH.userA, `select 1 from transactions where organization_id='${SYNTH.orgA}'`);
    const ledXA = rowCount(SYNTH.userA, `select 1 from transactions where organization_id='${SYNTH.orgB}'`);
    const resA = rowCount(SYNTH.userA, `select 1 from resource_transactions where organization_id='${SYNTH.orgA}'`);
    const resXB = rowCount(SYNTH.userB, `select 1 from resource_transactions where organization_id='${SYNTH.orgA}'`);
    record("S1-LEDGER", "Transactions/Partner ledger: A↔B แยกจริง",
      ledA === 1 && ledXA === 0 && resA === 1 && resXB === 0,
      `ledgerA=${ledA} ledgerA×B=${ledXA} resA=${resA} resA×B=${resXB}`);

    // เขียนข้ามองค์กรผ่าน session: RLS deny (แม้ระบุ organization_id ของ B ตรง ๆ)
    const crossWriteBank = asUser(SYNTH.userA, "authenticated", `insert into bank_statement_transactions (id, account_number, transaction_date, amount, description, organization_id) values ('0d000000-0000-4000-8000-00000000f001','SYNTH-ACC-HACK','01-10-26',1,'SYNTH-HACK','${SYNTH.orgB}');`, false);
    const crossWritten = rowCount(null, `select 1 from bank_statement_transactions where id='0d000000-0000-4000-8000-00000000f001'`);
    // ผู้ก่อสิทธิ์ (row owner) ต้องตรง org ที่ขอ — decision เดียวกับ writer gate
    function rowOrgGate(orgId: string, userId: string | null, rowOrg: string | null) {
      const memOut = spawnSync(PSQL, conn, { input: `select coalesce(jsonb_agg(jsonb_build_object('organizationId',organization_id,'role',role)),'[]'::jsonb)::text from org_members where user_id='${userId}';`, encoding: "utf8" }).stdout.split("\n").filter(Boolean).pop() ?? "[]";
      const d = resolveTenantDecision({ auth: userId ? { id: userId } : null, memberships: JSON.parse(memOut), requestedOrganizationId: orgId, action: "write" });
      if (!d.allowed) return d;
      if (!rowOrg || rowOrg === "NULL") return { allowed: false, code: "ORG_UNMAPPED", reason: "ORG_UNMAPPED" };
      if (rowOrg !== orgId) return { allowed: false, code: "RESOURCE_NOT_OWNED", reason: "RESOURCE_NOT_OWNED" };
      return d;
    }
    const g1 = rowOrgGate(SYNTH.orgA, SYNTH.userA, SYNTH.orgB);
    const g2 = rowOrgGate(SYNTH.orgA, SYNTH.userA, "NULL");
    const g3 = rowOrgGate(SYNTH.orgA, SYNTH.userA, SYNTH.orgA);
    record("S1-WRITE", "เขียนข้ามองค์กร/แถว unmapped ไม่ได้ (RLS deny + gate deny)",
      crossWritten === 0 && crossWriteBank.status !== 0 && !g1.allowed && !g2.allowed && g3.allowed,
      `RLS_written=${crossWritten} cross_code=${g1.code} unmapped_code=${g2.code} own=${g3.allowed}`);

    // Service role เห็นทุกแถว (bypass) แต่ authority gate ยัง deny เมื่อ actor ไม่มีสิทธิ์
    const svcBank = rowCount(null, `select 1 from bank_statement_transactions`);
    const svcGate = !rowOrgGate(SYNTH.orgA, null, SYNTH.orgA).allowed;
    record("S1-SERVICE", "Service role เห็นข้อมูลครบแต่ผ่าน authority gate เสมอ",
      svcBank === 3 && svcGate,
      `service_rows=${svcBank} (2 mapped + 1 unmapped) gate_without_actor=${svcGate}`);

    // concurrent: A/B สลับกัน 8 รอบบน bank + ledger — ห้ามปะปน
    let step1ConcOk = true; let step1Note = "";
    for (let i = 0; i < 8; i++) {
      const a1 = rowCount(SYNTH.userA, `select 1 from bank_statement_transactions where organization_id='${SYNTH.orgA}'`);
      const b1 = rowCount(SYNTH.userB, `select 1 from bank_statement_transactions where organization_id='${SYNTH.orgB}'`);
      const a2 = rowCount(SYNTH.userA, `select 1 from bank_statement_transactions where organization_id='${SYNTH.orgB}'`);
      const b2 = rowCount(SYNTH.userB, `select 1 from transactions where organization_id='${SYNTH.orgA}'`);
      if (a1 !== 1 || b1 !== 1 || a2 !== 0 || b2 !== 0) { step1ConcOk = false; step1Note = `round ${i}: a=${a1} b=${b1} a×B=${a2} b×A=${b2}`; break; }
    }
    record("S1-CONCURRENT", "Concurrent requests บน bank/ledger ไม่ปะปนองค์กร (8 รอบ)", step1ConcOk, step1Note || "8 rounds stable");

    const failed = results.filter((r) => !r.pass);
    console.log(`\n=== TENANT MATRIX: ${results.length - failed.length}/${results.length} PASS ===`);
    if (failed.length) throw new Error("TENANT_MATRIX_FAILED: " + failed.map((f) => `[${f.id}] ${f.name}`).join(" , "));
  } finally {
    console.log("[teardown] stop postgres + clean PGDATA");
    spawnSync(PGCTL, ["-D", PGDATA, "stop", "-m", "fast"], { stdio: "pipe" });
    rmSync(PGDATA, { recursive: true, force: true });
  }
  console.log("TENANT MATRIX TEST: PASS");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
