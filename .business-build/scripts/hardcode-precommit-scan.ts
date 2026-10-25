#!/usr/bin/env npx tsx
/**
 * Guard 14 helper (HCG-P2, registry/hardcode-governance/enforcement-config.json).
 * Dry-run only — always exits 0. Scans staged files under the critical-path
 * allowlist and prints findings so the owner can review real false-positive
 * rate before this guard is flipped to BLOCK_CRITICAL (a separate, explicit
 * confirmation, not automatic).
 *
 * Input: staged file paths, one per line, via STAGED_FILES_LIST env var
 * (same convention scripts/pre-commit-check.sh's Guard 13 already uses).
 */
import { existsSync } from "fs";
import { join } from "path";
import { scanFile } from "@/engines/governance/hardcode-decision-engine";
import enforcementConfig from "@/registry/hardcode-governance/enforcement-config.json";

const ROOT = join(__dirname, "..");
const staged = (process.env.STAGED_FILES_LIST || "").split("\n").filter(Boolean);
const criticalPrefixes: string[] = enforcementConfig.critical_path_allowlist;

const targets = staged.filter(
  (f) => (f.endsWith(".ts") || f.endsWith(".tsx")) && criticalPrefixes.some((p) => f.startsWith(p))
);

if (targets.length === 0) {
  console.log("Guard 14 (hardcode-governance, dry-run): no staged files under the critical-path allowlist.");
  process.exit(0);
}

let flagged = 0;
for (const rel of targets) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) continue; // deleted files
  const results = scanFile(abs).filter((c) => c.verdict === "SECURITY_VIOLATION" || c.verdict === "ARCHITECTURE_VIOLATION");
  for (const r of results) {
    flagged++;
    console.log(`  [dry-run] ${r.file}:${r.line} — "${r.value}" -> ${r.category}/${r.verdict} (${r.rationale})`);
  }
}

if (flagged > 0) {
  console.log(`Guard 14 (hardcode-governance, dry-run): ${flagged} BLOCK_CRITICAL-level finding(s) in ${targets.length} staged critical-path file(s). NOT blocking commit yet — REPORT_ONLY per registry/hardcode-governance/enforcement-config.json.`);
} else {
  console.log(`Guard 14 (hardcode-governance, dry-run): 0 findings across ${targets.length} staged critical-path file(s).`);
}
process.exit(0);
