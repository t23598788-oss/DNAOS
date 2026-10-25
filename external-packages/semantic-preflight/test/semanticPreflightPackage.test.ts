import { prepareSemanticPreflight, SemanticPreflightPackageError } from "../src/index.js";
import type { SemanticPreflight, SemanticPreflightHostAdapter } from "../src/index.js";

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (error) { results.push({ name, pass: false, detail: error instanceof Error ? error.message : String(error) }); }
}
function assert(condition: boolean, message: string): asserts condition { if (!condition) throw new Error(message); }

const unknownPreflight: SemanticPreflight = {
  status: "UNKNOWN",
  capabilityAuthority: { registry: "registry/capability-registry.json", frozen: true, capabilities: [{ capabilityId: "business.auto-create.tryAutoCreateJob", ownerModule: "engines/jobs/auto-create.ts", exportName: "tryAutoCreateJob", mutability: "mutating", status: "active", authority: "FROZEN_CAPABILITY_REGISTRY" }] },
  dependencies: [{ ownerModule: "engines/jobs/auto-create.ts", dependent: "app/api/example.ts", target: "engines/jobs/auto-create.ts", kind: "typescript_import", source: "auto-dependency-graph" }],
  runtimeEvidence: [{ classification: "UNKNOWN", relationship: "UNKNOWN -> UNKNOWN", evidence: "No sufficient evidence." }],
  authorityBoundaries: ["Host dependency registry remains authoritative.", "Connector execution remains host-gated."],
  constraints: ["No persistence or connector invocation."],
  unknowns: ["UNKNOWN: no runtime edge is attributable."],
  sourceFingerprint: "fixture-fingerprint",
};

async function main() {
  await test("delegates once to the host Context Planner and preserves the exact host preflight rather than constructing a second authority", async () => {
    let calls = 0;
    const adapter: SemanticPreflightHostAdapter = { prepareContextPlan: (request) => { calls += 1; assert(request.changedFiles?.join(",") === "src/a.ts", "expected requested scope to be forwarded unchanged"); return { semanticPreflight: unknownPreflight }; } };
    const result = await prepareSemanticPreflight(adapter, { workspaceSessionId: "ws-1", ownerId: "owner-1", actor: "developer@example.test", changedFiles: ["src/a.ts"] });
    assert(calls === 1, "expected exactly one host Context Planner delegation");
    assert(result.semanticPreflight === unknownPreflight, "expected exact host object, never a reconstructed preflight");
    assert(result.authority === "HOST_CONTEXT_PLANNER", "expected host authority to remain explicit");
  });

  await test("preserves explicit UNKNOWN evidence and never promotes it to a guessed runtime relationship", async () => {
    const result = await prepareSemanticPreflight({ prepareContextPlan: () => ({ semanticPreflight: unknownPreflight }) }, { workspaceSessionId: "ws-2", ownerId: "owner-2", actor: "developer@example.test" });
    assert(result.semanticPreflight.status === "UNKNOWN", "expected UNKNOWN status to remain UNKNOWN");
    assert(result.semanticPreflight.runtimeEvidence[0]?.classification === "UNKNOWN", "expected UNKNOWN runtime evidence to remain unchanged");
    assert(result.semanticPreflight.unknowns[0]?.startsWith("UNKNOWN:"), "expected an explicit unknown reason");
  });

  await test("fails closed when a host result omits an explicit UNKNOWN reason", async () => {
    const invalid = { ...unknownPreflight, unknowns: [] };
    let thrown: unknown;
    try { await prepareSemanticPreflight({ prepareContextPlan: () => ({ semanticPreflight: invalid }) }, { workspaceSessionId: "ws-3", ownerId: "owner-3", actor: "developer@example.test" }); } catch (error) { thrown = error; }
    assert(thrown instanceof SemanticPreflightPackageError && thrown.code === "INVALID_HOST_RESULT", "expected malformed UNKNOWN host output to be rejected");
  });

  await test("does not accept unsupported runtime classification vocabulary", async () => {
    const invalid = { ...unknownPreflight, runtimeEvidence: [{ ...unknownPreflight.runtimeEvidence[0], classification: "INFERRED" }] } as unknown as SemanticPreflight;
    let thrown: unknown;
    try { await prepareSemanticPreflight({ prepareContextPlan: () => ({ semanticPreflight: invalid }) }, { workspaceSessionId: "ws-4", ownerId: "owner-4", actor: "developer@example.test" }); } catch (error) { thrown = error; }
    assert(thrown instanceof SemanticPreflightPackageError && thrown.code === "INVALID_HOST_RESULT", "expected unsupported evidence vocabulary to be rejected");
  });

  await test("does not mint identity or accept incomplete caller authority", async () => {
    let thrown: unknown;
    try { await prepareSemanticPreflight({ prepareContextPlan: () => ({ semanticPreflight: unknownPreflight }) }, { workspaceSessionId: "", ownerId: "owner-5", actor: "developer@example.test" }); } catch (error) { thrown = error; }
    assert(thrown instanceof SemanticPreflightPackageError && thrown.code === "INVALID_REQUEST", "expected missing workspace identity to be rejected");
  });

  console.log("\n=== Semantic Preflight Package Regression Suite ===");
  for (const result of results) console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.name}${result.pass ? "" : ` — ${result.detail}`}`);
  const failures = results.filter((result) => !result.pass);
  console.log(`\n${results.length - failures.length}/${results.length} passed`);
  if (failures.length) process.exit(1);
}

main().catch((error) => { console.error("SUITE CRASHED:", error); process.exit(1); });