// Real acceptance test for the Development Machine Policy drift detector
// (Constitution Rule 117). Proves both directions: clean machine reports
// clean, and a real violation (a temp script with a live localhost:11434
// fetch call) is actually caught. Run with:
// npx tsx local-runtime/architecture-drift-acceptance-test.ts
import { writeFileSync, unlinkSync, mkdtempSync, rmSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { detectArchitectureDrift } from "@/engines/workspace/architectureDriftDetector";

const LOCAL_RUNTIME_DIR = dirname(fileURLToPath(import.meta.url));

function test1_currentMachineIsClean() {
  const report = detectArchitectureDrift({ localRuntimeDir: LOCAL_RUNTIME_DIR });
  console.log(`[test 1] real machine state: clean=${report.clean} findings=${report.findings.length}`);
  if (!report.clean) throw new Error(`FAIL: expected clean after Migration Completion, found: ${JSON.stringify(report.findings)}`);
  console.log("  PASS — zero local AI runtime/model/script references found, matching the real migration done earlier");
}

function test2_detectsRealViolation() {
  const tmpDir = mkdtempSync(join(tmpdir(), "drift-test-"));
  const violatingScript = join(tmpDir, "fake-legacy-script.mjs");
  writeFileSync(violatingScript, `const res = await fetch("http://localhost:11434/api/generate", { method: "POST" });\n`);
  try {
    const report = detectArchitectureDrift({ localRuntimeDir: tmpDir });
    console.log(`[test 2] synthetic violation: clean=${report.clean} findings=${report.findings.length}`);
    if (report.clean) throw new Error("FAIL: detector did not catch a real, live localhost:11434 fetch() call");
    const found = report.findings.find((f) => f.kind === "script_references_local_runtime");
    if (!found) throw new Error("FAIL: violation found but not classified as script_references_local_runtime");
    console.log(`  PASS — real violation caught: ${found.detail}`);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  test1_currentMachineIsClean();
  test2_detectsRealViolation();
  console.log("\nALL ARCHITECTURE DRIFT ACCEPTANCE TESTS PASSED");
}

main().catch((e) => { console.error("ACCEPTANCE TEST FAILED:", e); process.exit(1); });
