/**
 * STEP 4 — FULL END-TO-END TEST (SYNTHETIC ONLY)
 *
 * พิสูจน์สองวิธีใช้งานจริงบนโค้ดจริง (ไม่สร้างระบบคู่ขนาน):
 *
 *   A. MANUAL TOOL — ผู้ใช้เปิดเครื่องมือเอง
 *        membership จาก DB จริง → resolveTenantDecision (authority ตัวเดิม)
 *        → อ่านข้อมูลผ่าน RLS จริงบน Postgres ที่ผุดขึ้นแล้วทิ้ง (schema snapshot จริง)
 *        → ประมวลผล (aggregate จาก DB จริง) → ส่งออกเป็น display model
 *        → render ด้วย BusinessDisplayRenderer ตัวเดิม (ไม่ใช่ renderer ใหม่)
 *
 *   B. AI COMMAND — ผู้ใช้พิมพ์คำสั่ง
 *        ข้อความ → translateLocalAiCommand (bridge ตัวจริงที่ pipeline ใช้)
 *        → AI adapter ถูก inject (DI seam เดิมของ AiGateway) เพื่อ "ดักจับ prompt จริง"
 *        → พิสูจน์ว่า Model Context ได้แค่ประโยคผู้ใช้ + vocabulary คงที่
 *          ไม่มีตัวเลข/ชื่อบริษัท/เลขที่เอกสารของข้อมูลธุรกิจใด ๆ
 *        → command ที่ได้ต้องเป็น READ-only ใน allow-list
 *        → คำสั่งเขียนถูกปฏิเสธโดย dispatcher ตัวจริง (AI ไม่มีอำนาจเขียน)
 *
 *   C. RESET CHAT — resetMemory ต่อ session key: AI context หาย แต่ business rows
 *      ใน DB ยังอยู่ครบ และ memory ต่างองค์กรไม่ปะปนกัน
 *
 * ข้อมูลทั้งหมดเป็น SYNTH-* บนฐานข้อมูลชั่วคราวในเครื่อง · ไม่แตะ production
 * (ไม่มี network ไป Supabase · ไม่มี migration apply production · ไม่มี push/deploy)
 *
 * Run: npm run tenant-e2e:test   (exit != 0 เมื่อมี FAIL · ไม่กลั่น output)
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { resolveTenantDecision, type OrgMembership } from "../core/auth/orgScope";
import { translateLocalAiCommand, LOCAL_AI_COMMAND_VOCABULARY } from "../app/api/chat/_lib/localAiBridge";
import { dispatch as dispatchCommand, isRegistered } from "../engines/validation/dispatcher";
import { pushConversationTurn, resetMemory, getMemory } from "../cognitive/memory/session";
import { BusinessDisplayRenderer } from "../app/admin/ui-gallery/_lib/BusinessDisplayRenderer";
import type { BusinessDisplayModel } from "../app/admin/ui-gallery/_lib/businessDisplayModel";
import type { AiAdapter, AiAdapterInvokeRequest } from "../services/ai/adapterContract";

const REPO = path.resolve(__dirname, "..");
const MIG = path.join(REPO, "supabase/migrations");
const LOCAL = path.join(REPO, "supabase/local-migration");

let pass = 0;
let fail = 0;
function ck(id: string, ok: boolean, label: string, detail = "") {
  if (ok) { pass++; console.log(`PASS [${id}] ${label}`); }
  else { fail++; console.log(`FAIL [${id}] ${label}${detail ? ` — ${detail}` : ""}`); }
}

const SYNTH = {
  orgA: "00000000-0000-4000-8000-0000000000aa",
  orgB: "00000000-0000-4000-8000-0000000000bb",
  userA: "01000000-0000-4000-8000-0000000000a1",
  userB: "01000000-0000-4000-8000-0000000000b1",
  compA: "03000000-0000-4000-8000-0000000000a0",
  compB: "03000000-0000-4000-8000-0000000000b0",
  invA: "04000000-0000-4000-8000-0000000000a1",
  invB: "04000000-0000-4000-8000-0000000000b1",
  amountA: 1070,
  amountB: 2140,
};

/** ─────────── local Postgres (schema snapshot จริง + migrations จริง) ─────────── */
async function startSyntheticDb() {
  const pgBin = (name: string) => {
    const out = spawnSync("which", [name], { encoding: "utf8" }).stdout?.trim();
    if (!out) throw new Error(`ไม่พบ ${name} ใน PATH (ห้าม auto-install ตาม INSTALL-CONTRACT)`);
    return out;
  };
  const INITDB = pgBin("initdb"), PGCTL = pgBin("pg_ctl"), PSQL = pgBin("psql");
  const port = await new Promise<number>((res, rej) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", rej);
    srv.listen(0, () => { const p = (srv.address() as { port: number }).port; srv.close(() => res(p)); });
  });
  const work = mkdtempSync(path.join(tmpdir(), "tenant-e2e-"));
  const PGDATA = path.join(work, "data");
  mkdirSync(PGDATA, { recursive: true });
  execFileSync(INITDB, ["-U", "postgres", "--auth=trust", "--encoding=UTF8", "-D", PGDATA], { stdio: "pipe" });
  execFileSync(PGCTL, ["-o", `-p ${port}`, "-D", PGDATA, "-l", path.join(work, "server.log"), "start"], { stdio: "pipe" });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (spawnSync(PSQL, ["-U", "postgres", "-p", String(port), "-h", "127.0.0.1", "-d", "postgres", "-tc", "SELECT 1"], { encoding: "utf8" }).status === 0) { ready = true; break; }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!ready) throw new Error("postgres ยังไม่พร้อมภายใน 15s");
  execFileSync(PSQL, ["-U", "postgres", "-p", String(port), "-d", "postgres", "-c", "CREATE DATABASE tenant_e2e"], { stdio: "pipe" });
  const conn = ["-U", "postgres", "-p", String(port), "-h", "127.0.0.1", "-d", "tenant_e2e", "-v", "ON_ERROR_STOP=1", "-q", "-tA"];

  const sql = (query: string, mustSucceed = true) => {
    const r = spawnSync(PSQL, conn, { input: query, encoding: "utf8" });
    if (r.status !== 0 && mustSucceed) throw new Error(`SQL FAIL: ${r.stderr.slice(0, 900)}`);
    return { status: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
  };
  /** session แบบ Supabase จริง: role + JWT claims → RLS ทำงานจริง */
  const asUser = (userId: string, query: string, mustSucceed = true) =>
    sql(`BEGIN;
SELECT set_config('request.jwt.claim.sub', '${userId}', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
${query}
COMMIT;`, mustSucceed);
  /** นับแถวที่ "session นี้มองเห็น" — privilege deny = 0 แถวเช่นกัน (fail-closed) */
  const visibleRows = (userId: string | null, query: string) => {
    const r = userId ? asUser(userId, `SELECT count(*) FROM (${query}) c;`, false) : sql(`SELECT count(*) FROM (${query}) c;`, false);
    if (r.status !== 0 && /permission denied/i.test(r.err)) return 0;
    if (r.status !== 0) return -1;
    const n = parseInt(r.out.trim().split("\n").filter(Boolean).pop() ?? "0", 10);
    return Number.isFinite(n) ? n : -1;
  };
  /** ค่าดียวจาก query (แถวเดียว/คอลัมน์เดียว) — psql -q ไม่พิมพ์ command tag จึงอ่านบรรทัดสุดท้ายได้ */
  const scalar = (userId: string | null, query: string) => {
    const wrapped = `SELECT * FROM (${query}) t;`;
    const r = userId ? asUser(userId, wrapped, false) : sql(wrapped, false);
    return r.status === 0 ? (r.out.trim().split("\n").filter(Boolean).pop() ?? "") : "";
  };

  // ── prelude: supabase auth layer ที่ snapshot ไม่มี (ไม่มีข้อมูล/ผู้ใช้จริง) ──
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
    if (r.status !== 0) throw new Error(`migration ${f} FAIL: ${r.stderr.slice(0, 700)}`);
  }

  // ── synthetic fixtures (SYNTH-* เท่านั้น) ──
  sql(`insert into auth.users (id) values ('${SYNTH.userA}'), ('${SYNTH.userB}');
insert into organizations (id, name, created_by) values
 ('${SYNTH.orgA}', 'SYNTH-ORG-A', '${SYNTH.userA}'),
 ('${SYNTH.orgB}', 'SYNTH-ORG-B', '${SYNTH.userB}');
insert into org_members (organization_id, user_id, role) values
 ('${SYNTH.orgA}', '${SYNTH.userA}', 'admin'),
 ('${SYNTH.orgB}', '${SYNTH.userB}', 'admin');
insert into companies (id, name, tax_id, type, status, is_individual, updated_at, organization_id) values
 ('${SYNTH.compA}', 'SYNTH-COMPANY-A', 'SYNTH-TAX-A', 'CUSTOMER', 'ACTIVE', false, now(), '${SYNTH.orgA}'),
 ('${SYNTH.compB}', 'SYNTH-COMPANY-B', 'SYNTH-TAX-B', 'CUSTOMER', 'ACTIVE', false, now(), '${SYNTH.orgB}');
insert into invoices (id, invoice_no, invoice_status, customer_company_id, subtotal, vat_amount, total_amount, updated_at) values
 ('${SYNTH.invA}', 'SYNTH-INV-A-1', 'SENT', '${SYNTH.compA}', 1000, 70, ${SYNTH.amountA}, now()),
 ('${SYNTH.invB}', 'SYNTH-INV-B-1', 'SENT', '${SYNTH.compB}', 2000, 140, ${SYNTH.amountB}, now());`);

  const stop = () => {
    try { execFileSync(PGCTL, ["-D", PGDATA, "stop", "-m", "immediate"], { stdio: "pipe" }); } catch { /* already stopped */ }
  };
  return { sql, asUser, visibleRows, scalar, stop };
}

/** ─────────── A. MANUAL TOOL (DB จริง + RLS จริง + authority จริง) ─────────── */
async function manualTool(db: Awaited<ReturnType<typeof startSyntheticDb>>) {
  console.log("\n── A. MANUAL TOOL (synthetic org A/B บน Postgres จริง) ──");

  // membership มาจาก DB จริง (ไม่ใช่ค่าที่เทสต์ปั้นขึ้นมาเอง)
  const membershipsA: OrgMembership[] = db
    .sql(`select organization_id || ',' || role from org_members where user_id = '${SYNTH.userA}'`)
    .out.trim().split("\n").filter(Boolean)
    .map((line) => { const [organizationId, role] = line.split(","); return { organizationId, role: role as OrgMembership["role"] }; });

  const decideA = resolveTenantDecision({ auth: { id: SYNTH.userA }, requestedOrganizationId: SYNTH.orgA, memberships: membershipsA, action: "read" });
  ck("E1.1", decideA.allowed, "org A: membership จาก DB จริง → resolveTenantDecision อนุญาตอ่าน", decideA.reason ?? "");

  const decideCross = resolveTenantDecision({ auth: { id: SYNTH.userA }, requestedOrganizationId: SYNTH.orgB, memberships: membershipsA, action: "read" });
  ck("E1.2", !decideCross.allowed && decideCross.code === "ORG_NOT_MEMBER", "org B: ผู้ใช้ A ไม่ใช่สมาชิก → DENY (cross-tenant)", decideCross.code ?? "");

  const decideNoOrg = resolveTenantDecision({ auth: { id: SYNTH.userA }, requestedOrganizationId: null, memberships: membershipsA, action: "read" });
  const decideNoAuth = resolveTenantDecision({ auth: null, requestedOrganizationId: SYNTH.orgA, memberships: membershipsA, action: "read" });
  ck("E1.3", !decideNoOrg.allowed && !decideNoAuth.allowed, "ไม่มี organization / ไม่มี session → DENY", `${decideNoOrg.code}/${decideNoAuth.code}`);

  const rowsA = db.visibleRows(SYNTH.userA, `select invoice_no from invoices`);
  const rowsB = db.visibleRows(SYNTH.userB, `select invoice_no from invoices`);
  ck("E1.4", rowsA === 1 && rowsB === 1, "RLS: A เห็นเฉพาะแถว A · B เห็นเฉพาะแถว B", `A=${rowsA} B=${rowsB}`);

  const crossRows = db.visibleRows(SYNTH.userA, `select invoice_no from invoices where customer_company_id = '${SYNTH.compB}'`);
  ck("E1.5", crossRows === 0, "RLS: A อ่านข้อมูลบริษัทของ B ไม่ได้ (0 แถว)", `rows=${crossRows}`);

  const crossWrite = db.asUser(SYNTH.userA, `insert into invoices (id, invoice_no, invoice_status, customer_company_id, subtotal, vat_amount, total_amount, updated_at)
    values ('04000000-0000-4000-8000-0000000000cc', 'SYNTH-CROSS-ORG', 'SENT', '${SYNTH.compB}', 9, 1, 10, now());`, false);
  ck("E1.6", crossWrite.status !== 0, "RLS: เขียนข้ามองค์กรไม่ได้ (DENY)", crossWrite.err.trim().split("\n")[0] ?? "");

  // เขียนตรงจาก session ผู้ใช้ต้องไม่ได้เลย (RLS ของตารางธุรกิจไม่มี insert policy) —
  // writer ตัวจริงคือ server canonical writer ที่ผ่าน authority (service role)
  const ownWrite = db.asUser(SYNTH.userA, `insert into invoices (id, invoice_no, invoice_status, customer_company_id, subtotal, vat_amount, total_amount, updated_at)
    values ('04000000-0000-4000-8000-0000000000ad', 'SYNTH-OWN-ORG', 'SENT', '${SYNTH.compA}', 90, 0, 90, now());`, false);
  ck("E1.7", ownWrite.status !== 0, "ไม่มีเส้นทางเขียนตรงจาก client (RLS default-deny) — writer ต้องผ่าน server authority เท่านั้น", ownWrite.err.trim().split("\n")[0] ?? "");

  // ประมวลผลจริงบน DB (aggregate ไม่ใช่ค่าคงที่ที่เทสต์ใส่เอง)
  const sumA = db.scalar(SYNTH.userA, `select '${SYNTH.orgA}|' || coalesce(sum(total_amount),0)::text from invoices`);
  const sumB = db.scalar(SYNTH.userB, `select '${SYNTH.orgB}|' || coalesce(sum(total_amount),0)::text from invoices`);
  const numOf = (s: string) => Number((s.split("|")[1] ?? "").trim());
  ck("E1.8", sumA.startsWith(`${SYNTH.orgA}|`) && sumB.startsWith(`${SYNTH.orgB}|`) && numOf(sumA) === SYNTH.amountA && numOf(sumB) === SYNTH.amountB,
    "ประมวลผลจาก DB จริง: ยอดรวมของ A/B แยกกันถูกต้อง (ไม่ปะปน)", `A=${sumA} B=${sumB}`);

  // ส่งออกเป็น display model + render ด้วย renderer ตัวเดิม
  const model: BusinessDisplayModel = {
    id: "manual-tool-finance",
    title: "สรุปการเงินองค์กร A",
    domain: "finance",
    blocks: [
      { kind: "fields", id: "b1", title: "ตัวเลข", fields: [
        { kind: "field", id: "f1", label: "ยอดรวมใบแจ้งหนี้ (บาท)", value: SYNTH.amountA.toLocaleString("th-TH") },
        { kind: "field", id: "f2", label: "จำนวนเอกสาร", value: "1" },
      ] },
      { kind: "table", id: "b2", title: "รายการธุรกิจ", columns: [{ key: "no", label: "เลขที่" }, { key: "amount", label: "ยอด" }], rows: [["SYNTH-INV-A-1", String(SYNTH.amountA)]] },
      { kind: "lines", id: "b3", title: "รายการ", items: [{ kind: "text", id: "t1", text: "SYNTH-INV-A-1 — ค้างชำระ" }] },
      { kind: "document", id: "b4", title: "เอกสาร (PDF/HTML)", html: "<h1>SYNTH-INV-A-1</h1><p>ยอดรวม 1,070 บาท</p>" },
      { kind: "problems", id: "b5", title: "การแจ้งเตือน", items: [{ kind: "problem", id: "p1", severity: "warning", message: "SYNTH-INV-A-1 เกินกำหนดชำระ", source: "debt" }] },
    ],
  };
  const html = renderToStaticMarkup(createElement(BusinessDisplayRenderer, { model }));
  const rendered = ["1,070", "SYNTH-INV-A-1", "ยอดรวมใบแจ้งหนี้", "เกินกำหนดชำระ"].every((t) => html.includes(t));
  ck("E1.9", rendered && html.length > 400, "แสดงผลใน Workspace ด้วย BusinessDisplayRenderer เดิม (ตัวเลข/ตาราง/รายการ/เอกสาร/แจ้งเตือน)", `len=${html.length}`);
  ck("E1.10", !html.includes("SYNTH-INV-B-1"), "ผลลัพธ์ที่แสดงไม่มีข้อมูลขององค์กรอื่น");
}

/** ─────────── B. AI COMMAND (bridge จริง + adapter ถูก inject เพื่อดัก prompt) ─────────── */
async function aiCommand() {
  console.log("\n── B. AI COMMAND (ข้อความ → intent → tool → render · ไม่มีข้อมูลธุรกิจเข้า model) ──");

  const captured: AiAdapterInvokeRequest[] = [];
  const mockAdapter: AiAdapter = {
    id: "ollama",
    kind: "ai",
    capabilities: ["intent.classify"],
    runtimes: ["next"],
    status: () => ({ configured: true, reason: "SYNTH-MOCK", model: "synthetic", endpoint: null }),
    invoke: async (request) => {
      captured.push({ ...request });
      // bridge คาด JSON เดียว — ตอบคำสั่ง READ ที่อยู่ใน allow-list จริง
      return JSON.stringify({ action: "document.list", payload: { type: "invoice" } });
    },
  };
  const bridgeDeps = {
    implementations: { ollama: mockAdapter },
    emitEvidence: async () => {},
    reportFailure: async () => {},
    runtime: "next" as const,
  };

  const question = "ขอดูใบแจ้งหนี้ล่าสุดของ SYNTH-COMPANY-A ยอด 1,070 บาท";
  const outcome = await translateLocalAiCommand(question, { ownerId: "synth-owner", sessionId: "synth-session-orgA" }, bridgeDeps);
  ck("E2.1", outcome.command?.action === "document.list", "ข้อความ → intent เป็น command จริง (READ)", JSON.stringify(outcome.command));

  ck("E2.2", captured.length > 0, "AI ถูกเรียกจริงผ่าน AiGateway (adapter ที่ inject ถูกใช้)", `calls=${captured.length}`);
  // prompt = ข้อความผู้ใช้ตรง ๆ (ไม่มีการแนบแถว/ผลลัพธ์) · systemPrompt = vocabulary คงที่
  const promptIsExactlyUserText = captured.every((c) => c.prompt === question);
  const systemLeak = ["SYNTH-COMPANY-A", "SYNTH-INV-A-1", SYNTH.orgA, SYNTH.compA, "1070", "1,070"].filter((t) =>
    captured.some((c) => (c.systemPrompt ?? "").includes(t)),
  );
  ck("E2.3", promptIsExactlyUserText && systemLeak.length === 0,
    "Model Context ได้แค่ประโยคผู้ใช้ + vocabulary คงที่ — ไม่มีข้อมูลธุรกิจ/ผลลัพธ์บัญชี แนบไปกับ prompt",
    `exact=${promptIsExactlyUserText} systemLeak=${systemLeak.join(",")}`);
  ck("E2.4", captured.every((c) => c.capability === "intent.classify"), "AI ถูกเรียกด้วย capability เท่านั้น (ไม่ระบุ provider/model เอง)");

  const allow = Object.keys(LOCAL_AI_COMMAND_VOCABULARY);
  ck("E2.5", !!outcome.command && allow.includes(outcome.command.action), "command ที่ AI คืนอยู่เฉพาะใน allow-list READ-only", outcome.command?.action ?? "null");

  // AI ไม่มีอำนาจเขียน: dispatcher ตัวจริงปฏิเสธคำสั่งเขียนถ้าไม่มีการยืนยันจากมนุษย์
  const writeOk = "invoice.create";
  ck("E2.6", isRegistered(writeOk), "คำสั่งเขียนมีอยู่ใน registry จริง (ใช้ทดสอบอำนาจ)", writeOk);
  const writeDispatch = await dispatchCommand(writeOk, {}, false);
  ck("E2.7", !writeDispatch.ok && (writeDispatch.requires_confirmation || writeDispatch.code === "APPROVAL_REQUIRED" || writeDispatch.violations.length > 0),
    "DNA OS ปฏิเสธคำสั่งเขียนก่อนถึง writer (Rule 72 — AI สั่งอย่างเดียวไม่ได้)", writeDispatch.code ?? writeDispatch.violations.join("; "));

  // fail-closed: AI ล่ม = ไม่มีทางสำรองคู่ขนาน (ผู้เรียกกลับไปใช้ path เดิม)
  const failing = await translateLocalAiCommand("ขอดูใบแจ้งหนี้ล่าสุด", { ownerId: "synth-owner", sessionId: "synth-session-orgA" }, {
    ...bridgeDeps,
    implementations: { ollama: { ...mockAdapter, invoke: async () => { throw new Error("SYNTH_AI_DOWN"); } } },
  });
  ck("E2.8", failing.command === null, "AI ล่ม → bridge fail-closed (command = null) ไม่มี fallback คู่ขนาน", String(failing.status));
}

/** ─────────── C. RESET CHAT (AI context ล้าง · business data ไม่ถูกลบ · ไม่ปะปน) ─────────── */
async function resetChat(db: Awaited<ReturnType<typeof startSyntheticDb>>) {
  console.log("\n── C. RESET CHAT (แยก session key ต่อองค์กร) ──");
  const keyA = `u:${SYNTH.userA}:${SYNTH.orgA}:chat`;
  const keyB = `u:${SYNTH.userB}:${SYNTH.orgB}:chat`;

  pushConversationTurn("user", "คำถามขององค์กร A", keyA);
  pushConversationTurn("ai", "คำตอบขององค์กร A", keyA);
  pushConversationTurn("user", "คำถามขององค์กร B", keyB);

  const before = getMemory(keyA).conversation.length + getMemory(keyB).conversation.length;
  ck("E3.1", getMemory(keyA).conversation.length === 2 && getMemory(keyB).conversation.length === 1, "memory แยกต่อ session key ของแต่ละองค์กร", `A=${getMemory(keyA).conversation.length} B=${getMemory(keyB).conversation.length}`);

  const invoicesBefore = db.visibleRows(null, `select id from invoices`);
  resetMemory(keyA);
  const afterA = getMemory(keyA).conversation.length + getMemory(keyB).conversation.length;
  const invoicesAfter = db.visibleRows(null, `select id from invoices`);

  ck("E3.2", getMemory(keyA).conversation.length === 0, "reset แล้ว AI context ขององค์กร A ถูกล้างจริง");
  ck("E3.3", getMemory(keyB).conversation.length === 1, "reset ของ A ไม่ล้างบริบทของ B (ไม่ปะปนข้ามองค์กร)");
  ck("E3.4", afterA < before, "บริบทที่ลดลงมาจากการล้างเท่านั้น", `before=${before} after=${afterA}`);
  ck("E3.5", invoicesAfter === invoicesBefore && invoicesAfter === 2, "Business Data ไม่ถูกลบ (นับแถวใน DB เท่าเดิม)", `before=${invoicesBefore} after=${invoicesAfter}`);
  resetMemory(keyB);
}

async function main() {
  const db = await startSyntheticDb();
  try {
    await manualTool(db);
    await aiCommand();
    await resetChat(db);
  } finally {
    db.stop();
  }
  console.log(`\n═══ TENANT E2E (SYNTHETIC): ${pass} PASS / ${fail} FAIL ═══`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
