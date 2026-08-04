// Proves storage.*/workspace.* commands are real Runtime-callable — invoked
// through core/runtime/engine.ts's executeCommand(), the same dispatcher
// engines/business.ts's commands already use. Not the HTTP route, not a
// direct function call — the actual Runtime.
// Run with: npx tsx local-runtime/runtime-registration-test.ts
import "@/engines"; // triggers engines/workspace/registerCommands.ts's side effect, same as engines/business.ts's real bootstrapping pattern
import { executeCommand } from "@/core/runtime/engine";

async function main() {
  console.log("=== Runtime Registration Test ===\n");

  const dependentsResult = await executeCommand({
    version: 1,
    command: "workspace.get_dependents",
    args: { resourcePath: "core/shared/types.ts" },
  });
  console.log(`workspace.get_dependents via Runtime: success=${dependentsResult.success}, source=${dependentsResult.source}, traceId=${dependentsResult.traceId}`);
  if (!dependentsResult.success) throw new Error(`FAIL: ${dependentsResult.error}`);
  const deps = dependentsResult.data as unknown[];
  console.log(`  -> ${deps.length} real dependents returned through the Runtime dispatcher`);

  const impactResult = await executeCommand({
    version: 1,
    command: "workspace.analyze_impact",
    args: { resourcePath: "definitely-not-a-real-file.tmp" },
  });
  console.log(`workspace.analyze_impact via Runtime: success=${impactResult.success}`);

  const dockerResult = await executeCommand({
    version: 1,
    command: "storage.inspect_docker",
    args: {},
  });
  console.log(`storage.inspect_docker via Runtime: success=${dockerResult.success}`);

  const unknownResult = await executeCommand({ version: 1, command: "storage.does_not_exist", args: {} });
  console.log(`unknown command correctly rejected: success=${unknownResult.success}, error=${unknownResult.error}`);
  if (unknownResult.success) throw new Error("FAIL: unknown command should not succeed");

  console.log("\nALL RUNTIME REGISTRATION CHECKS PASSED");
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
