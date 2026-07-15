#!/usr/bin/env npx tsx
/**
 * Deploy Gate (MISSION, registry/CHANGELOG.json DNA-000053, Rule 106 step 5).
 *
 * "Deployment ไม่มีสิทธิ์ PASS จนกว่า Runtime จะยืนยันว่า PASS — หาก FAIL ต้อง
 * อธิบายเป็นภาษาคน" — a bare exit code is not an explanation. This reuses the
 * real, already-built infrastructure rather than creating anything new:
 *   - scripts/governance.sh (already computes real PASS/FAIL per check + writes
 *     DNA_OS_HEALTH.json) — this script RUNS it, does not reimplement it.
 *   - registry/VALIDATION_RESULTS.json (DNA-000050/051) — already carries real
 *     root_cause/evidence/suggested_fix per FAIL when the caller supplied them;
 *     this script reads the LATEST matching entry per failing check to render
 *     the human-readable block, not fabricate one.
 *   - registry/existence.json known_mistakes — cross-referenced the same way
 *     record-validation.ts already does, so a FAIL that matches a known mistake
 *     surfaces its lesson too.
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

const ROOT = join(__dirname, "..");
function readJSON<T>(relPath: string): T {
  return JSON.parse(readFileSync(join(ROOT, relPath), "utf-8"));
}

// Keys here are DNA_OS_HEALTH.json's real "checks" object keys (governance.sh's
// heredoc field names), NOT governance.sh's internal score-tracking keys
// (pre_commit/dead_code/duplicates/etc — a different, shorter set used only
// inside set_score/get_score). Confirmed by reading DNA_OS_HEALTH.json directly
// after a live run — first version of this file used the wrong key set and
// silently rendered only 1 of 4 real failing checks; found by testing against
// real output before shipping, same discipline as every guard built this session.
const CHECK_KEY_TO_VALIDATOR: Record<string, { validator: string; module: string }> = {
  type_check: { validator: "Type Check (tsc)", module: "governance" },
  pre_commit_guards: { validator: "Pre-commit Guards", module: "governance" },
  dead_code_policy: { validator: "Dead Code Policy (knip)", module: "governance" },
  duplicate_detector: { validator: "Duplicate Detector (jscpd)", module: "governance" },
  shadow_system: { validator: "Module Registry (No Shadow)", module: "governance" },
  command_registry: { validator: "Command Registry", module: "governance" },
  dependency_graph: { validator: "Dependency Graph", module: "governance" },
  architecture_drift: { validator: "Architecture Drift", module: "governance" },
};

function latestMatchingResult(validator: string): any | null {
  const ledger = existsSync(join(ROOT, "registry/VALIDATION_RESULTS.json"))
    ? readJSON<any[]>("registry/VALIDATION_RESULTS.json")
    : [];
  const matches = ledger.filter((r) => r.validator === validator && r.result === "FAIL");
  return matches.length > 0 ? matches[matches.length - 1] : null;
}

function findKnowledgeLesson(rootCause: string | null): string | null {
  if (!rootCause) return null;
  const existence = readJSON<any>("registry/existence.json");
  const q = rootCause.toLowerCase();
  const match = (existence.known_mistakes?.entries ?? []).find((km: any) =>
    JSON.stringify(km).toLowerCase().includes(q.slice(0, 40))
  );
  return match ? `[${match.id}] ${match.lesson}` : null;
}

function main() {
  console.log("=== DNA OS Deploy Gate ===\n");
  console.log("Running real governance checks (scripts/governance.sh) — not simulated.\n");

  let governanceFailed = false;
  try {
    execSync("bash scripts/governance.sh", { cwd: ROOT, stdio: "inherit" });
  } catch {
    governanceFailed = true;
  }

  const health = readJSON<any>("DNA_OS_HEALTH.json");
  const failedKeys = Object.entries(health.checks).filter(([, v]) => v === 0).map(([k]) => k);

  console.log("\n" + "=".repeat(60));

  if (failedKeys.length === 0) {
    console.log("Deploy Gate: PASS");
    console.log("Status\n  READY");
    process.exit(0);
  }

  console.log(`Deploy Blocked\n`);
  failedKeys.forEach((key) => {
    const info = CHECK_KEY_TO_VALIDATOR[key];
    if (!info) return;
    const result = latestMatchingResult(info.validator);
    const rootCause = result?.root_cause
      ?? (result?.evidence ? `ยังไม่มีการวินิจฉัย root cause อย่างเป็นทางการ — แต่มี evidence จริงที่ capture ไว้: ${result.evidence.slice(0, 300)}` : "ยังไม่มีการวินิจฉัย root cause จริงสำหรับความล้มเหลวนี้ — รัน scripts/record-validation.ts พร้อม --root-cause จริงก่อน");
    const suggestedFix = result?.suggested_fix ?? "ยังไม่มี suggested_fix ที่บันทึกไว้ — ต้องวิเคราะห์ก่อนดำเนินการแก้ไข";
    const lesson = findKnowledgeLesson(result?.root_cause ?? null);

    console.log(`Reason`);
    console.log(`  ${info.validator} failed`);
    console.log(`\nLocation`);
    console.log(`  ${info.module} (${result?.command ?? "command not captured"})`);
    console.log(`\nRoot Cause`);
    console.log(`  ${rootCause}`);
    console.log(`\nRequired Action`);
    console.log(`  - ${suggestedFix}`);
    console.log(`  - Revalidate (npm run deploy-gate)`);
    if (lesson) console.log(`\nKnown from Runtime Memory\n  ${lesson}`);
    console.log(`\nStatus\n  NOT READY\n`);
    console.log("-".repeat(60));
  });

  process.exit(1);
}

main();
