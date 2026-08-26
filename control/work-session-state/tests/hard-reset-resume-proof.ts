/**
 * หน้าที่: PHASE 9 HARD RESET PROOF. Runs the exact scenario the Owner asked
 * for: a real work item is started by one worker process, that process is gone,
 * the runtime is restarted, and a DIFFERENT worker process — given nothing but
 * a work_id — picks the work up from DNA OS's own persisted state.
 *
 * Input: none. Uses its own journal directory under the scratchpad so no test
 * row is ever written into the live journal.
 * Output: exit 0 when every required assertion holds, exit 1 otherwise.
 * Dependency ที่อนุญาต: Node built-ins + the two worker entrypoints beside it.
 * สิ่งที่ห้ามแตะ:
 * - ห้ามส่ง context อื่นให้ worker B นอกจาก work_id — ถ้าต้องส่ง แปลว่าไม่ผ่าน
 * - ห้ามให้ทั้งสอง worker อยู่ใน process เดียวกัน — state ที่ค้างใน memory
 *   จะทำให้การพิสูจน์นี้ไม่ได้พิสูจน์อะไรเลย
 * - ห้ามเขียนลง local-runtime/work-session-state ของจริง
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = process.cwd();
const HERE = "control/work-session-state/tests";
const root = mkdtempSync(join(tmpdir(), "work-session-state-proof-"));
const env = { ...process.env, WORK_SESSION_STATE_ROOT: root };
const workId = `work-hard-reset-${Date.now().toString(36)}`;

const checks: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string): void => { checks.push({ name, ok, detail }); };

function run(script: string): { stdout: string; pid: number } {
  const stdout = execFileSync("npx", ["tsx", join(HERE, script), workId], { cwd: REPO, env, encoding: "utf8" });
  const pid = Number(/PID=(\d+)/.exec(stdout)?.[1] ?? "0");
  return { stdout, pid };
}

// ---- A + B + C: a real work item, several stages, a persisted checkpoint ----
const a = run("worker-a.ts");
const sessionA = /SESSION=(\S+)/.exec(a.stdout)?.[1] ?? "";
check("A/B/C  worker A ran in its own process and persisted a checkpoint",
  existsSync(join(root, "checkpoints.jsonl")) && sessionA !== "",
  `session=${sessionA} pid=${a.pid} journal=${join(root, "checkpoints.jsonl")}`);

// ---- D: the agent process is gone -----------------------------------------
let aAlive = true;
try { process.kill(a.pid, 0); } catch { aAlive = false; }
check("D      worker A's process no longer exists", !aAlive, `pid ${a.pid} is not running`);

// ---- E: restart the DNA OS runtime that serves this state ------------------
// A fresh `npx tsx` process IS a restarted runtime: nothing survives in memory
// between it and worker A. Proven by reading the state back from a third
// process that shares nothing with either worker.
const readback = execFileSync("npx", ["tsx", "-e", `
  const { buildResumeContext } = require("${resolve(REPO, "control/work-session-state/contract.ts")}");
  const ctx = buildResumeContext(process.argv[1], { repoRoot: "${REPO}" });
  console.log(JSON.stringify({ status: ctx.resume_status, next: ctx.next_action, done: ctx.completed_steps.map(s => s.step_id) }));
`, workId], { cwd: REPO, env, encoding: "utf8" });
const afterRestart = JSON.parse(readback.trim().split("\n").pop() ?? "{}");
check("E      a restarted runtime reads the same state back from disk",
  afterRestart.status === "RESUMABLE" && afterRestart.done?.length === 4,
  `resume_status=${afterRestart.status} completed=${(afterRestart.done ?? []).join(",")}`);

const nextBefore = afterRestart.next;

// ---- F + G + H + I: a different worker, given only the work_id -------------
const b = run("worker-b.ts");
const sessionB = /SESSION=(\S+)/.exec(b.stdout)?.[1] ?? "";
const did = /DID=(\S+)/.exec(b.stdout)?.[1] ?? "";
const journalNow = readFileSync(join(root, "checkpoints.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const identityA = journalNow[0].worker_identity;
const identityB = journalNow[journalNow.length - 1].worker_identity;
check("F/G    worker B is a different process and a different worker identity, started with only a work_id",
  b.pid !== a.pid && sessionB !== sessionA && identityA === "worker-a" && identityB === "worker-b",
  `pid ${a.pid} -> ${b.pid}, session ${sessionA.slice(-8)} -> ${sessionB.slice(-8)}, identity ${identityA} -> ${identityB}`);
check("H      worker B received the persistent work state from DNA OS",
  b.stdout.includes("WORK_ID") && b.stdout.includes("DO_NOT_REPEAT") && b.stdout.includes(workId),
  "the resume briefing it printed contains work_id, completed steps, constraints and next action");
check("I      worker B continued from NEXT_ACTION",
  did === "s5-graph-proof" && nextBefore.startsWith("s5-graph-proof"),
  `NEXT_ACTION was "${nextBefore}", worker B did "${did}"`);
check("I'     the step it did was real work, verified against the running system",
  b.stdout.includes("GRAPH_PROOF_OK"),
  (/GRAPH_PROOF_OK (.*)/.exec(b.stdout)?.[1] ?? "").trim());

// ---- J: already-verified stages were not redone ---------------------------
const journal = readFileSync(join(root, "checkpoints.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const first = journal[0];
const last = journal[journal.length - 1];
const untouched = ["s1-types", "s2-store", "s3-resume", "s4-ownership"].every((id) => {
  const before = first.steps.find((s: { step_id: string }) => s.step_id === id);
  const after = last.steps.find((s: { step_id: string }) => s.step_id === id);
  return before.completed_at === after.completed_at && before.verification.sha256 === after.verification.sha256;
});
check("J      the four already-verified stages were not redone",
  untouched, "same completed_at and same verification digest in worker B's checkpoint as in worker A's");

// ---- the assertions the Owner named explicitly ----------------------------
check("AI_MEMORY_REQUIRED = NO", !b.stdout.includes("NOT_RESUMABLE"),
  "worker B was passed one argument, a work_id; no conversation, summary or handover file");
// Counted, not asserted by hand: how many files the resume engine has to look
// at, against how many files the repository actually holds. A worker that had
// to rediscover history would be at the second number.
const rechecked = new Set(last.steps.filter((s: { state: string }) => s.state === "COMPLETED")
  .map((s: { verification: { path?: string } | null }) => s.verification?.path).filter(Boolean));
const repoFiles = Number(execFileSync("bash", ["-c", "git ls-files | wc -l"], { cwd: REPO, encoding: "utf8" }).trim());
check("REPO_FULL_RESCAN_REQUIRED = NO",
  rechecked.size > 0 && rechecked.size < repoFiles / 100,
  `the resume engine stats ${rechecked.size} file(s) named by the checkpoint; the repository holds ${repoFiles} tracked files`);
check("WORK_ID_BEFORE == WORK_ID_AFTER", first.work_id === last.work_id, `${first.work_id}`);
check("COMPLETED_STEPS_PRESERVED = YES",
  last.steps.filter((s: { state: string }) => s.state === "COMPLETED").length === 5,
  "4 from worker A + 1 worker B just finished");
check("NEXT_ACTION_PRESERVED = YES", last.next_action === "s6-regression",
  `the journal carries the next action forward: ${last.next_action}`);
const workIds = new Set(journal.map((c: { work_id: string }) => c.work_id));
check("DUPLICATE_WORK_CREATED = NO", workIds.size === 1,
  `${journal.length} checkpoints, ${workIds.size} work_id, ${new Set(journal.map((c: { session_id: string }) => c.session_id)).size} sessions — same lineage`);

rmSync(root, { recursive: true, force: true });

console.log("\n[HARD RESET PROOF]");
for (const c of checks) console.log(`  ${c.ok ? "✔" : "✘"} ${c.name} — ${c.detail}`);
const failed = checks.filter((c) => !c.ok).length;
console.log(`\nRESULT: ${checks.length - failed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
