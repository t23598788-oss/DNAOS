/**
 * CORE.VERIFICATION_TEST -> CORE.APPROVAL / CORE.DEPLOYMENT_GATE —
 * impact-verdict contract test (owner directive 2026-09-22).
 *
 * The chain relies on ONE verdict vocabulary written by the watcher/impact
 * analyzer and read by the deploy gate. This proves the contract on the real
 * files instead of assuming it: same literals, same tables, same blocking rule.
 *
 * Run: npm run impact-verdict:test
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
  const deployGate = source("scripts/deploy-gate.ts");
  const watcher = source("scripts/watch-registry.ts");
  const analyzer = source("scripts/impact-analyzer.ts");

  await test("deploy gate reads the real dev-loop evidence/proposal tables", () => {
    assert(deployGate.includes("dev_loop_check_results"), "deploy-gate does not read dev_loop_check_results");
    assert(deployGate.includes("dev_loop_registry_proposals"), "deploy-gate does not read dev_loop_registry_proposals");
  });

  await test("deploy gate blocks on a failing verdict and on a pending proposal", () => {
    assert(/===\s*"fail"/.test(deployGate), "no 'fail' verdict block");
    assert(/eq\("status",\s*"pending"\)/.test(deployGate), "no pending-proposal block");
  });

  await test("the watcher emits evidence through the existing store/session modules", () => {
    assert(watcher.includes("evidenceStore"), "watch-registry does not use evidenceStore");
    assert(watcher.includes("devLoopSession"), "watch-registry does not use devLoopSession");
  });

  await test("the analyzer owns the verdict vocabulary (pass/warning/fail)", () => {
    for (const verdict of ["pass", "warning", "fail"]) {
      assert(analyzer.includes(`"${verdict}"`) || analyzer.includes(`'${verdict}'`), `verdict '${verdict}' missing from impact-analyzer`);
    }
  });

  await test("approval state lives in the same proposal row the gate blocks on", () => {
    const mcpProposal = source("app/api/v1/mcp/governance/registry-proposals/route.ts");
    assert(mcpProposal.includes("dev_loop_registry_proposals"), "mcp route does not write dev-loop proposals");
    assert(mcpProposal.includes('status: "pending"'), "mcp proposal route does not create a pending row");
    const approveRoute = source("app/api/admin/dev-loop/approve/route.ts");
    assert(approveRoute.includes("dev_loop_registry_proposals"), "dashboard approval route writes a different table");
    assert(approveRoute.includes('eq("status", "pending")'), "approval route does not require a pending row");
  });

  await test("every dev-loop approval path is owner-verified (owner directive 2026-09-22)", () => {
    const helper = source("app/api/v1/mcp/governance/_lib/auth.ts");
    assert(helper.includes("@/core/owner-verification-client"), "the mcp governance auth helper does not use the shared owner-verification authority");
    assert(/requiredScope !== "governance:propose"/.test(helper), "the helper does not treat governance:propose as a privileged mutation");

    const approveRoute = source("app/api/admin/dev-loop/approve/route.ts");
    assert(approveRoute.includes("@/core/owner-verification-client"), "dashboard approval route mutates approval state without owner verification");

    const mcpProposal = source("app/api/v1/mcp/governance/registry-proposals/route.ts");
    assert(
      mcpProposal.includes('authenticate(req, "governance:propose"'),
      "mcp proposal route does not go through the owner-verified governance auth helper"
    );
  });

  console.log("\n=== VERIFICATION -> APPROVAL / DEPLOYMENT_GATE verdict contract ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  if (passed !== results.length) { console.error(`\n${results.length - passed} test(s) failed.`); process.exit(1); }
}

main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
