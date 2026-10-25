/**
 * auth-access-test.ts — login/permission/redirect integrity (2026-09-24).
 * Runtime assertions on the REAL guard functions (not just source greps) +
 * source checks for wiring. No mocks, no network, no fabricated sessions.
 * PASS/FAIL per check; exit 1 on any FAIL.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isSafeInternalPath, resolveDestination } from "../core/auth/resolveDestination";
import permissions from "../registry/permissions.json";
import { TOOL_BINDINGS } from "../app/workspace/_lib/toolBindings";
import { isPlatformOperator, PLATFORM_MANAGEMENT_TIER } from "../core/auth/platformOperator";
import { readdirSync, statSync } from "node:fs";

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

// ── next-guard (runtime, the real function) ─────────────────────────────────
check("guard: /admin/relationships allowed", isSafeInternalPath("/admin/relationships") === true);
check("guard: relative-path //evil.com blocked", isSafeInternalPath("//evil.com") === false);
check("guard: backslash /\\evil.com blocked", isSafeInternalPath("/\\evil.com") === false);
check("guard: absolute https://evil.com blocked", isSafeInternalPath("https://evil.com") === false);
check("guard: /app allowed", isSafeInternalPath("/app") === true);

// ── landing authority (runtime, registry-driven) ────────────────────────────
const landing = permissions.workspace_landing as Record<string, string>;
check("landing: staff (super/admin/employee) → /workspace (owner decision 2026-10-17)",
  ["super_admin", "admin", "employee"].every((r) => landing[r] === "/workspace"));
check("landing: partner → /partner · customer → /user",
  landing.partner === "/partner" && landing.customer === "/user");
check("resolveDestination(role, null) follows registry",
  resolveDestination("employee", null) === "/workspace" &&
  resolveDestination("partner", null) === "/partner" &&
  resolveDestination("customer", null) === "/user");
check("resolveDestination: safe next wins (documented precedence)",
  resolveDestination("customer", "/user/orders") === "/user/orders");

// ── tier/registry consistency (no ADMIN_TIER widening possible) ─────────────
const adminTier = [...(permissions.role_tiers.admin_tier as string[])].sort();
const routeAdmin = [...((permissions.route_access.find((r) => r.prefix === "/admin") as { roles: string[] }).roles)].sort();
check("ADMIN_TIER == route_access /admin roles (registry self-consistent)",
  JSON.stringify(adminTier) === JSON.stringify(routeAdmin), JSON.stringify(adminTier));
check("capability chat roles == admin tier (workspace tool ↔ route)",
  JSON.stringify([...permissions.capability_access.chat].sort()) === JSON.stringify(adminTier));
check("TOOL_BINDINGS.chat routes to the same relationships screen",
  TOOL_BINDINGS.chat?.route === "/admin/relationships");

// ── wiring: every ?next= consumer uses the ONE guard ────────────────────────
const login = read("app/login/page.tsx");
const confirm = read("app/auth/confirm/route.ts");
const autoLogin = read("app/api/auth/auto-login/route.ts");
const middleware = read("middleware.ts");
const relRoot = read("app/admin/relationships/page.tsx");
const relDeep = read("app/admin/relationships/[relationshipId]/page.tsx");
const logoutRoute = read("app/api/auth/logout/route.ts");
const session = read("core/auth/session.ts");

check("login = one identity/many providers: OAuth(google/apple/microsoft)+otp primary, password only behind pwMaintenance, no auto-login",
  login.includes("signInWithOtp") && login.includes("signInWithOAuth") &&
    ["google", "apple", "azure"].every((p) => login.includes(`"${p}"`)) &&
    login.includes('"Microsoft"') &&
    login.includes("/auth/confirm") && login.includes("isSafeInternalPath(nextPath)") &&
    login.includes("signInWithPassword") && login.includes("pwMaintenance") &&
    !login.includes("/api/auth/auto-login"));
check("landing after emailed link: /auth/confirm safe-next → default /app role-bounce",
  confirm.includes('searchParams.get("next") ?? "/app"') &&
    confirm.includes('isSafeInternalPath(next) ? next : "/app"'));
check("/auth/confirm guards ?next= server-side", confirm.includes("isSafeInternalPath(next)") && confirm.includes("safeNext"));
check("auto-login RETIRED410 — no second auth path (no signInWithPassword left in it)",
  autoLogin.includes("AUTH_PATH_RETIRED") && autoLogin.includes("status: 410") &&
    !autoLogin.includes("signInWithPassword"));
check("middleware next = pathname only (never raw query)",
  middleware.includes('loginUrl.searchParams.set("next", pathname)'));
check("relationships root page: server-side ADMIN_TIER gate",
  relRoot.includes('requireAuthPage("/admin/relationships", ADMIN_TIER)'));
check("relationships deep page: server-side ADMIN_TIER gate",
  relDeep.includes("requireAuthPage(`/admin/relationships/${relationshipId}`, ADMIN_TIER)"));
check("logout = the one supabase signOut route", logoutRoute.includes("auth.signOut()"));
check("session read = single getAuthedUser path (getUser + profiles.role)",
  session.includes("supabase.auth.getUser()") && session.includes('from("profiles")'));
check("session expiry handling exists in middleware (refresh before bounce)",
  /refresh/i.test(middleware));
check("requireAuthPage uses the SAME getAuthedUser (no second auth)",
  read("core/auth/requireAuthPage.ts").includes("getAuthedUser"));

// ── Developer Plane (owner directive 2026-10-20): platform operators only ───
// Runtime decisions on the REAL isPlatformOperator (no mocks).
check("platform: employee DENIED", !isPlatformOperator({ role: "employee", email: "e@x.co" }));
check("platform: partner / customer / ai_service DENIED",
  !isPlatformOperator({ role: "partner", email: "p@x.co" }) &&
  !isPlatformOperator({ role: "customer", email: "c@x.co" }) &&
  !isPlatformOperator({ role: "ai_service", email: null }));
check("platform: business admin WITHOUT grant DENIED",
  !isPlatformOperator({ role: "admin", email: "biz-admin@x.co" }));
check("platform: admin with null/empty email DENIED",
  !isPlatformOperator({ role: "admin", email: null }) && !isPlatformOperator({ role: "admin", email: "" }));
check("platform: super_admin ALLOWED (platform-level by role)",
  isPlatformOperator({ role: "super_admin", email: "owner@x.co" }));
check("platform: management tier == super_admin + admin only",
  JSON.stringify([...PLATFORM_MANAGEMENT_TIER].sort()) === JSON.stringify(["admin", "super_admin"]),
  JSON.stringify(PLATFORM_MANAGEMENT_TIER));

// Single authority: registry grants are the only source (no second list in code).
const grants = (permissions.platform_operator_grants.admin_emails as string[]);
check("platform: admin grants live in registry (no hardcoded emails in code)",
  !read("core/auth/platformOperator.ts").match(/@[a-z0-9.-]+\.[a-z]{2,}/i) && Array.isArray(grants));

// Wiring: every Developer Plane route/page uses the platform guard, none uses ADMIN_TIER.
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}
// Retired from the Business build (owner 2026-10-20, dna-os-retire): the
// developer plane must be ABSENT, not merely guarded. Any route handler left
// under these trees, or any retired page, fails this check.
const retiredRouteDirs = ["app/api/admin/ide", "app/api/admin/dev-loop"];
const devRouteFiles = retiredRouteDirs
  .filter((d) => existsSync(join(ROOT, d)))
  .flatMap((d) => walk(d))
  .filter((f) => f.endsWith("/route.ts"));
check("no developer IDE / dev-loop route handlers remain in the Business build",
  devRouteFiles.length === 0, devRouteFiles.slice(0, 3).join(", "));
const retiredFiles = ["app/api/build/route.ts", "app/api/deploy/route.ts", "app/developer/page.tsx", "app/admin/ide/page.tsx", "app/admin/dev-loop/page.tsx"];
const stillPresent = retiredFiles.filter((p) => existsSync(join(ROOT, p)));
check("retired developer routes/pages are absent",
  stillPresent.length === 0, stillPresent.join(", "));

// Source-read routes (read repo files from process.cwd): platform operator only.
// Business admins/employees are in ADMIN_TIER, so these must not use it.
const sourceReadRoutes = [
  "app/api/reader/route.ts",
  "app/api/routes/route.ts",
  "app/api/admin/workspace/tree/route.ts",
  "app/api/admin/workspace/file/route.ts",
];
const sourceReadUnguarded = sourceReadRoutes.filter((f) => {
  const s = read(f);
  return !s.includes("requirePlatformOperator()") || /requireAuth\(ADMIN_TIER\)/.test(s);
});
check("source-read routes (reader/routes/workspace tree+file) are platform-operator only",
  sourceReadUnguarded.length === 0, sourceReadUnguarded.join(", "));

console.log(`\nauth-access: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);
