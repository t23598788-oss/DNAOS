/**
 * auth-access-test.ts — login/permission/redirect integrity (2026-09-24).
 * Runtime assertions on the REAL guard functions (not just source greps) +
 * source checks for wiring. No mocks, no network, no fabricated sessions.
 * PASS/FAIL per check; exit 1 on any FAIL.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isSafeInternalPath, resolveDestination } from "../core/auth/resolveDestination";
import permissions from "../registry/permissions.json";
import { TOOL_BINDINGS } from "../app/workspace/_lib/toolBindings";

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
check("landing: staff (super/admin/employee) → /admin/relationships",
  ["super_admin", "admin", "employee"].every((r) => landing[r] === "/admin/relationships"));
check("landing: partner → /partner · customer → /user",
  landing.partner === "/partner" && landing.customer === "/user");
check("resolveDestination(role, null) follows registry",
  resolveDestination("employee", null) === "/admin/relationships" &&
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

check("login = email OTP only; existing identity mapping and safe destination retained",
  login.includes("signInWithOtp") && login.includes('type: "email"') &&
    login.includes("verifyOtp") && !login.includes("signInWithOAuth") &&
    !login.includes("signInWithPassword") &&
    login.includes("resolveIdentityContext") && login.includes("isSafeInternalPath(nextPath)") &&
    login.includes('"/workspace"') &&
    !login.includes("/api/auth/auto-login"));
check("legacy email-link callback retains its /app role-bounce default",
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

console.log(`\nauth-access: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);
