/**
 * CORE_CHAIN — execution-chain contract test (owner directive 2026-09-22).
 *
 * Walks the single Core chain step by step and asserts that every transition's
 * anchor exists in the real files: an existing edge, or the wiring patch that
 * closed the edge (P1/P2/P3/P6/P7 + T7). A step with no anchor FAILS this suite —
 * an edge is never declared without evidence.
 *
 * OWNER/AI COMMAND -> COMMAND -> CAPABILITY -> SOURCE -> INFO -> IDENTITY ->
 * PERMISSION -> OWNER VERIFICATION -> VERIFICATION -> APPROVAL -> VERSION ->
 * DEPLOYMENT GATE -> CONNECT BOUNDARY
 *
 * Run: npm run core-chain:test
 */
import { readFileSync } from "fs";
import path from "path";

const ROOT = path.join(__dirname, "..");
const source = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

interface Step { from: string; to: string; anchors: { file: string; contains: string }[] }
interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }

const CHAIN: Step[] = [
  { from: "OWNER/AI COMMAND", to: "COMMAND_ROUTER", anchors: [
    { file: "app/api/v1/query/route.ts", contains: "X-DNA-Token" },
    { file: "app/api/v1/query/route.ts", contains: 'from "@/engines/validation/dispatcher"' },
  ] },
  { from: "COMMAND_ROUTER", to: "CAPABILITY_ROUTER", anchors: [
    { file: "app/api/v1/query/route.ts", contains: "capabilityContextForCommand(" },
    { file: "app/api/v1/capabilities/route.ts", contains: "composerResolver.resolve" },
  ] },
  { from: "CAPABILITY_ROUTER", to: "SOURCE_CONTROL", anchors: [
    { file: "engines/workspace/registerCommands.ts", contains: 'registerCommand("registry.write"' },
    { file: "engines/workspace/registerCommands.ts", contains: "withRegistryLock" },
    { file: "engines/workspace/registryWriter.ts", contains: "withRegistryLock" },
  ] },
  { from: "SOURCE_CONTROL", to: "SYSTEM_INFO_REGISTRY", anchors: [
    { file: "scripts/pre-commit-check.sh", contains: "scripts/sync-registry.ts" },
    { file: "scripts/pre-commit-check.sh", contains: "scripts/registry-integrity-gate.ts" },
  ] },
  { from: "SYSTEM_INFO_REGISTRY", to: "IDENTITY", anchors: [
    { file: "core/auth/session.ts", contains: '@/registry/permissions.json' },
    { file: "registry/index.ts", contains: "export" },
  ] },
  { from: "IDENTITY", to: "PERMISSION", anchors: [
    { file: "core/auth/session.ts", contains: "permissions.role_tiers" },
    { file: "core/auth/requireAuth.ts", contains: "allowedRoles.includes" },
    { file: "registry/permissions.json", contains: "route_access" },
  ] },
  { from: "PERMISSION", to: "OWNER_VERIFICATION", anchors: [
    { file: "app/api/v1/mcp/governance/_lib/auth.ts", contains: "verifyOwnerArtifact" },
    { file: "app/api/gateway/proposals/[id]/decide/route.ts", contains: "verifyOwnerArtifact" },
  ] },
  { from: "OWNER_VERIFICATION", to: "VERIFICATION", anchors: [
    { file: "core/owner-verification-client.ts", contains: "OWNER_VERIFICATION_PATH" },
    { file: "scripts/owner-verification-decide-test.ts", contains: "verifyOwnerArtifact" },
  ] },
  { from: "VERIFICATION", to: "APPROVAL", anchors: [
    { file: "scripts/deploy-gate.ts", contains: "dev_loop_check_results" },
    { file: "scripts/deploy-gate.ts", contains: 'eq("status", "pending")' },
  ] },
  { from: "APPROVAL", to: "VERSION_RELEASE", anchors: [
    { file: "app/api/gateway/proposals/[id]/decide/route.ts", contains: "recordApprovedProposal" },
    { file: "engines/workspace/devLoopSession.ts", contains: "registry/CHANGELOG.json" },
  ] },
  { from: "VERSION_RELEASE", to: "DEPLOYMENT_GATE", anchors: [
    { file: "scripts/deploy-gate.ts", contains: "checkReleaseBaseline" },
    { file: "scripts/deploy-gate.ts", contains: "CURRENT_STATE.json" },
  ] },
  { from: "DEPLOYMENT_GATE", to: "CONNECT_BOUNDARY", anchors: [
    { file: "scripts/deploy-gate.ts", contains: "governance.sh" },
    { file: "scripts/pre-commit-check.sh", contains: "check-connector-lifecycle" },
    { file: "registry/connector-lifecycle.json", contains: "stages" },
  ] },
];

async function main() {
  for (const step of CHAIN) {
    await test(`${step.from} -> ${step.to}`, () => {
      for (const anchor of step.anchors) {
        assert(source(anchor.file).includes(anchor.contains), `${anchor.file} is missing "${anchor.contains}"`);
      }
    });
  }

  await test("the chain has no step without an anchor", () => {
    assert(CHAIN.every((s) => s.anchors.length > 0), "a chain step declares no evidence anchor");
    assert(CHAIN.length === 12, `expected 12 transitions, found ${CHAIN.length}`);
  });

  console.log("\n=== CORE EXECUTION CHAIN ===");
  CHAIN.forEach((s, i) => console.log(`  ${String(i + 1).padStart(2, "0")}. ${s.from} -> ${s.to}`));
  console.log("");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  if (passed !== results.length) { console.error(`\n${results.length - passed} test(s) failed.`); process.exit(1); }
}

main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
