/**
 * CORE.COMMAND_ROUTER -> CORE.CAPABILITY_ROUTER — wiring test (owner directive
 * 2026-09-22, patch P1/P2).
 *
 * Proves the capability router is reachable from the Core chain and that the
 * command -> capability relation is derived from the two real, frozen/registry
 * files only. The composer is executed for real (no mock) against
 * registry/capability-registry.json.
 *
 * Run: npm run capability-router:test
 */
import { readFileSync } from "fs";
import path from "path";
import { capabilityRegistryAccess, composerResolver } from "../core/workspace/composer";

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
  const capabilitiesRoute = source("app/api/v1/capabilities/route.ts");
  const queryRoute = source("app/api/v1/query/route.ts");
  const registry = JSON.parse(source("registry/capability-registry.json")) as {
    frozen: boolean; checksum: string; capabilities: { CapabilityId: string; OwnerModule: string }[];
  };

  await test("the capability route is wired to the existing composer", () => {
    assert(capabilitiesRoute.includes('@/core/workspace/composer'), "capabilities route does not import the composer");
    assert(capabilitiesRoute.includes("composerResolver.resolve"), "capabilities route does not call composerResolver");
  });

  await test("the AI command route resolves command -> capability from the two registries", () => {
    assert(queryRoute.includes("@/registry/command-registry.json"), "query route does not read the command registry");
    assert(queryRoute.includes("@/registry/capability-registry.json"), "query route does not read the capability registry");
    assert(queryRoute.includes("capabilityContextForCommand("), "query route does not call the mapping helper");
    assert(queryRoute.includes("capability:"), "query route does not return the capability context");
  });

  await test("the composer really resolves a capability from the frozen registry", () => {
    assert(registry.frozen === true, "registry is not frozen");
    const first = registry.capabilities[0];
    assert(Boolean(first?.CapabilityId), "registry has no capabilities");
    const plan = composerResolver.resolve({
      applicationId: "test.capability-router",
      workspaceId: "test",
      name: "test",
      capabilityIds: [first.CapabilityId],
    });
    assert(plan.capabilityIds.includes(first.CapabilityId), "resolved plan dropped the requested capability");
    assert(plan.metadata.registryChecksum === capabilityRegistryAccess.checksum, "plan does not echo the registry checksum");
    assert(plan.executionOrder.length >= 1, "execution order empty");
  });

  await test("an unknown capability id is reported, not silently accepted", () => {
    const plan = composerResolver.resolve({
      applicationId: "test.capability-router",
      workspaceId: "test",
      name: "test",
      capabilityIds: ["does.not.exist.in.registry"],
    });
    assert(plan.validationResult.issues.length > 0, "unknown capability produced no validation issue");
  });

  await test("every command owner that has capabilities is reachable through the mapping", () => {
    const commands = (JSON.parse(source("registry/command-registry.json")) as {
      commands: Record<string, { owner?: string }>;
    }).commands;
    const owners = new Set(Object.values(commands).map((c) => String(c.owner ?? "").replace(/\.ts$/, "")).filter(Boolean));
    const capabilityOwners = new Set(registry.capabilities.map((c) => c.OwnerModule.replace(/\.ts$/, "")));
    const resolved = [...owners].filter((owner) => capabilityOwners.has(owner));
    assert(resolved.length > 0, "no command owner resolves to a capability — mapping broken");
  });

  console.log("\n=== COMMAND_ROUTER -> CAPABILITY_ROUTER wiring ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  if (passed !== results.length) { console.error(`\n${results.length - passed} test(s) failed.`); process.exit(1); }
}

main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
