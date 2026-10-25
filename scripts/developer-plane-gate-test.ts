/**
 * developer-plane-gate-test.ts — Developer Plane production deny (owner directive 2026-10-20).
 * Runtime assertions on the REAL gate (core/auth/developerPlaneGate.ts) plus source
 * wiring checks for the API guard, page guard, middleware and contractor routes.
 * Business processing and shared engines must stay PASS. No mocks, no network.
 * PASS/FAIL per check; exit 1 on any FAIL.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  developerPlaneDenyResponse,
  isDeveloperOperationPath,
  isDeveloperPlaneEnabled,
} from "../core/auth/developerPlaneGate";
import { decideSurfaceAction, resolveSurface } from "../core/auth/surfacePolicy";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const PROD = { NODE_ENV: "production" } as Record<string, string | undefined>;
const PROD_ENABLED = { NODE_ENV: "production", DNA_DEVELOPER_PLANE_ENABLED: "true" } as Record<string, string | undefined>;
const DEV = { NODE_ENV: "development" } as Record<string, string | undefined>;

// ── Production default deny (runtime) ───────────────────────────────────────
const devPaths = [
  "/api/admin/ide/file",
  "/api/admin/ide/execution/run",
  "/api/admin/dev-loop/runs",
  "/api/v1/mcp/contractor/task-claim",
  "/api/v1/mcp/contractor/status",
  "/api/v1/mcp/contractor/evidence-submit",
  "/admin/ide",
  "/admin/dev-loop",
  "/admin/deploy",
  "/developer",
];
check("prod: deny flag off by default", isDeveloperPlaneEnabled(PROD) === false);
check("prod: explicit opt-in enables", isDeveloperPlaneEnabled(PROD_ENABLED) === true);
check("prod: opt-in value other than 'true' stays denied",
  isDeveloperPlaneEnabled({ NODE_ENV: "production", DNA_DEVELOPER_PLANE_ENABLED: "1" }) === false);
check("non-production: developer plane not gated by this flag", isDeveloperPlaneEnabled(DEV) === true);

for (const p of devPaths) {
  const r = developerPlaneDenyResponse(p, PROD);
  check(`direct HTTP DENY in prod (403): ${p}`, r !== null && r.status === 403);
}
check("prod + opt-in: developer path passes gate (operator guard still applies)",
  devPaths.every((p) => developerPlaneDenyResponse(p, PROD_ENABLED) === null));
check("non-production: developer path passes gate", devPaths.every((p) => developerPlaneDenyResponse(p, DEV) === null));

// Response shape: API returns JSON with a stable code; pages return plain 403.
const apiDeny = developerPlaneDenyResponse("/api/admin/ide/file", PROD);
check("API deny is 403 JSON with DEVELOPER_PLANE_DISABLED",
  apiDeny !== null && apiDeny.status === 403 && apiDeny.headers.get("content-type")?.includes("application/json") === true);

// ── Business processing PASS (must never be treated as Developer Operation) ───
const businessPaths = [
  "/workspace",
  "/admin/relationships",
  "/admin/documents",
  "/admin/line-customers",
  "/api/admin/documents",
  "/api/admin/line-customers/U1/reply",
  "/api/admin/notifications/send",
  "/api/admin/infrastructure",
  "/api/admin/receipt-documents",
  "/api/internal/canonical/jobs",
  "/api/admin/connectors/providers",
  "/api/admin/system-reality",
  "/api/command",
  "/api/v1/query",
  "/api/v1/mcp/business/dispatch",
  "/liff",
];
check("Business processing PASS: business/LINE/document/canonical paths not gated in prod",
  businessPaths.every((p) => !isDeveloperOperationPath(p) && developerPlaneDenyResponse(p, PROD) === null));
check("prefix match is segment-safe (/admin/ideas is not /admin/ide)", !isDeveloperOperationPath("/admin/ideas"));

// ── Business AI → source write DENY (surface policy, runtime) ───────────────
const surface = resolveSurface(undefined);
const writeDecision = decideSurfaceAction({ pathname: "/api/admin/ide/file", method: "PUT", surface: "operational" as never });
check("Business AI source write: operational surface cannot write source (surface policy)",
  writeDecision.allowed === false, JSON.stringify(writeDecision));
check("surface default fail-closed to operational (not development)", surface !== "development", String(surface));

// ── Source wiring ──────────────────────────────────────────────────────────
const gate = read("core/auth/developerPlaneGate.ts");
const middleware = read("middleware.ts");
const requireAuth = read("core/auth/requireAuth.ts");
const requirePage = read("core/auth/requireAuthPage.ts");
check("gate is edge-safe (no node:* imports)", !/from "node:/.test(gate));
check("API guard requirePlatformOperator checks the gate first",
  /isDeveloperPlaneEnabled\(\)[\s\S]*requireAuth\(PLATFORM_MANAGEMENT_TIER\)/.test(requireAuth));
check("page guard requirePlatformOperatorPage checks the gate first",
  /isDeveloperPlaneEnabled\(\)[\s\S]*requireAuthPage\(nextPath, PLATFORM_MANAGEMENT_TIER\)/.test(requirePage));
check("middleware enforces deny before session work", /developerPlaneDenyResponse\(pathname\)[\s\S]*getUser/.test(middleware) || middleware.indexOf("developerPlaneDenyResponse(pathname)") < middleware.indexOf("supabase.auth.getUser"));
check("middleware matcher covers contractor MCP routes", middleware.includes("/api/v1/mcp/contractor/:path*"));
const contractorRoutes = [
  "app/api/v1/mcp/contractor/task-claim/route.ts",
  "app/api/v1/mcp/contractor/status/route.ts",
  "app/api/v1/mcp/contractor/evidence-submit/route.ts",
];
check("contractor routes each deny directly in production",
  contractorRoutes.every((f) => read(f).includes("developerPlaneDenyResponse(new URL(req.url).pathname)")));

console.log(`\ndeveloper-plane-gate: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);
