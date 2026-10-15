/**
 * surface-policy-test.ts — CONTROL SURFACE SEPARATION contract test
 * (owner directive 2026-10-12: ยุติแผนแยก Source Code แบบตัดความสัมพันธ์ —
 * คง Shared Capability ครบ แล้วแยกเฉพาะ Business/Developer CONTROL SURFACE).
 * Extended by the BUSINESS SURFACE SECURITY REPAIR (owner directive 2026-10-15).
 *
 * พิสูจน์กับไฟล์จริง + ฟังก์ชันจริง (ไม่ mock, ไม่ network):
 *   1. Business surface ถูก DENY developer-plane actions ทั้ง 4 ที่ API
 *      (source.modify · git.push · deployment.execute · developer.worker.execute)
 *      + development workflow ที่ /api/admin/dev-loop
 *   2. Developer surface ยังเดินเข้า Authority เดิมได้ (ไม่มี gate ใหม่)
 *   3. Business/LINE/Document/Finance/Connect API ไม่ถูกแตะ — พฤติกรรมเดิม
 *   4. (2026-10-15) developer-plane READ (Source Code / Git Status / Infrastructure)
 *      ถูก DENY ทุก HTTP method สำหรับ Business surface — READ ของธุรกิจยังผ่าน
 *   5. (2026-10-15) หน้า Developer/Infrastructure ถูก DENY ที่ server (ไม่ใช่แค่ซ่อนปุ่ม)
 *   6. (2026-10-15) NEGATIVE: employee / partner / customer เข้า development surface
 *      ไม่ได้เลย (canEnterSurface) และ role ที่ไม่ใช่ developer_tier ไม่ผ่าน /developer
 *   7. Navigation ของ Business ไม่มีทางเปิด Developer Tools
 *   8. middleware.ts บังคับจริงที่ runtime (ไม่ใช่แค่ซ่อนปุ่ม)
 *
 * Run: npx tsx scripts/surface-policy-test.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import {
  APP_SCOPE_HEADER,
  SURFACE_COOKIE,
  appScopeForPath,
  canEnterSurface,
  decideSurfaceAction,
  decideSurfacePage,
  resolveSurface,
  surfaceForPagePath,
} from "../core/auth/surfacePolicy";
import permissions from "../registry/permissions.json";

const ROOT = process.cwd();
let pass = 0;
let fail = 0;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const OPS = resolveSurface(undefined);
const DEV = resolveSurface("development");
const write = (pathname: string, surface = OPS) =>
  decideSurfaceAction({ pathname, method: "POST", surface });

// ── 1. surface resolution ต้อง fail-closed ──────────────────────────────────
check("resolveSurface(ไม่มี cookie) = operational (fail-closed)", OPS === "operational");
check("resolveSurface('garbage') = operational", resolveSurface("garbage") === "operational");
check("resolveSurface('') = operational", resolveSurface("") === "operational");
check("resolveSurface('development') = development", DEV === "development");
check(`SURFACE_COOKIE ชื่อเดียว = "${SURFACE_COOKIE}"`, SURFACE_COOKIE === "dna_os_surface");

// ── 2. DENY ตามที่ owner สั่ง (Business surface) ───────────────────────────
const denied: [string, string][] = [
  ["/api/admin/ide/file", "source.modify"],
  ["/api/admin/ide/fs/create", "source.modify"],
  ["/api/admin/ide/command", "source.modify"],
  ["/api/admin/ide/factory-workspace/sessions", "source.modify"],
  ["/api/admin/ide/git/commit", "git.push"],
  ["/api/admin/ide/deployment/plans", "deployment.execute"],
  ["/api/admin/ide/release/runs", "deployment.execute"],
  ["/api/admin/ide/build/runs", "deployment.execute"],
  ["/api/admin/ide/workers/execute", "developer.worker.execute"],
  ["/api/admin/ide/execution/run", "developer.worker.execute"],
  ["/api/admin/ide/queue/jobs", "developer.worker.execute"],
  ["/api/admin/dev-loop/approve", "developer.workflow.execute"],
];
for (const [path, action] of denied) {
  const d = write(path);
  check(`BUSINESS DENY ${action} · POST ${path}`, d.allowed === false && d.action === action,
    `allowed=${d.allowed} action=${d.action}`);
}
// ทุก write method บน ide ต้องถูกกัน (ไม่ใช่แค่ POST)
for (const method of ["PUT", "PATCH", "DELETE"]) {
  const d = decideSurfaceAction({ pathname: "/api/admin/ide/file", method, surface: OPS });
  check(`BUSINESS DENY ${method} /api/admin/ide/file`, d.allowed === false);
}

// ── 3. DEVELOPER surface: ผ่านไป Authority เดิม (ไม่มี gate ใหม่) ───────────
for (const [path] of denied) {
  const d = decideSurfaceAction({ pathname: path, method: "POST", surface: DEV });
  check(`DEVELOPER ALLOW (ส่งต่อ authority เดิม) POST ${path}`, d.allowed === true,
    d.reason);
}

// ── 4. developer-plane READ = DENY ทุก method (owner directive 2026-10-15) ──
// Source Code / Git Status / Infrastructure ไม่ใช่ shared capability ของผู้ใช้ธุรกิจ
for (const path of [
  "/api/admin/ide/file",
  "/api/admin/ide/tree",
  "/api/admin/ide/git/status",
  "/api/admin/ide/search",
  "/api/admin/infrastructure",
  "/api/admin/dev-loop/proposals",
]) {
  for (const method of ["GET", "HEAD"]) {
    const d = decideSurfaceAction({ pathname: path, method, surface: OPS });
    check(`BUSINESS DENY ${method} ${path} (developer-plane read)`, d.allowed === false,
      `allowed=${d.allowed}`);
  }
  const dDev = decideSurfaceAction({ pathname: path, method: "GET", surface: DEV });
  check(`DEVELOPER ALLOW GET ${path} (authority เดิม)`, dDev.allowed === true);
}
// READ ของธุรกิจต้องยังผ่าน (ห้ามทำให้ Workspace ใช้งานไม่ได้)
for (const path of [
  "/api/admin/partners",
  "/api/admin/jobs",
  "/api/admin/documents",
  "/api/admin/finance/summary",
  "/api/admin/line-customers",
  "/api/chat",
]) {
  const d = decideSurfaceAction({ pathname: path, method: "GET", surface: OPS });
  check(`BUSINESS READ ALLOW GET ${path}`, d.allowed === true, d.reason);
}

// ── 5. Business / LINE / Document / Finance / Connect ไม่ถูกแตะ ───────────
const businessWrites = [
  "/api/document/generate",
  "/api/admin/documents",
  "/api/admin/partners",
  "/api/admin/jobs",
  "/api/admin/transactions",
  "/api/admin/receipt-documents",
  "/api/admin/invoices",
  "/api/admin/finance/summary",
  "/api/admin/connectors/line/reply",
  "/api/admin/line-customers/U123/reply",
  "/api/admin/upload",
  "/api/chat",
  "/api/v1/mcp/business/dispatch",
];
for (const path of businessWrites) {
  const d = decideSurfaceAction({ pathname: path, method: "POST", surface: OPS });
  check(`BUSINESS WRITE ALLOW POST ${path}`, d.allowed === true, d.reason);
}

// ── 6. registry/permissions.json = ที่เดียวของ policy ─────────────────────
const policy = (permissions as {
  capability_actions?: {
    deny?: Record<string, { prefixes: string[] }>;
    deny_all?: Record<string, { prefixes: string[] }>;
    deny_pages?: Record<string, { prefixes: string[] }>;
    allow?: Record<string, { prefixes: string[] }>;
    surfaces?: Record<string, { entry_urls?: string[]; roles?: string[] }>;
    write_methods?: string[];
  };
}).capability_actions;
check("capability_actions ประกาศไว้ใน registry กลาง", !!policy);
const deny = policy?.deny ?? {};
for (const action of ["source.modify", "git.push", "deployment.execute", "developer.worker.execute"]) {
  check(`registry ประกาศ DENY ${action}`, Object.keys(deny).includes(action));
}
for (const action of ["business.read", "business.write", "document.generate", "connector.execute"]) {
  check(`registry ประกาศ ALLOW ${action}`, Object.keys(policy?.allow ?? {}).includes(action));
}
check(
  "DENY ไม่ครอบ path ธุรกิจ (document/chat/connect/finance/line/upload/mcp-business)",
  Object.values(deny)
    .flatMap((r) => r.prefixes)
    .every(
      (p) =>
        !/^(\/api\/document|\/api\/chat|\/api\/action|\/api\/v1\/mcp\/business|\/api\/admin\/(connectors|line-|finance|documents|partners|jobs|transactions|receipt|invoices|debt|materials|pits|equipment|upload))/.test(p),
    ),
);
const writeMethods = (policy?.write_methods ?? []).map((m) => m.toUpperCase());
check("write_methods = POST/PUT/PATCH/DELETE", ["POST", "PUT", "PATCH", "DELETE"].every((m) => writeMethods.includes(m)));
check(
  "surface entry: /workspace = operational · /developer = development",
  (policy?.surfaces?.operational?.entry_urls ?? []).includes("/workspace") &&
    (policy?.surfaces?.development?.entry_urls ?? []).includes("/developer"),
);
check("surfaceForPagePath('/workspace') = operational", surfaceForPagePath("/workspace") === "operational");
check("surfaceForPagePath('/developer') = development", surfaceForPagePath("/developer") === "development");
check("surfaceForPagePath('/admin/finance') = null (หน้าธุรกิจไม่สลับ surface)", surfaceForPagePath("/admin/finance") === null);

const routeAccess = (permissions as { route_access: { prefix: string; roles: string[] }[] }).route_access;
const roleTiers = (permissions as { role_tiers: Record<string, string[]> }).role_tiers;
const developerTier = [...roleTiers.developer_tier].sort();
const adminTier = [...roleTiers.admin_tier].sort();
const devRoute = routeAccess.find((r) => r.prefix === "/developer");
check(
  "route_access /developer = role_tiers.developer_tier (แยกจาก admin_tier แล้ว)",
  !!devRoute && JSON.stringify([...devRoute.roles].sort()) === JSON.stringify(developerTier),
  `roles=${JSON.stringify(devRoute?.roles)}`,
);
check(
  "NEGATIVE: employee ไม่อยู่ใน developer_tier (เข้า Developer Surface ไม่ได้)",
  !developerTier.includes("employee"),
);
check(
  "NEGATIVE: partner/customer ไม่อยู่ใน developer_tier",
  !developerTier.includes("partner") && !developerTier.includes("customer"),
);
check(
  "entry_urls ของ development surface เหลือ /developer ทางเดียว (ไม่มี admin dev route)",
  JSON.stringify(policy?.surfaces?.development?.entry_urls ?? []) === JSON.stringify(["/developer"]),
  JSON.stringify(policy?.surfaces?.development?.entry_urls),
);
check(
  "surfaces.development.roles ประกาศไว้ใน registry (ไม่ hardcode ใน middleware)",
  JSON.stringify([...(policy?.surfaces?.development?.roles ?? [])].sort()) === JSON.stringify(developerTier),
);
check("registry ประกาศ deny_all (developer-plane read ปิดทุก method)", Object.keys(policy?.deny_all ?? {}).length > 0);
check("registry ประกาศ deny_pages (หน้า developer/infrastructure)", Object.keys(policy?.deny_pages ?? {}).length > 0);
check(
  "deny_all/deny_pages ไม่ครอบ path ธุรกิจ (document/chat/finance/partners/jobs/line/connectors/upload)",
  [...Object.values(policy?.deny_all ?? {}), ...Object.values(policy?.deny_pages ?? {})]
    .flatMap((r) => (Array.isArray((r as { prefixes?: string[] }).prefixes) ? (r as { prefixes: string[] }).prefixes : []))
    .every(
      (p) =>
        !/^(\/api\/document|\/api\/chat|\/api\/action|\/api\/v1\/mcp\/business|\/api\/admin\/(connectors|line-|finance|documents|partners|jobs|transactions|receipt|invoices|debt|materials|pits|equipment|storage|users|event-inbox|upload|relationships))/.test(p),
    ),
);

// ── 7. middleware บังคับจริงที่ API/Runtime ────────────────────────────────
const middleware = read("middleware.ts");
check("middleware อ่าน SURFACE_COOKIE จาก policy", middleware.includes("SURFACE_COOKIE"));
check("middleware เรียก decideSurfaceAction (ตัวตัดสินใจจริง)", middleware.includes("decideSurfaceAction"));
check("middleware คืน 403 เมื่อ policy DENY", middleware.includes("status: 403") && middleware.includes("SURFACE_ACTION_DENIED"));
check("middleware สลับ surface เฉพาะ page navigation", middleware.includes("isPageNavigation") && middleware.includes("surfaceForPagePath"));
const protectedPagesLine = middleware.split("\n").find((l) => l.includes("PROTECTED_PAGE_PREFIXES")) ?? "";
check("middleware คุ้มครอง /developer (PROTECTED_PAGE_PREFIXES)", protectedPagesLine.includes('"/developer"'));
check("middleware matcher มี /developer/:path*", middleware.includes('"/developer/:path*"'));
check(
  "surfacePolicy ไม่แตะ session/requireAuth (Identity กลางเดิมยังเป็นผู้ตัดสินคนเดียว)",
  !read("core/auth/surfacePolicy.ts").includes("getAuthedUser"),
);
// (2026-10-15) PAGE deny + role-gated surface switch ต้องบังคับที่ middleware จริง
check("middleware เรียก decideSurfacePage (page deny จริง)", middleware.includes("decideSurfacePage"));
check("middleware คืน 404 สำหรับหน้า developer-plane", middleware.includes("status: 404"));
check("middleware เรียก canEnterSurface (role-gate ก่อนสลับ surface)", middleware.includes("canEnterSurface"));
check("middleware อ่าน role จาก profiles (ไม่สร้างระบบ auth ที่สอง)", middleware.includes('from("profiles")'));
check("middleware ไม่ hardcode role list (อ่านจาก registry ผ่าน canEnterSurface)", !/"super_admin"/.test(middleware));
check(
  "core/auth/session.ts export DEVELOPER_TIER จาก registry เดียวกัน",
  read("core/auth/session.ts").includes("export const DEVELOPER_TIER = permissions.role_tiers.developer_tier"),
);
check(
  "/developer page/layout ใช้ DEVELOPER_TIER (ไม่ใช่ ADMIN_TIER)",
  read("app/developer/layout.tsx").includes('requireAuthPage("/developer", DEVELOPER_TIER)') &&
    read("app/developer/page.tsx").includes('requireAuthPage("/developer", DEVELOPER_TIER)') &&
    !read("app/developer/layout.tsx").includes("ADMIN_TIER") &&
    !read("app/developer/page.tsx").includes("ADMIN_TIER"),
);

// ── 8. UI SEPARATION — Business Navigation ไม่มีทางเปิด Developer Tools ───
// (owner directive 2026-10-15: ขยายรายการเป็น "ทุกอย่างที่เจ้าของห้ามแสดง")
const DEV_ROUTES = [
  "/admin/ide",
  "/admin/dev-loop",
  "/admin/deploy",
  "/admin/ui-gallery",
  "/admin/infrastructure",
  "/admin/api-tokens",
  "/admin/schema-audit",
  "/admin/devices",
  "/admin/reader",
  "/admin/traces",
  "/admin/api-explorer",
  "/admin/engine-explorer",
  "/admin/system-config",
  "/admin/dna",
  "/admin/links",
  "/admin/backup",
  "/admin/settings",
];
const hasRouteLiteral = (src: string) => DEV_ROUTES.some((r) => src.includes(`"${r}"`));
const frame = read("app/workspace/WorkspaceFrame.tsx");
check("WorkspaceFrame (APPS/ACTIONS เมนูธุรกิจ) ไม่มี dev/infra route", !hasRouteLiteral(frame));
check("WorkspaceFrame ไม่มี external provider console URL (runpod/vercel/railway)", !/console\.runpod\.io|RUNPOD_CONSOLE_URL|vercel\.com|railway\.com/i.test(frame));
check("WorkspaceFrame ไม่มีปุ่ม Settings ที่พาไป /admin/settings", !frame.includes('router.push("/admin/settings")'));
const nav = read("core/navigation/resolveNavItems.ts");
check(
  "IconRail WORKSPACES ไม่มี developer workspace (ไม่มี href/label)",
  !nav.includes('"/developer"') && !nav.toLowerCase().includes("developer\"") && !nav.toLowerCase().includes("label: \"developer"),
);
const bindings = read("app/workspace/_lib/toolBindings.ts");
check("toolBindings/SETTINGS_BOXES ไม่มี dev route", !hasRouteLiteral(bindings));
const businessTools = read("app/workspace/_lib/businessTools.ts");
check(
  "HIDDEN_DEV_TOOLS ยังถูกซ่อนจาก business client (ไม่ลบ ไม่ย้าย)",
  businessTools.includes("HIDDEN_DEV_TOOLS") && businessTools.includes("ซ่อนจาก business client"),
);
check("/developer ไม่ render navigation ของ business", !read("app/developer/layout.tsx").includes("<WorkspaceToolNavigation"));
check(
  "admin layout ยังคง WorkspaceToolNavigation ของ business เหมือนเดิม (ไม่เปลี่ยน Business UI)",
  read("app/admin/layout.tsx").includes("WorkspaceToolNavigation"),
);
// ── 9. หน้า Developer Workspace + หน้าเครื่องมือเดิมยังอยู่ครบ ──────────────
for (const p of [
  "app/developer/layout.tsx",
  "app/developer/page.tsx",
  "app/admin/ide/page.tsx",
  "app/admin/dev-loop/page.tsx",
  "app/admin/deploy/page.tsx",
  "app/admin/ui-gallery/page.tsx",
]) {
  check(`มีหน้าจริง: ${p}`, existsSync(join(ROOT, p)));
}
check(
  "/developer gate ด้วย requireAuthPage(DEVELOPER_TIER) — แยกจาก /admin(ADMIN_TIER)",
  read("app/developer/layout.tsx").includes('requireAuthPage("/developer", DEVELOPER_TIER)') &&
    read("app/admin/layout.tsx").includes('requireAuthPage("/admin", ADMIN_TIER)') &&
    !read("app/developer/layout.tsx").includes("ADMIN_TIER"),
);

// ── 10. git.push — หลักฐานว่าวันนี้ไม่มี git write route (อ่านอย่างเดียว) ──
const gitWrites = ["commit", "push", "merge", "checkout", "reset", "rebase"].filter((op) =>
  existsSync(join(ROOT, `app/api/admin/ide/git/${op}/route.ts`)),
);
check("ไม่มี git write route ในระบบปัจจุบัน (ทุก git route เป็น read)", gitWrites.length === 0, gitWrites.join(","));

// ── 11. SHARED CAPABILITIES ยังอยู่ครบ + business ยัง import ได้เหมือนเดิม ──
// (owner directive 2026-10-15: แก้ให้ตรงกับ source จริง — เดิมเทสต์อ้าง
//  app/api/admin/ide/_lib/workerAdapterRegistry.ts ซึ่งไม่มีอยู่ในรีโปนี้เลย
//  ทั้งใน main และในสาขานี้. โมดูล worker adapter จริงคือโฟลเดอร์
//  app/api/admin/ide/_lib/workerAdapters/ + WORKER_ADAPTER_REGISTRY ใน
//  workerSelectorRuntime.ts — เทสต์จึงยืนยันของจริงที่ import กันอยู่)
const sharedModules = [
  "app/api/admin/ide/_lib/businessFailureBridge.ts",
  "app/api/admin/ide/_lib/businessAcceptanceRuntime.ts",
  "app/api/admin/ide/_lib/businessJobProgressRuntime.ts",
  "app/api/admin/ide/_lib/canonicalJobTransportRuntime.ts",
  "app/api/admin/ide/_lib/fsSecurity.ts",
  "app/api/admin/ide/_lib/workerSelectorRuntime.ts",
  "app/api/admin/ide/_lib/workerAdapter.ts",
  "app/api/admin/ide/_lib/workerAdapters/apiWorkerAdapter.ts",
  "app/api/admin/ide/_lib/workerAdapters/cliWorkerAdapter.ts",
  "app/api/admin/ide/_lib/workerAdapters/mcpWorkerAdapter.ts",
  "app/api/admin/ide/_lib/codeWorkerRuntime.ts",
  "app/api/admin/ide/_lib/executionRuntime.ts",
  "app/api/admin/ide/_lib/evidenceCollectorRuntime.ts",
];
for (const m of sharedModules) check(`shared module ยังอยู่: ${m}`, existsSync(join(ROOT, m)));
check(
  "workerSelectorRuntime ยัง export WORKER_ADAPTER_REGISTRY (ที่ catalog ใช้จริง)",
  read("app/api/admin/ide/_lib/workerSelectorRuntime.ts").includes("WORKER_ADAPTER_REGISTRY"),
);
check(
  "business ยัง import businessFailureBridge (Failure Bridge) เหมือนเดิม",
  read("app/api/chat/confirm/route.ts").includes("businessFailureBridge") &&
    read("app/api/admin/line-customers/[lineUserId]/reply/route.ts").includes("businessFailureBridge"),
);
check(
  "Document API ยัง import businessAcceptance/BusinessJobProgress เหมือนเดิม",
  read("app/api/admin/documents/route.ts").includes("businessAcceptanceRuntime") &&
    read("app/api/admin/documents/route.ts").includes("businessJobProgressRuntime"),
);
check(
  "connectors catalog ยัง import worker registry ตัวจริง (workerSelectorRuntime)",
  read("app/api/admin/connectors/_lib/catalog.ts").includes(
    'from "@/app/api/admin/ide/_lib/workerSelectorRuntime"',
  ) &&
    !read("app/api/admin/connectors/_lib/catalog.ts").includes("workerAdapterRegistry"),
);
check(
  "business prebuild ยังใช้ deploy-gate เดิม (ไม่มี gate ใหม่แทนที่)",
  read("package.json").includes("scripts/deploy-gate.ts"),
);
check(
  "ไม่มีการแตะ Supabase schema หรือ Canonical Finance/Document Writer ใน working tree (git diff --name-only HEAD)",
  (() => {
    const changed = execSync("git diff --name-only HEAD", { cwd: ROOT, encoding: "utf-8" })
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const forbidden = changed.filter((f) =>
      /^(supabase\/migrations\/|engines\/canonical\/|engines\/documents\/|gateway\/actions)/.test(f),
    );
    return forbidden.length === 0;
  })(),
);

// ── 12. NEGATIVE TESTS (owner directive 2026-10-15) ───────────────────────
// employee / partner / customer ต้องเข้าถึง Developer Surface / routes / APIs ไม่ได้
const NON_DEVELOPER_ROLES = ["employee", "partner", "customer", "ai_service"] as const;
for (const role of NON_DEVELOPER_ROLES) {
  check(`NEGATIVE: canEnterSurface("${role}", "development") = false`, canEnterSurface(role, "development") === false);
}
check("canEnterSurface('super_admin', 'development') = true", canEnterSurface("super_admin", "development") === true);
check("canEnterSurface(null, 'development') = false (fail-closed)", canEnterSurface(null, "development") === false);
check("canEnterSurface('employee', 'operational') = true", canEnterSurface("employee", "operational") === true);

// PAGE: developer/infra ถูกปฏิเสธที่ server สำหรับ operational surface
for (const path of DEV_ROUTES) {
  const deniedPage = decideSurfacePage({ pathname: path, surface: OPS });
  check(`NEGATIVE: operational เข้าหน้า ${path} ไม่ได้`, deniedPage.allowed === false, `allowed=${deniedPage.allowed}`);
  const devPage = decideSurfacePage({ pathname: path, surface: DEV });
  check(`DEVELOPER เข้าหน้า ${path} ได้ (authority เดิม)`, devPage.allowed === true);
}
check(
  "/developer ไม่ถูก page-deny (เป็น entry เดียวของ development surface)",
  decideSurfacePage({ pathname: "/developer", surface: OPS }).allowed === true,
);
// หน้าธุรกิจต้องไม่ถูกปิด (ห้ามทำให้ Workspace ใช้งานไม่ได้)
for (const path of ["/workspace", "/admin/relationships", "/admin/finance", "/admin/documents", "/admin/jobs", "/admin/partners", "/admin/storage", "/admin/users"]) {
  check(`BUSINESS PAGE ALLOW ${path}`, decideSurfacePage({ pathname: path, surface: OPS }).allowed === true);
}

// API: developer-plane ถูกปฏิเสธทุก HTTP method สำหรับ operational surface
for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]) {
  for (const path of [
    "/api/admin/ide/file",
    "/api/admin/ide/git/status",
    "/api/admin/ide/tree",
    "/api/admin/infrastructure",
    "/api/admin/dev-loop/proposals",
  ]) {
    const d = decideSurfaceAction({ pathname: path, method, surface: OPS });
    check(`NEGATIVE: operational ${method} ${path} = DENY`, d.allowed === false, `allowed=${d.allowed}`);
  }
}

// ── 13. STRICT APPLICATION SEPARATION (owner directive 2026-10-15) ─────────
// BUSINESS_APP = Business Workspace · Documents · Finance · Business Operations · Account
// DEVELOPER_APP = IDE · Source Code · AI Agents · Git/Runtime · Infrastructure
// กติกา: ห้ามมี cross-app navigation ในทุก role รวมถึง super_admin
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

// 13.1 app scope ต่อ path (มาจาก registry เดียวกัน ไม่ผูกกับ role)
for (const [path, scope] of [
  ["/admin/relationships", "business"],
  ["/admin/finance", "business"],
  ["/admin/documents", "business"],
  ["/admin/create-document", "business"],
  ["/admin/transactions", "business"],
  ["/admin/jobs", "business"],
  ["/admin/partners", "business"],
  ["/admin/storage", "business"],
  ["/admin/users", "business"],
  ["/workspace", "business"],
  ["/business", "business"],
  ["/admin", "business"],
  ["/admin/ide", "developer"],
  ["/admin/dev-loop", "developer"],
  ["/admin/deploy", "developer"],
  ["/admin/ui-gallery", "developer"],
  ["/admin/infrastructure", "developer"],
  ["/admin/api-tokens", "developer"],
  ["/admin/schema-audit", "developer"],
  ["/admin/devices", "developer"],
  ["/admin/settings", "developer"],
  ["/admin/backup", "developer"],
  ["/developer", "developer"],
] as const) {
  check(`APP SCOPE ${path} = ${scope}`, appScopeForPath(path) === scope, appScopeForPath(path));
}
check("APP_SCOPE_HEADER ชื่อเดียว = \"x-dnaos-app\"", APP_SCOPE_HEADER === "x-dnaos-app");

// 13.2 middleware stamp + strip header (composition signal ต้องปลอมไม่ได้)
check("middleware stamp APP_SCOPE_HEADER จาก appScopeForPath", middleware.includes("APP_SCOPE_HEADER") && middleware.includes("appScopeForPath"));
check("middleware strip header ที่ client ส่งมา ก่อน stamp", /requestHeaders\.delete\(APP_SCOPE_HEADER\)[\s\S]{0,120}requestHeaders\.set\(APP_SCOPE_HEADER/.test(middleware));

// 13.3 Business navigation ถูก render เฉพาะ Business App
const adminLayout = read("app/admin/layout.tsx");
check(
  "app/admin/layout.tsx อ่าน APP_SCOPE_HEADER",
  adminLayout.includes("APP_SCOPE_HEADER") && adminLayout.includes("requestHeaders.get(APP_SCOPE_HEADER)"),
);
check(
  "WorkspaceToolNavigation ถูก gate ด้วย app scope (ไม่ render แบบไม่มีเงื่อนไข)",
  /\{isBusinessApp && <WorkspaceToolNavigation \/>\}/.test(adminLayout) &&
    !/^\s*<WorkspaceToolNavigation \/>\s*$/m.test(adminLayout),
);
check(
  "gate เป็น scope-based ไม่ใช่ role-based (super_admin ก็ไม่เห็นสลับแอป)",
  !/role|super_admin|admin_tier/i.test(
    adminLayout.slice(adminLayout.indexOf("const appScope"), adminLayout.indexOf("const appScope") + 400),
  ),
);
check(
  "Developer App page (app/admin/ide) ใช้ layout เดียวกันแต่ได้ scope=developer",
  read("app/admin/ide/page.tsx").includes("IDEWorkspace"),
);

// 13.4 BUSINESS_APP: ไม่มี dev route literal ในซอร์สของ navigation/shell
const BUSINESS_SURFACES = [
  "app/workspace/WorkspaceFrame.tsx",
  "app/workspace/_lib/toolBindings.ts",
  "core/navigation/resolveNavItems.ts",
  "components/workspace/WorkspaceShell.tsx",
  "presentation/shell/navigation/IconRail.tsx",
  "app/business/layout.tsx",
  "app/partner/layout.tsx",
  "app/user/layout.tsx",
  "app/admin/layout.tsx",
  "app/workspace/page.tsx",
];
for (const f of BUSINESS_SURFACES) {
  const src = stripComments(read(f));
  const leaked = DEV_ROUTES.filter((r) => src.includes(`"${r}"`));
  check(`BUSINESS_APP ${f} ไม่มี dev route literal`, leaked.length === 0, leaked.join(","));
}

// 13.5 DEVELOPER_APP: ไม่มี business route literal ในซอร์สของ navigation/shell
const BUSINESS_ROUTES = [
  "/workspace",
  "/business",
  "/admin/relationships",
  "/admin/finance",
  "/admin/create-document",
  "/admin/documents",
  "/admin/jobs",
  "/admin/transactions",
  "/admin/debt-tracking",
  "/admin/partners",
  "/admin/storage",
  "/admin/event-inbox",
  "/admin/line-customers",
  "/admin/pits",
  "/admin/equipment",
];
const DEVELOPER_SURFACES = [
  "app/developer/layout.tsx",
  "app/developer/page.tsx",
  "components/ide-shell/IDEWorkspace.tsx",
];
for (const f of DEVELOPER_SURFACES) {
  const src = stripComments(read(f));
  const leaked = BUSINESS_ROUTES.filter((r) => src.includes(`"${r}"`));
  check(`DEVELOPER_APP ${f} ไม่มี business route literal`, leaked.length === 0, leaked.join(","));
}

// 13.6 super_admin ก็ยังแยกแอป (composition ไม่ขึ้นกับ role) + ยังเข้า dev ได้
check(
  "super_admin ยังเข้า development surface ได้ (ไม่ถูกตัดสิทธิ์โดยไม่ตั้งใจ)",
  canEnterSurface("super_admin", "development") === true,
);
check(
  "Developer App ไม่มี Business navigation ในทุกกรณี (role-independent gate)",
  DEVELOPER_SURFACES.every((f) => !stripComments(read(f)).includes("<WorkspaceToolNavigation")),
);
check(
  "Business App ไม่มี Developer navigation (ไม่มี WorkspaceToolNavigation แบบ dev / ไม่มี sidebar นักพัฒนา)",
  !read("app/workspace/WorkspaceFrame.tsx").includes("AdminSidebarNav") &&
    !read("app/business/layout.tsx").includes("AdminSidebarNav") &&
    !read("app/user/layout.tsx").includes("AdminSidebarNav") &&
    !read("app/partner/layout.tsx").includes("AdminSidebarNav"),
);
check(
  "Developer hub (/developer) มี navigation ของตัวเอง ไม่ปนเมนูธุรกิจ",
  read("app/developer/page.tsx").includes("DEV_NAV") && read("app/developer/page.tsx").includes("AdminSidebarNav"),
);

// 13.7 UI Gallery (อยู่ใน DEVELOPER app) — preview ของ shell/sidebar ต้องไม่ render
// เมนูธุรกิจที่กดข้ามแอปได้
const galleryHost = stripComments(read("app/admin/ui-gallery/_lib/componentHost.tsx"));
check(
  "UI Gallery ใช้ PREVIEW_NAV_ITEMS กับ shell preview (ไม่ใช้ REAL_NAV_ITEMS)",
  galleryHost.includes("PREVIEW_NAV_ITEMS") && !galleryHost.includes("navItems={REAL_NAV_ITEMS}"),
);
check(
  "UI Gallery sidebar preview ไม่มี href ของ route ธุรกิจจริง",
  !/href:\s*"\/(admin|workspace|business|partner|user)/.test(galleryHost),
);

console.log(`\n=== surface-policy: PASS ${pass} · FAIL ${fail} ===`);
if (fail > 0) process.exit(1);



