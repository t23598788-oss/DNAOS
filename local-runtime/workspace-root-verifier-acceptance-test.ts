// Proves the workspace-root verifier rejects a stale worker path and accepts
// the real DNA OS source only when it matches the declared source of truth.
import "@/engines";
import { executeCommand } from "@/core/runtime/engine";
import { verifyWorkspaceRoot } from "@/engines/workspace/workspaceRootVerifier";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const SOURCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const missing = verifyWorkspaceRoot({ workspacePath: "/tmp/dna-os-missing-worker-path" });
  if (missing.verified || !missing.checks.some((check) => check.name === "path_exists" && !check.passed)) {
    throw new Error("FAIL: stale worker path must be rejected with path evidence");
  }

  const verified = await executeCommand({
    version: 1,
    command: "workspace.verify_root",
    args: { workspacePath: SOURCE_ROOT, expectedRepositoryRoot: SOURCE_ROOT },
  });
  if (!verified.success || !(verified.data as { verified?: boolean }).verified) {
    throw new Error(`FAIL: real source must verify through Runtime: ${verified.error ?? JSON.stringify(verified.data)}`);
  }

  const mismatch = verifyWorkspaceRoot({ workspacePath: SOURCE_ROOT, expectedRepositoryRoot: "/tmp/not-dna-os" });
  if (mismatch.verified || !mismatch.checks.some((check) => check.name === "declared_source_matches" && !check.passed)) {
    throw new Error("FAIL: a declared-source mismatch must be rejected");
  }

  console.log("ALL WORKSPACE ROOT VERIFIER ACCEPTANCE TESTS PASSED");
}

main().catch((error) => { console.error(error); process.exit(1); });
