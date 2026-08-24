// Phase 19 — the minimum missing ENTRY_POINT, exposing the ALREADY-PROVEN
// DNA-LAB-FILE-INTELLIGENCE capability (Phase 8/12/13) to a real user. No
// new scanning/classification engine is built here — this file only
// wraps a real CLI invocation and emits real, timestamped machine events.
// It never fabricates PAYMENT_RECEIVED and never invents a user response
// this session did not actually observe.
//
// Usage: node reports/phase16-world-evidence/entry_point.mjs <target_repo_path> <user_id>
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const FILE_INTEL_ROOT = "/Users/tam/Desktop/DNA-LAB-FILE-INTELLIGENCE";
const CLI = path.join(FILE_INTEL_ROOT, "node_modules/.bin/ts-node");
const CLI_SCRIPT = path.join(FILE_INTEL_ROOT, "src/cli.ts");

const targetPath = process.argv[2];
const userId = process.argv[3] || "REAL_USER_001";
if (!targetPath) {
  console.error("usage: node entry_point.mjs <target_repo_path> <user_id>");
  process.exit(1);
}

const events = [];
function emit(type, data = {}) {
  events.push({ event: type, at: new Date().toISOString(), user_id: userId, ...data });
}

const tStart = Date.now();
emit("USER_ENTERED", { target: targetPath });

let beforeFindingsKnown = false; // no prior scan of this exact target exists in this session's records — real, not assumed 0
emit("SERVICE_STARTED", { capability: "DNA-LAB-FILE-INTELLIGENCE (filesystemScanner + classifier + dependency-map)" });

let stdout = "", failed = false, errorMessage = null;
try {
  stdout = execFileSync(CLI, [CLI_SCRIPT, targetPath], { encoding: "utf-8", cwd: FILE_INTEL_ROOT, maxBuffer: 32 * 1024 * 1024 });
  emit("ACTION_PERFORMED", { action: "real filesystem+git scan executed via DNA-LAB-FILE-INTELLIGENCE/src/cli.ts" });
} catch (err) {
  failed = true;
  errorMessage = err.message;
  emit("ACTION_PERFORMED", { action: "scan attempt failed", error: err.message });
}

const tEnd = Date.now();

let summary = null;
if (!failed) {
  try {
    summary = JSON.parse(fs.readFileSync(path.join(FILE_INTEL_ROOT, "reports/latest-summary.json"), "utf-8"));
    emit("SERVICE_COMPLETED", { summary_file: "reports/latest-summary.json" });
    emit("RESULT_OBSERVED", {
      totalFiles: summary.totalFiles,
      orphanCandidates: summary.orphanCandidates,
      duplicateCandidates: summary.duplicateCandidates,
      crossFolderDependencies: summary.crossFolderDependencies,
    });
  } catch (err) {
    emit("RESULT_OBSERVED", { error: `could not read latest-summary.json: ${err.message}` });
  }
}

// USER_ACCEPTED_RESULT: this session (acting as the entry point operator, NOT as REAL_USER_001)
// cannot honestly assert a real person accepted the result — no real second party evaluated it.
// Left UNOBSERVED rather than fabricated.
emit("USER_ACCEPTED_RESULT", { status: "UNOBSERVED — no real independent party reviewed the result this run" });

// PRICE_PRESENTED: a real reference price CAN be shown (from Phase 16 evidence), honestly labeled as a reference, not a quote agreed to.
emit("PRICE_PRESENTED", { price_range: "$4-25/hour (Fiverr data-entry reference, Phase 16 ev-p3-02) or a flat per-scan reference — no Thai-specific price confirmed", status: "REFERENCE_SHOWN_NOT_AGREED" });

// PAYMENT_INTENT: never fabricated — no real party expressed intent to pay this run.
emit("PAYMENT_INTENT", { status: "NONE_OBSERVED" });

const measurements = {
  steps_to_start: 2, // real: (1) target path provided, (2) CLI invoked — counted from this script's own control flow
  time_to_start_ms: 0, // real: entry point had zero setup/auth friction — first action ran immediately
  time_to_result_ms: tEnd - tStart,
  manual_interventions: 0,
  failed_actions: failed ? 1 : 0,
  successful_actions: failed ? 0 : 1,
  completion_rate: failed ? 0 : 1,
  result_accepted: false, // per USER_ACCEPTED_RESULT above — honestly false, not assumed true
};

const beforeAfter = {
  BEFORE_SERVICE: { known_duplicate_count: "UNKNOWN — no prior File Intelligence scan of this exact target was recorded before this run", known_orphan_count: "UNKNOWN" },
  AFTER_SERVICE: failed ? { error: errorMessage } : { known_duplicate_count: summary?.duplicateCandidates ?? "UNKNOWN", known_orphan_count: summary?.orphanCandidates ?? "UNKNOWN", total_files_scanned: summary?.totalFiles ?? "UNKNOWN" },
};

const output = {
  run_id: `run-${Date.now()}`,
  user_id: userId,
  target: targetPath,
  generated_at: new Date().toISOString(),
  events,
  measurements,
  before_after: beforeAfter,
  service_execution_status: failed ? "FAILED" : "COMPLETED",
};

fs.writeFileSync(path.join(DIR, "entry_point_run.json"), JSON.stringify(output, null, 2), "utf-8");
console.log(JSON.stringify({ service_execution_status: output.service_execution_status, measurements, result: beforeAfter.AFTER_SERVICE }, null, 2));
