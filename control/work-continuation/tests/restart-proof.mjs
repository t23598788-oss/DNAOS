// หน้าที่: CASE H — the proof that cannot be honestly made inside one process.
// PHASE 1 records a waiting row and EXITS. PHASE 2 is a SEPARATE node process,
// launched after the first is gone, that reloads from disk and resumes the SAME
// work_id from a real dependency event.
//
// No shared memory, no shared module state, no agent memory: phase 2 knows only
// what is on disk. Run: node control/work-continuation/tests/restart-proof.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const phase = process.argv[2];
const store = process.argv[3];

if (phase === "record") {
  const wc = await import("../contract.ts");
  wc.appendWaiting({
    work_id: "work-RESTART", current_phase: "BUILD", status: "WAITING",
    blocked_on: [wc.dependencyKey("verification", "/control/demo/")],   // near-miss spelling on purpose
    required_evidence: [wc.dependencyKey("verification", "control/demo")],
    required_resources: [], required_capabilities: [], required_runtime_state: [], required_external_state: [],
    resume_condition: "ALL_AVAILABLE", exact_state: null,
    next_action: "finish step 3: publish the verified artifact",
    resolved_work_context_ref: "resolution-restart", last_verified_revision: null, evidence_refs: [],
    resume_attempt_count: 0, last_resume_reason: null, last_input_digest: null, last_result_digest: null,
    required_worker_class: "DETERMINISTIC_TEST", recorded_at: new Date().toISOString(),
  }, store);
  console.log(`  [pid ${process.pid}] recorded WAITING work-RESTART, exiting now`);
  process.exit(0);
}

if (phase === "resume") {
  const wc = await import("../contract.ts");
  const rows = wc.currentWaiting(store);                    // ← only source of knowledge
  const event = {
    key: wc.dependencyKey("verification", "control/demo"),  // canonical form from the producer side
    value: "VERIFIED", source: "verification",
    evidence_ref: "tests/demo.test.ts=9/0", occurred_at: new Date().toISOString(),
  };
  const decisions = wc.decideResumes(rows, [event], () => null, () => null, new Date().toISOString());
  const d = decisions[0];
  console.log(`  [pid ${process.pid}] reloaded ${rows.length} row(s) from disk`);
  console.log(`  [pid ${process.pid}] verdict=${d?.evaluation.verdict} work_id=${d?.work_id}`);
  console.log(`  [pid ${process.pid}] next_action carried forward: "${d?.next_action}"`);
  console.log(`  [pid ${process.pid}] resolved_work_context_ref: ${d?.resolved_work_context_ref}`);
  process.exit(d?.evaluation.verdict === "RESUME_ELIGIBLE" && d.work_id === "work-RESTART" ? 0 : 1);
}

// ---- driver ----
const dir = mkdtempSync(join(tmpdir(), "wc-restart-"));
const storePath = join(dir, "waiting.jsonl");
const tsx = join(process.cwd(), "node_modules/tsx/dist/cli.mjs");
const self = new URL(import.meta.url).pathname;

console.log("PHASE 1 — record WAITING, then the process exits");
const p1 = spawnSync(process.execPath, [tsx, self, "record", storePath], { encoding: "utf8" });
process.stdout.write(p1.stdout);
console.log(`  phase-1 process exited with code ${p1.status} — it is gone`);
console.log(`  waiting row on disk: ${existsSync(storePath) ? "YES" : "NO"}`);

console.log("\nPHASE 2 — a SEPARATE process, event arrives, work must resume");
const p2 = spawnSync(process.execPath, [tsx, self, "resume", storePath], { encoding: "utf8" });
process.stdout.write(p2.stdout);
if (p2.stderr) process.stderr.write(p2.stderr);

const ok = p1.status === 0 && p2.status === 0 && p1.pid !== p2.pid;
console.log(`\nphase-1 pid=${p1.pid}  phase-2 pid=${p2.pid}  (different processes: ${p1.pid !== p2.pid})`);
console.log(ok ? "PASS  CASE H: state survived process replacement, SAME work_id resumed"
               : "FAIL  CASE H");
rmSync(dir, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
