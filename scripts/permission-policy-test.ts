/**
 * CORE.PERMISSION_POLICY — permission layer contract test (owner directive
 * 2026-09-22, core chain step IDENTITY -> PERMISSION).
 *
 * Proves, against the real files only (no mocks):
 *   1. registry/permissions.json is the single source of role -> access
 *   2. core/auth/* actually reads it (no route hardcodes its own role list)
 *   3. the tier constants the API routes import really come from there
 *   4. the permission layer is NOT owner authority — super_admin is a
 *      permission, never owner proof (owner decision 2026-09-22)
 *
 * Run: npm run permission-policy:test
 */
import { readFileSync } from "fs";
import path from "path";

const ROOT = path.join(__dirname, "..");
const source = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }

interface Permissions {
  roles: { id: string }[];
  role_tiers: Record<string, string[]>;
  route_access: { prefix: string; roles: string[]; except?: string[] }[];
  api_access: { prefix: string; roles: string[]; reason?: string }[];
  public_routes: string[];
}

async function main() {
  const permissions = JSON.parse(source("registry/permissions.json")) as Permissions;
  const session = source("core/auth/session.ts");
  const requireAuth = source("core/auth/requireAuth.ts");
  const requireAuthPage = source("core/auth/requireAuthPage.ts");

  await test("registry/permissions.json declares roles, tiers and the two access maps", () => {
    assert(Array.isArray(permissions.roles) && permissions.roles.length >= 4, "roles missing");
    assert(permissions.role_tiers && typeof permissions.role_tiers === "object", "role_tiers missing");
    assert(Array.isArray(permissions.route_access) && permissions.route_access.length > 0, "route_access missing");
    assert(Array.isArray(permissions.api_access) && permissions.api_access.length > 0, "api_access missing");
  });

  await test("every role used by access maps and tiers is a declared role id", () => {
    const declared = new Set(permissions.roles.map((r) => r.id));
    const used = [
      ...permissions.route_access.flatMap((entry) => entry.roles ?? []),
      ...permissions.api_access.flatMap((entry) => entry.roles ?? []),
      ...Object.values(permissions.role_tiers).flat(),
    ];
    const unknown = [...new Set(used)].filter((role) => !declared.has(role));
    assert(unknown.length === 0, `undeclared role(s): ${unknown.join(", ")}`);
  });

  await test("super_admin exists as a permission role and owns its own tier", () => {
    assert(permissions.roles.some((r) => r.id === "super_admin"), "super_admin role missing");
    assert(
      Array.isArray(permissions.role_tiers.super_admin_only) && permissions.role_tiers.super_admin_only.includes("super_admin"),
      "super_admin_only tier does not contain super_admin"
    );
  });

  await test("the auth layer reads the permission registry (session.ts is the single reader)", () => {
    assert(session.includes('from "@/registry/permissions.json"'), "session.ts does not import the permission registry");
    assert(session.includes("permissions.role_tiers.admin_tier"), "session.ts does not read role_tiers");
    assert(session.includes("export const ADMIN_TIER"), "ADMIN_TIER is not exported from the auth layer");
    assert(!/roles\s*=\s*\[/.test(requireAuth), "requireAuth.ts declares its own role list");
    assert(requireAuth.includes('from "./session"'), "requireAuth.ts does not consume the auth layer constants");
    assert(requireAuthPage.includes('from "./session"'), "requireAuthPage.ts does not consume the auth layer constants");
  });

  await test("tier constants come from the auth layer, not from route files", () => {
    const decide = source("app/api/gateway/proposals/[id]/decide/route.ts");
    assert(decide.includes('from "@/core/auth/session"'), "decide route does not import tier constants from core/auth");
    assert(decide.includes("requireAuth("), "decide route does not call the permission guard");
  });

  await test("permission is never presented as owner authority in privileged routes", () => {
    for (const rel of ["app/api/gateway/proposals/[id]/decide/route.ts", "app/api/v1/mcp/governance/_lib/auth.ts"]) {
      const text = source(rel);
      const usedAsAuthority = /===\s*["']super_admin["']|includes\(\s*["']super_admin["']|role\s*===\s*["']super_admin["']/.test(text);
      assert(!usedAsAuthority, `${rel} uses super_admin as an authority check`);
    }
  });

  // ── CONTROL SURFACE SEPARATION (owner directive 2026-10-12) — authority กลาง
  //    เดิมไฟล์เดียวกัน + บังคับที่ runtime จริง (ไม่ใช่แค่ซ่อนปุ่ม)
  await test("capability_actions lives in the SAME registry (ไม่มี permission ไฟล์ที่สอง)", () => {
    const ca = (permissions as unknown as {
      capability_actions?: { deny?: Record<string, unknown>; allow?: Record<string, unknown> };
    }).capability_actions;
    assert(!!ca && typeof ca === "object", "capability_actions หายจาก registry/permissions.json");
    const deny = ca?.deny ?? {};
    const allow = ca?.allow ?? {};
    for (const action of ["source.modify", "git.push", "deployment.execute", "developer.worker.execute"]) {
      assert(action in deny, `DENY ${action} ไม่ถูกประกาศ`);
    }
    for (const action of ["business.read", "business.write", "document.generate", "connector.execute"]) {
      assert(action in allow, `ALLOW ${action} ไม่ถูกประกาศ`);
    }
  });

  await test("API runtime enforces capability_actions (middleware เรียก policy จริง)", () => {
    const middleware = source("middleware.ts");
    assert(middleware.includes("decideSurfaceAction"), "middleware ไม่ได้เรียก policy");
    assert(middleware.includes("SURFACE_ACTION_DENIED"), "middleware ไม่มีการปฏิเสธ (403)");
    assert(
      source("core/auth/surfacePolicy.ts").includes('from "@/registry/permissions.json"'),
      "policy ไม่ได้อ่าน registry กลาง",
    );
  });

  await test("Developer Workspace (/developer) ใช้ admin_tier ชุดเดียวกับ /admin — ไม่มีสิทธิ์ใหม่", () => {
    const dev = permissions.route_access.find((r) => r.prefix === "/developer");
    assert(!!dev, "/developer ไม่ได้ลงทะเบียนใน route_access");
    assert(
      !!dev && JSON.stringify([...dev.roles].sort()) === JSON.stringify([...permissions.role_tiers.admin_tier].sort()),
      "/developer roles ไม่ตรง admin_tier",
    );
  });

  console.log("\n=== CORE.PERMISSION_POLICY contract ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  if (passed !== results.length) { console.error(`\n${results.length - passed} test(s) failed.`); process.exit(1); }
}

main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
