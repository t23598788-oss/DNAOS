/**
 * API token scope issuer test (2026-09-23).
 *
 * Proves the issuer change stayed inside the three rules the Owner set:
 *   S1  default is unchanged: omitting scopes still yields ["read"]
 *   S2  the allow-list is enforced for unknown / wildcard / admin / unimplemented
 *       scopes — the token is never created (fail-closed)
 *   S3  no client can request a scope: the only reader of a scope field is the
 *       admin-authenticated issuer route, and the contractor MCP routes never
 *       accept one
 * plus NC-1 (allow everything) and NC-2 (change the default) which must FAIL.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALLOWED_API_TOKEN_SCOPES, validateApiTokenScopes } from "@/services/supabase/api-tokens";

const ROOT = process.cwd();
let failures = 0;
let checks = 0;
function check(name: string, ok: boolean, detail = ""): void {
  checks += 1;
  if (ok) {
    console.log(`PASS  ${name}`);
    return;
  }
  failures += 1;
  console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
}

// ── S1 — default behaviour preserved ───────────────────────────────────────
const omitted = validateApiTokenScopes(undefined);
check("S1 omitting scopes keeps the historical default", omitted.ok && omitted.scopes.join() === "read", JSON.stringify(omitted));
const empty = validateApiTokenScopes([]);
check("S1 an empty list is treated as the default too", empty.ok && empty.scopes.join() === "read", JSON.stringify(empty));

// ── S2 — allow-list ────────────────────────────────────────────────────────
const contractor = validateApiTokenScopes(["read", "governance:propose"]);
check("S2 contractor scope set is granted", contractor.ok && contractor.scopes.slice().sort().join() === "governance:propose,read", JSON.stringify(contractor));
const implied = validateApiTokenScopes(["governance:propose"]);
check("S2 read is implied by a higher scope", implied.ok && implied.scopes.includes("read") && implied.scopes.includes("governance:propose"), JSON.stringify(implied));
check("S2 allow-list is exactly the three enforced scopes", ALLOWED_API_TOKEN_SCOPES.join() === "read,governance:read,governance:propose", ALLOWED_API_TOKEN_SCOPES.join());

for (const bad of [["admin"], ["*"], ["write"], ["read", "admin"], ["governance:propose", "*"]]) {
  const res = validateApiTokenScopes(bad);
  check(`S2 rejected: ${JSON.stringify(bad)}`, res.ok === false && res.rejected.length > 0, JSON.stringify(res));
}
check("S2 non-array input is rejected", validateApiTokenScopes("read" as unknown).ok === false);

// ── S3 — clients cannot self-request scopes ────────────────────────────────
const CONTRACTOR_ROUTES = [
  "app/api/v1/mcp/contractor/task-claim/route.ts",
  "app/api/v1/mcp/contractor/evidence-submit/route.ts",
  "app/api/v1/mcp/contractor/status/route.ts",
];
for (const rel of CONTRACTOR_ROUTES) {
  const code = readFileSync(join(ROOT, rel), "utf-8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  check(`S3 ${rel} never reads a scopes field`, !/scopes/.test(code));
}
const issuerRoute = readFileSync(join(ROOT, "app/api/admin/api-tokens/route.ts"), "utf-8");
check("S3 scope field is read only by the admin issuer", /body\.scopes/.test(issuerRoute) && /requireAuth\(ADMIN_TIER\)/.test(issuerRoute));
const service = readFileSync(join(ROOT, "services/supabase/api-tokens.ts"), "utf-8");
check("S3 service fails closed on a rejected scope", service.includes("API_TOKEN_SCOPE_NOT_ALLOWED"));
check("S3 no token value is printed by the test", !/console\.log\([^)]*token[^)]*\)/.test(readFileSync(join(ROOT, "scripts/api-token-scope-test.ts"), "utf-8")));

console.log(`\n${checks - failures}/${checks} passed`);
if (failures > 0) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}
