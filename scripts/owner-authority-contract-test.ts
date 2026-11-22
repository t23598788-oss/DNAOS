/**
 * CORE.OWNER_AUTHORIZATION — authority contract test (owner directive
 * 2026-09-22: Owner Verification is the canonical authority for privileged
 * mutation; super_admin must never stand in for it).
 *
 * Proves on the real files only:
 *   1. the client is a bridge — no crypto, no biometrics, no session store
 *   2. both privileged entrypoints use that ONE client (no second mechanism)
 *   3. privileged mutation requires an artifact; missing/failed = fail-closed
 *   4. the authority chain order holds and super_admin is permission only
 *
 * Run: npm run owner-authority:test
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

async function main() {
  const client = source("core/owner-verification-client.ts");
  const decide = source("app/api/gateway/proposals/[id]/decide/route.ts");
  const mcpAuth = source("app/api/v1/mcp/governance/_lib/auth.ts");
  const devLoopApprove = source("app/api/admin/dev-loop/approve/route.ts");
  const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  await test("the bridge adds no auth of its own (no crypto, no biometrics, no store)", () => {
    const code = stripComments(client).toLowerCase();
    for (const forbidden of ["createhmac", "createverify", "timingsafeequal", "localauthentication", "touchid", "biometric", "createclient("]) {
      assert(!code.includes(forbidden), `bridge code contains '${forbidden}' — it must only carry the artifact`);
    }
  });

  await test("the bridge targets the infrastructure transport's own route and secret", () => {
    assert(client.includes('"/owner/session/from-verification-artifact"'), "infrastructure transport path missing");
    assert(client.includes("OWNER_COMMAND_HTTP_SHARED_SECRET"), "infrastructure secret env name missing");
    assert(client.includes("INFRA_OWNER_VERIFICATION_URL"), "infrastructure origin override env missing");
  });

  await test("every failure path is fail-closed and typed", () => {
    for (const code of ["OWNER_VERIFICATION_NOT_CONFIGURED", "OWNER_VERIFICATION_UNREACHABLE", "OWNER_VERIFICATION_BAD_RESPONSE"]) {
      assert(client.includes(code), `missing fail-closed code ${code}`);
    }
    assert(client.includes("ok: false"), "no failure verdict shape");
  });

  await test("every privileged entrypoint uses the SAME client (one authority contract)", () => {
    for (const [label, text] of [["gateway decide", decide], ["mcp governance auth", mcpAuth], ["dev-loop approve", devLoopApprove]] as const) {
      assert(text.includes('from "@/core/owner-verification-client"'), `${label} does not use the shared owner-verification client`);
      assert(text.includes("verifyOwnerArtifact(artifact)"), `${label} does not verify the owner artifact`);
    }
  });

  await test("privileged mutation without an artifact is refused before any write", () => {
    assert(decide.includes("OWNER_VERIFICATION_REQUIRED"), "decide route does not refuse a missing artifact");
    assert(mcpAuth.includes("OWNER_VERIFICATION_REQUIRED"), "mcp auth does not refuse a missing artifact");
    assert(devLoopApprove.includes("OWNER_VERIFICATION_REQUIRED"), "dev-loop approve does not refuse a missing artifact");
    assert(decide.indexOf("verifyOwnerArtifact(artifact)") < decide.indexOf('decideProposal(db, id, "approved"'), "verification must precede any approval write");
    assert(devLoopApprove.indexOf("verifyOwnerArtifact(artifact)") < devLoopApprove.indexOf('.from("dev_loop_registry_proposals")'), "verification must precede the approval write");
    assert(mcpAuth.indexOf("await verifyOwnerArtifact(") < mcpAuth.lastIndexOf("serviceClient()"), "verification must precede the privileged service client");
  });

  await test("authority chain order: token identity -> permission -> owner verification", () => {
    const tokenAt = mcpAuth.indexOf("await validateApiToken(");
    const scopeAt = mcpAuth.indexOf("token.scopes.includes");
    const ownerAt = mcpAuth.indexOf("await verifyOwnerArtifact(");
    assert(tokenAt > -1 && scopeAt > -1 && ownerAt > -1, "authority steps missing");
    assert(tokenAt < scopeAt && scopeAt < ownerAt, "owner verification does not run after token + permission");
  });

  await test("read scope is unchanged — reading grants no authority", () => {
    assert(/requiredScope !== "governance:propose"/.test(mcpAuth), "read scope no longer short-circuits owner verification");
  });

  await test("super_admin is permission only, never owner proof", () => {
    for (const [label, text] of [["gateway decide", decide], ["mcp governance auth", mcpAuth], ["dev-loop approve", devLoopApprove]] as const) {
      const usedAsAuthority =
        /===\s*["']super_admin["']|includes\(\s*["']super_admin["']|ADMIN_TIER\s*&&.{0,40}super_admin/.test(text);
      assert(!usedAsAuthority, `${label} uses super_admin as an authority check`);
    }
    assert(!mcpAuth.includes("platform-wide owner") && !mcpAuth.includes("platform super-admin"), "the contract must not expose a global-owner bypass");
  });

  await test("operator-facing env contract is documented", () => {
    const env = source(".env.local.example");
    assert(env.includes("OWNER_COMMAND_HTTP_SHARED_SECRET") && env.includes("INFRA_OWNER_VERIFICATION_URL"), "env contract not documented");
  });

  console.log("\n=== OWNER_AUTHORIZATION authority contract ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  if (passed !== results.length) { console.error(`\n${results.length - passed} test(s) failed.`); process.exit(1); }
}

main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
