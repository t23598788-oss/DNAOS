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

  await test("Developer Workspace (/developer) ใช้ role_tiers.developer_tier — แยกจาก admin_tier (owner directive 2026-10-15)", () => {
    const dev = permissions.route_access.find((r) => r.prefix === "/developer");
    assert(!!dev, "/developer ไม่ได้ลงทะเบียนใน route_access");
    assert(
      !!dev && JSON.stringify([...dev.roles].sort()) === JSON.stringify([...permissions.role_tiers.developer_tier].sort()),
      "/developer roles ไม่ตรง developer_tier",
    );
    assert(!permissions.role_tiers.developer_tier.includes("employee"), "employee ต้องไม่อยู่ใน developer_tier");
    assert(!permissions.role_tiers.developer_tier.includes("partner"), "partner ต้องไม่อยู่ใน developer_tier");
    assert(!permissions.role_tiers.developer_tier.includes("customer"), "customer ต้องไม่อยู่ใน developer_tier");
  });

  await test("developer-plane READ ถูกปิดทุก method + หน้า developer/infra ถูกปิดที่ server (owner directive 2026-10-15)", () => {
    const ca = (permissions as unknown as {
      capability_actions?: {
        deny_all?: Record<string, { prefixes: string[] }>;
        deny_pages?: Record<string, { prefixes: string[] }>;
        surfaces?: Record<string, { entry_urls?: string[]; roles?: string[] }>;
      };
    }).capability_actions;
    assert(!!ca?.deny_all, "deny_all หายจาก registry");
    assert(!!ca?.deny_pages, "deny_pages หายจาก registry");
    const denyAllPrefixes = Object.values(ca?.deny_all ?? {}).flatMap((r) =>
      Array.isArray((r as { prefixes?: string[] }).prefixes) ? (r as { prefixes: string[] }).prefixes : [],
    );
    for (const p of ["/api/admin/ide", "/api/admin/infrastructure"]) {
      assert(denyAllPrefixes.includes(p), `deny_all ไม่ครอบ ${p}`);
    }
    const denyPagePrefixes = Object.values(ca?.deny_pages ?? {}).flatMap((r) =>
      Array.isArray((r as { prefixes?: string[] }).prefixes) ? (r as { prefixes: string[] }).prefixes : [],
    );
    for (const p of ["/admin/ide", "/admin/dev-loop", "/admin/deploy", "/admin/ui-gallery", "/admin/infrastructure", "/admin/api-tokens", "/admin/schema-audit", "/admin/devices", "/admin/settings"]) {
      assert(denyPagePrefixes.includes(p), `deny_pages ไม่ครอบ ${p}`);
    }
    assert(
      JSON.stringify(ca?.surfaces?.development?.entry_urls ?? []) === JSON.stringify(["/developer"]),
      "development entry_urls ต้องเหลือ /developer ทางเดียว",
    );
    assert(
      JSON.stringify([...(ca?.surfaces?.development?.roles ?? [])].sort()) === JSON.stringify([...permissions.role_tiers.developer_tier].sort()),
      "surfaces.development.roles ต้องตรงกับ developer_tier",
    );
    const middleware = source("middleware.ts");
    assert(middleware.includes("decideSurfacePage"), "middleware ไม่ได้บังคับ page deny");
    assert(middleware.includes("canEnterSurface"), "middleware ไม่ได้ role-gate การสลับ surface");
  });

  // ── CROSS-TENANT (owner directive 2026-10-15 ข้อ 10) ───────────────────────
  // ตรวจแบบ read-only/static เท่านั้น — ไม่อ่าน/ไม่เขียนข้อมูล production จริง:
  // ยืนยันว่าแต่ละ role เข้าได้เฉพาะ portal ของตัวเอง และ API ฝั่งผู้ดูแล
  // ต้องมี requireAuth(ADMIN_TIER) ที่ route เอง (ไม่พึ่ง middleware อย่างเดียว)
  await test("CROSS-TENANT: แต่ละ role เข้าได้เฉพาะ portal ของตัวเอง (route_access)", () => {
    const expect: Record<string, string[]> = {
      "/partner": ["super_admin", "admin", "partner"],
      "/user": ["super_admin", "admin", "customer"],
    };
    for (const [prefix, roles] of Object.entries(expect)) {
      const entry = permissions.route_access.find((r) => r.prefix === prefix);
      assert(!!entry, `${prefix} ไม่ได้ลงทะเบียน`);
      assert(
        JSON.stringify([...entry!.roles].sort()) === JSON.stringify([...roles].sort()),
        `${prefix} roles ไม่ตรงที่ประกาศ`,
      );
    }
    const partner = permissions.route_access.find((r) => r.prefix === "/partner")!;
    assert(!partner.roles.includes("customer"), "customer ต้องไม่เข้า /partner");
    const user = permissions.route_access.find((r) => r.prefix === "/user")!;
    assert(!user.roles.includes("partner"), "partner ต้องไม่เข้า /user");
    assert(!partner.roles.includes("employee") && !user.roles.includes("employee"), "employee ต้องไม่เข้า /partner หรือ /user");
  });

  await test("CROSS-TENANT: workspace_landing แยก portal ต่อ role (ไม่มี role ข้าม portal)", () => {
    const landing = (permissions as unknown as { workspace_landing: Record<string, string> }).workspace_landing;
    assert(landing.customer === "/user", "customer ต้องลงที่ /user ของตัวเอง");
    assert(landing.partner === "/partner", "partner ต้องลงที่ /partner ของตัวเอง");
    for (const r of ["super_admin", "admin", "employee"]) {
      assert(!["/user", "/partner"].includes(landing[r]), `${r} ต้องไม่ลง portal ของ partner/customer`);
    }
  });

  await test("CROSS-TENANT: API ฝั่งผู้ดูแลยังมี requireAuth(ADMIN_TIER) ที่ route เอง (defense in depth)", () => {
    for (const rel of [
      "app/api/admin/partners/route.ts",
      "app/api/admin/transactions/route.ts",
      "app/api/admin/documents/route.ts",
      "app/api/admin/infrastructure/route.ts",
    ]) {
      const text = source(rel);
      assert(/requireAuth\(\s*ADMIN_TIER\s*\)/.test(text), `${rel} ไม่ได้เรียก requireAuth(ADMIN_TIER)`);
    }
  });

  await test("CROSS-TENANT: middleware ยังคุ้มครองทุก prefix ของ partner/customer (ไม่เปิดช่องข้าม)", () => {
    const middleware = source("middleware.ts");
    for (const p of ["/admin", "/business", "/user", "/partner"]) {
      assert(middleware.includes(`"${p}"`), `middleware matcher/PROTECTED_PAGE_PREFIXES ขาด ${p}`);
    }
  });

  console.log("\n=== CORE.PERMISSION_POLICY contract ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  if (passed !== results.length) { console.error(`\n${results.length - passed} test(s) failed.`); process.exit(1); }
}

main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
