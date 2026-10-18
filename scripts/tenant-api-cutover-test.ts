/**
 * STEP 2 — ADMIN API TENANT CUTOVER TEST (owner mission REMAINING GAPS EXECUTION)
 *
 * พิสูจน์ 2 ชั้น:
 *   A) decision matrix ของ core/auth/tenantApiPolicy.ts (จุดเดียวที่ middleware ใช้)
 *      — 401 / 403 ORG_REQUIRED / 403 ORG_NOT_MEMBER / 403 PERMISSION_DENIED / allowed
 *   B) HTTP จริง: boot Next server แล้วยิง business API โดยไม่มี session → ต้องได้ 401
 *      (middleware gate ทำงานก่อน route เสมอ; ไม่มีข้อมูลธุรกิจหลุดใน body)
 *
 * ข้อจำกัดที่รายงานตรง: path "allowed user → 200" และ "cross-tenant → 403" ที่ต้องมี
 * session จริง ไม่สามารถทดสอบกับ production ได้ (ห้ามสร้าง/แก้ผู้ใช้ production และ
 * เครื่องนี้ไม่มี Docker/Supabase stack สำหรับ local auth) — รายงานเป็น BLOCKED
 * พร้อมหลักฐาน ไม่แปลงเป็น PASS
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { createServer } from "node:net";
import { decideTenantApi, isBusinessApiPath } from "../core/auth/tenantApiPolicy";

let pass = 0;
function check(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`PASS  ${name}`);
}

const memberships = [
  { organizationId: "org-a", role: "admin" },
  { organizationId: "org-b", role: "member" },
];

// ── A) decision matrix ──────────────────────────────────────────────────────
check("path นอก business API = exempt (ไม่เปลี่ยนพฤติกรรมเดิม)", () => {
  assert.equal(isBusinessApiPath("/api/admin/ide/operations"), false);
  assert.equal(decideTenantApi({ pathname: "/api/admin/ide/operations", method: "POST", authenticated: false, cookieOrgId: null, memberships: null }).allowed, true);
});
check("ไม่มี session → 401 AUTH_REQUIRED", () => {
  const d = decideTenantApi({ pathname: "/api/admin/documents", method: "GET", authenticated: false, cookieOrgId: "org-a", memberships });
  assert.equal(d.status, 401); assert.equal(d.code, "AUTH_REQUIRED");
});
check("มี session แต่ไม่มี org context → 403 ORG_REQUIRED", () => {
  const d = decideTenantApi({ pathname: "/api/admin/documents", method: "GET", authenticated: true, cookieOrgId: null, memberships });
  assert.equal(d.status, 403); assert.equal(d.code, "ORG_REQUIRED");
});
check("org ที่ไม่ใช่ membership → 403 ORG_NOT_MEMBER (cross-tenant)", () => {
  const d = decideTenantApi({ pathname: "/api/admin/documents", method: "GET", authenticated: true, cookieOrgId: "org-c", memberships });
  assert.equal(d.status, 403); assert.equal(d.code, "ORG_NOT_MEMBER");
});
check("อ่าน membership ไม่ได้ → 403 fail-closed", () => {
  const d = decideTenantApi({ pathname: "/api/admin/finance-summary", method: "GET", authenticated: true, cookieOrgId: "org-a", memberships: null });
  assert.equal(d.status, 403); assert.equal(d.code, "ORG_NOT_MEMBER");
});
check("member อ่านได้ (read) แต่อ่านต่าง org ไม่ได้", () => {
  assert.equal(decideTenantApi({ pathname: "/api/admin/documents", method: "GET", authenticated: true, cookieOrgId: "org-b", memberships }).allowed, true);
  assert.equal(decideTenantApi({ pathname: "/api/admin/documents", method: "GET", authenticated: true, cookieOrgId: "org-a", memberships: [{ organizationId: "org-b", role: "member" }] }).allowed, false);
});
check("member เขียนไม่ได้ → 403 PERMISSION_DENIED", () => {
  const d = decideTenantApi({ pathname: "/api/admin/documents", method: "POST", authenticated: true, cookieOrgId: "org-b", memberships });
  assert.equal(d.status, 403); assert.equal(d.code, "PERMISSION_DENIED");
});
check("admin เขียนได้ใน org ของตัวเอง", () => {
  assert.equal(decideTenantApi({ pathname: "/api/admin/documents/abc/confirm", method: "POST", authenticated: true, cookieOrgId: "org-a", memberships }).allowed, true);
});
check("nested business path ถูกจับ (documents/:id, finance/*)", () => {
  assert.equal(isBusinessApiPath("/api/admin/documents/abc"), true);
  assert.equal(isBusinessApiPath("/api/admin/finance/audit"), true);
  assert.equal(isBusinessApiPath("/api/admin/documentsx"), false);
});
check("PATH traversal/ซ้อน org ใน URL ไม่มีผล (org มาจาก cookie เท่านั้น)", () => {
  const d = decideTenantApi({ pathname: "/api/admin/documents?organization=b", method: "GET", authenticated: true, cookieOrgId: "org-a", memberships });
  assert.equal(d.allowed, true);
});

// ── B) HTTP จริง ────────────────────────────────────────────────────────────
function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer(); s.unref(); s.on("error", rej);
    s.listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); });
  });
}
async function waitReady(base: string, timeoutMs: number) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const r = await fetch(base + "/login", { signal: AbortSignal.timeout(5000) });
      if (r.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Next dev server ยังไม่พร้อมภายในเวลาที่กำหนด");
}

async function main() {
const port = await freePort();
let server: ChildProcess | null = null;
try {
  const repo = path.join(__dirname, "..");
  server = spawn(process.execPath, [path.join(repo, "node_modules", "next", "dist", "bin", "next"), "dev", "-p", String(port)], {
    cwd: repo,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    detached: true,
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;
  await waitReady(base, 180_000);

  for (const path of ["/api/admin/documents", "/api/admin/company-expenses", "/api/admin/finance-summary"]) {
    const r = await fetch(base + path, { signal: AbortSignal.timeout(30_000) });
    const body = await r.text();
    assert.equal(r.status, 401, `HTTP ${path} ต้องได้ 401 (ได้ ${r.status})`);
    assert.ok(!/invoice|amount|ยอด|บริษัท/i.test(body), `HTTP ${path} ต้องไม่คืนข้อมูลธุรกิจ (body=${body.slice(0, 120)})`);
    console.log(`PASS  HTTP ${path} → ${r.status} (session gate, ไม่มีข้อมูลธุรกิจใน body)`);
    pass++;
  }
  console.log("NOTE  HTTP allowed-user=200 / cross-tenant=403 ต้องมี session จริง — BLOCKED (production auth ห้ามแก้, ไม่มี local Supabase stack)");
} finally {
  if (server?.pid) {
    try { process.kill(-server.pid, "SIGTERM"); } catch {}
    await new Promise((r) => setTimeout(r, 800));
    try { process.kill(-server.pid, "SIGKILL"); } catch {}
  }
}

  console.log(`\n═══ ADMIN API TENANT CUTOVER: ${pass} checks PASS ═══`);
  console.log(`EXIT_CODE=0`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
