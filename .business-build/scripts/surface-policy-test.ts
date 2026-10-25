/**
 * surface-policy-test.ts — CONTROL SURFACE SEPARATION contract test
 * (owner directive 2026-10-12: ยุติแผนแยก Source Code แบบตัดความสัมพันธ์ —
 * คง Shared Capability ครบ แล้วแยกเฉพาะ Business/Developer CONTROL SURFACE).
 *
 * พิสูจน์กับไฟล์จริง + ฟังก์ชันจริง (ไม่ mock, ไม่ network):
 *   1. Business surface ถูก DENY developer-plane actions ทั้ง 4 ที่ API
 *      (source.modify · git.push · deployment.execute · developer.worker.execute)
 *      + development workflow ที่ /api/admin/dev-loop
 *   2. Developer surface ยังเดินเข้า Authority เดิมได้ (ไม่มี gate ใหม่)
 *   3. Business/LINE/Document/Finance/Connect API ไม่ถูกแตะ — พฤติกรรมเดิม
 *   4. อ่าน (GET/HEAD) คงเดิมทั้งสอง surface — Shared Capabilities ใช้ได้ตามเคย
 *   5. Navigation ของ Business ไม่มีทางเปิด Developer Tools
 *   6. middleware.ts บังคับจริงที่ runtime (ไม่ใช่แค่ซ่อนปุ่ม)
 *
 * Run: npx tsx scripts/surface-policy-test.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import {
  SURFACE_COOKIE,
  decideChatCapability,
  decideSurfaceAction,
  enforceChatDirectivePolicy,
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

// ── 4. READ คงเดิมทั้งสอง surface — Shared Capabilities ของ Business ───────
for (const path of [
  "/api/admin/ide/file",
  "/api/admin/ide/tree",
  "/api/admin/ide/git/status",
  "/api/admin/ide/search",
]) {
  const d = decideSurfaceAction({ pathname: path, method: "GET", surface: OPS });
  check(`BUSINESS READ ALLOW GET ${path} (source READ ≠ WRITE)`, d.allowed === true);
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
    allow?: Record<string, { prefixes: string[] }>;
    surfaces?: Record<string, { entry_urls?: string[] }>;
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
check(
  " DEVELOPER entry มีทางเดียว = /developer (หน้า dev ตัวอื่นสลับ surface ไม่ได้)",
  JSON.stringify(policy?.surfaces?.development?.entry_urls ?? []) === JSON.stringify(["/developer"]),
);
check("surfaceForPagePath('/workspace') = operational", surfaceForPagePath("/workspace") === "operational");
check("surfaceForPagePath('/developer') = development", surfaceForPagePath("/developer") === "development");
check("surfaceForPagePath('/admin/finance') = null (หน้าธุรกิจไม่สลับ surface)", surfaceForPagePath("/admin/finance") === null);

// ── 6b. UI LEAK (/admin/dbd) — ปุ่ม Developer/Deploy/API Explorer ต้องไม่พาข้ามสิทธิ์ ─
for (const page of ["/admin/dbd", "/admin/deploy", "/admin/api-explorer", "/admin/ide", "/admin/dev-loop", "/admin/ui-gallery", "/admin/dna", "/admin/traces"]) {
  check(`ไม่มีหน้าใดนอกจาก /developer สลับเป็น development: ${page}`, surfaceForPagePath(page) === null);
}
const dbd = read("app/admin/dbd/page.tsx");
const dbdFetches = [...dbd.matchAll(/fetch\(\s*[`"']([^`"'?]+)/g)].map((m) => m[1]);
check(
  "/admin/dbd เรียกเฉพาะ API อ่าน (ไม่มี POST/PUT/PATCH/DELETE ไปยัง developer write endpoint)",
  dbdFetches.length > 0 && dbdFetches.every((u) => u.startsWith("/api/")) && !/method:\s*["'](POST|PUT|PATCH|DELETE)["']/.test(dbd),
  JSON.stringify(dbdFetches),
);
check(
  "/admin/dbd ไม่มีทางเรียก developer write API (ide/dev-loop write)",
  !/api\/admin\/(ide|dev-loop)/.test(dbd),
);
check(
  "ปุ่มใน /admin/dbd ชี้ไปหน้าอ่านอย่างเดียว (Deploy/Explorer/Reader/Traces/DNA) — ไม่มีปุ่มไหนเป็น entry ของ development surface",
  ["/admin/deploy", "/admin/api-explorer", "/admin/reader", "/admin/traces", "/admin/dna"].every(
    (p) => surfaceForPagePath(p) === null,
  ),
);

const routeAccess = (permissions as { route_access: { prefix: string; roles: string[] }[] }).route_access;
const adminTier = [...((permissions as { role_tiers: { admin_tier: string[] } }).role_tiers.admin_tier)].sort();
const devRoute = routeAccess.find((r) => r.prefix === "/developer");
check(
  "route_access /developer = admin_tier ชุดเดียวกับ /admin (ไม่มีสิทธิ์ใหม่)",
  !!devRoute && JSON.stringify([...devRoute.roles].sort()) === JSON.stringify(adminTier),
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

// ── 8. UI SEPARATION — Business Navigation ไม่มีทางเปิด Developer Tools ───
const DEV_ROUTES = ["/admin/ide", "/admin/dev-loop", "/admin/deploy", "/admin/ui-gallery"];
const hasRouteLiteral = (src: string) => DEV_ROUTES.some((r) => src.includes(`"${r}"`));
const frame = read("app/workspace/WorkspaceFrame.tsx");
check("WorkspaceFrame (APPS/ACTIONS เมนูธุรกิจ) ไม่มี dev route", !hasRouteLiteral(frame));
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
  "admin layout ไม่ render legacy WorkspaceToolNavigation ที่ซ้ำกับ shell หลัก",
  !read("app/admin/layout.tsx").includes("WorkspaceToolNavigation"),
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
  "/developer gate ด้วย requirePlatformOperatorPage (owner directive 2026-10-20) และ /admin ยังใช้ ADMIN_TIER",
  read("app/developer/layout.tsx").includes('requirePlatformOperatorPage("/developer")') &&
    read("app/admin/layout.tsx").includes('requireAuthPage("/admin", ADMIN_TIER)'),
);
check(
  "/admin/deploy และ /admin/dbd ถูก gate ด้วย requirePlatformOperatorPage",
  read("app/admin/deploy/layout.tsx").includes("requirePlatformOperatorPage") &&
    read("app/admin/dbd/layout.tsx").includes("requirePlatformOperatorPage"),
);

// ── 10. git.push — หลักฐานว่าวันนี้ไม่มี git write route (อ่านอย่างเดียว) ──
const gitWrites = ["commit", "push", "merge", "checkout", "reset", "rebase"].filter((op) =>
  existsSync(join(ROOT, `app/api/admin/ide/git/${op}/route.ts`)),
);
check("ไม่มี git write route ในระบบปัจจุบัน (ทุก git route เป็น read)", gitWrites.length === 0, gitWrites.join(","));

// ── 11. SHARED CAPABILITIES ยังอยู่ครบ + business ยัง import ได้เหมือนเดิม ──
const sharedModules = [
  "app/api/admin/ide/_lib/businessFailureBridge.ts",
  "app/api/admin/ide/_lib/businessAcceptanceRuntime.ts",
  "app/api/admin/ide/_lib/businessJobProgressRuntime.ts",
  "app/api/admin/ide/_lib/canonicalJobTransportRuntime.ts",
  "app/api/admin/ide/_lib/fsSecurity.ts",
  "app/api/admin/ide/_lib/workerSelectorRuntime.ts",
  "app/api/admin/ide/_lib/workerAdapterRegistry.ts",
  "app/api/admin/ide/_lib/codeWorkerRuntime.ts",
  "app/api/admin/ide/_lib/executionRuntime.ts",
  "app/api/admin/ide/_lib/evidenceCollectorRuntime.ts",
];
for (const m of sharedModules) check(`shared module ยังอยู่: ${m}`, existsSync(join(ROOT, m)));
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
  "connectors catalog ยัง import worker registry (shared dependency ไม่ถูกตัด)",
  read("app/api/admin/connectors/_lib/catalog.ts").includes("workerAdapterRegistry"),
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

// ── 12. CHAT SURFACE POLICY — ADMIN_CHAT (owner directive 2026-10-18) ─────
// SURFACE: ADMIN_CHAT · ALLOW: capability.read/document.read/finance.read/
// analytics.read/result.render.inline · CONDITIONAL: document.create/
// finance.write/message.send (ผ่าน flow ยืนยันเดิมเท่านั้น) · DENY:
// screen.navigate/window.switch/route.push/browser.open/desktop.control/
// jarvis.screen_control
const chatSurface = (
  permissions as {
    capability_actions?: {
      chat?: {
        deny_wins?: boolean;
        fail_closed?: boolean;
        surfaces?: Record<string, {
          allow?: string[];
          conditional?: string[];
          deny?: string[];
          deny_map?: Record<string, string[]>;
        }>;
      };
    };
  }
).capability_actions?.chat;
const adminChat = chatSurface?.surfaces?.ADMIN_CHAT;
check("registry ประกาศ capability_actions.chat + surface ADMIN_CHAT", !!adminChat);
check(
  "ADMIN_CHAT ALLOW ครบ 5 ตามคำสั่ง owner",
  JSON.stringify([...(adminChat?.allow ?? [])].sort()) ===
    JSON.stringify(["analytics.read", "capability.read", "document.read", "finance.read", "result.render.inline"].sort()),
);
check(
  "ADMIN_CHAT CONDITIONAL ครบ 3 ตามคำสั่ง owner",
  JSON.stringify([...(adminChat?.conditional ?? [])].sort()) ===
    JSON.stringify(["document.create", "finance.write", "message.send"].sort()),
);
check(
  "ADMIN_CHAT DENY ครบ 6 ตามคำสั่ง owner",
  JSON.stringify([...(adminChat?.deny ?? [])].sort()) ===
    JSON.stringify(["browser.open", "desktop.control", "jarvis.screen_control", "route.push", "screen.navigate", "window.switch"].sort()),
);
check("chat policy include fail-closed + deny ชนะเสมอ (deny_wins)", chatSurface?.deny_wins === true && chatSurface?.fail_closed === true);

// surface ที่ไม่ประกาศ = DENY (fail-closed)
check(
  "decideChatCapability: surface ไม่รู้จัก = DENY",
  decideChatCapability({ surface: "GHOST", capability: "capability.read" }).allowed === false,
);

// ALLOW: อ่าน/แสดงผลได้ตรงตามประกาศ
for (const cap of ["capability.read", "document.read", "finance.read", "analytics.read", "result.render.inline"]) {
  const d = decideChatCapability({ capability: cap });
  check(`ADMIN_CHAT ALLOW ${cap}`, d.allowed === true && d.action === "allow");
}
for (const cap of ["capability.spawn", "source.modify", "git.push"]) {
  const d = decideChatCapability({ capability: cap });
  check(`ADMIN_CHAT ไม่อยู่ใน allow/conditional = DENY ${cap}`, d.allowed === false && d.action === "deny");
}
// CONDITIONAL: ต้องมีการยืนยันจริงก่อนจึงลงมือได้ (flow เดิม) — ยืนยันแล้วผ่าน, ยังไม่ยืนยันหยุด
check(
  "ADMIN_CHAT CONDITIONAL finance.write — ยังไม่ยืนยัน = ไม่ปล่อยทำ",
  decideChatCapability({ capability: "finance.write", confirmed: false }).allowed === false &&
    decideChatCapability({ capability: "finance.write", confirmed: false }).requiresConfirmation === true,
);
check(
  "ADMIN_CHAT CONDITIONAL document.create — ยืนยันแล้ว = เดิน flow เดิมต่อได้",
  decideChatCapability({ capability: "document.create", confirmed: true }).allowed === true &&
    decideChatCapability({ capability: "document.create", confirmed: true }).requiresConfirmation === true,
);
check(
  "ADMIN_CHAT CONDITIONAL message.send — ยืนยันแล้ว = เดิน flow เดิมต่อได้",
  decideChatCapability({ capability: "message.send", confirmed: true }).allowed === true,
);
// DENY ของ capability ทั้ง 6 ชนะเสมอ แม้ขอยืนยัน
for (const cap of ["screen.navigate", "window.switch", "route.push", "browser.open", "desktop.control", "jarvis.screen_control"]) {
  const d = decideChatCapability({ capability: cap, confirmed: true });
  check(`ADMIN_CHAT DENY ${cap} (ชนะ allow/conditional เสมอ)`, d.allowed === false && d.action === "deny");
}
// DENY บังคับบน directive จริงของ pipeline — enforceChatDirectivePolicy
for (const [field, cap] of [
  ["navigate_url", "route.push"],
  ["back", "screen.navigate"],
  ["window_action", "window.switch"],
  ["external_url", "browser.open"],
  ["open_app", "desktop.control"],
  ["line_copilot", "jarvis.screen_control"],
] as const) {
  const out = enforceChatDirectivePolicy({ [field]: true, text: "เปิดให้แล้วครับ" });
  check(`ADMIN_CHAT enforce ตัด directive ${field} (${cap}) ออกก่อนตอบ`,
    out.response[field] === undefined && out.denied.includes(cap));
}
check(
  "ADMIN_CHAT enforce เปลี่ยนคำสั่ง DENY เป็นข้อความนโยบาย (ไม่รัน executor ฝั่ง client)",
  enforceChatDirectivePolicy({ navigate_url: "/admin/finance", text: "x" }).response.text !== "x",
);
check(
  "ADMIN_CHAT enforce คืน response เดิมเมื่อไม่มี directive ละเมิด",
  (() => {
    const r = { sender: "ai", type: "text", text: "ยอดหนี้วันนี้" };
    const out = enforceChatDirectivePolicy(r);
    return out.denied.length === 0 && out.response === r;
  })(),
);
// คำตอบซื้อของสาย (ALLOW/CONDITIONAL ไม่ถูกแตะ): result แบบ inline คงเดิม
check(
  "ADMIN_CHAT enforce ไม่แตะ result แบบinline ของคำตอบอ่านอย่างเดียว",
  (() => {
    const out = enforceChatDirectivePolicy({ sender: "ai", type: "text", text: "รายงานวันนี้", result: { type: "table" } });
    return out.denied.length === 0 && (out.response.result as { type: string }).type === "table";
  })(),
);
// app/api/chat = จุดบังคับจริงบน ADMIN_CHAT
const chatRoute = read("app/api/chat/route.ts");
check("app/api/chat เรียก enforceChatDirectivePolicy (จุดบังคับที่ตอบจริง)", chatRoute.includes("enforceChatDirectivePolicy"));
check("app/api/chat ยังผ่าน requireAuth(ADMIN_TIER) ก่อนทุกอย่าง", chatRoute.includes("requireAuth(ADMIN_TIER)"));

console.log(`\n=== surface-policy: PASS ${pass} · FAIL ${fail} ===`);
if (fail > 0) process.exit(1);



