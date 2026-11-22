/**
 * CORE.PERMISSION_POLICY — permission layer contract test (owner directive
 * 2026-09-22, core chain step IDENTITY -> PERMISSION).
 *
 * Proves, against the real files only (no mocks):
 *   1. registry/permissions.json is the single source of role -> access
 *   2. core/auth/* actually reads it (no route hardcodes its own role list)
 *   3. the tier constants the API routes import really come from there
 *   4. no platform-wide administrator role or tier is declared
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

  await test("platform-wide administrator roles and tiers are absent", () => {
    assert(!permissions.roles.some((r) => r.id === "super_admin"), "super_admin role remains declared");
    assert(Array.isArray(permissions.role_tiers.admin_tier) && permissions.role_tiers.admin_tier.length === 0, "global admin tier must be empty");
    assert(Array.isArray(permissions.role_tiers.disabled_role_tier) && permissions.role_tiers.disabled_role_tier.length === 0, "disabled tier must deny all roles");
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

  console.log("\n=== CORE.PERMISSION_POLICY contract ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  if (passed !== results.length) { console.error(`\n${results.length - passed} test(s) failed.`); process.exit(1); }
}

main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
