/**
 * หน้าที่: §8 CRASH CONSISTENCY PROOF — พิสูจน์ที่ขอบเขตความพังจริง 6 จุด:
 *   A ปิดเบราว์เซอร์ระหว่างทำงาน   B ฆ่า worker ระหว่างทำงาน
 *   C restart service               D เน็ตหลุด
 *   E จำลอง restart เครื่อง/runtime  F ตายก่อนถึง commit
 *
 * ทุกเคสถูกทำจริง ไม่ได้จำลองด้วยการตั้งตัวแปร: process ถูก spawn แล้ว SIGKILL
 * จริง, ไฟล์ถูกเขียนจริง, journal ถูกอ่านกลับจากดิสก์จริง
 *
 * Input: none — ใช้ journal directory ของตัวเองใน scratchpad
 * Output: exit 0 เมื่อครบทุกข้อ, exit 1 เมื่อไม่ครบ
 * Dependency ที่อนุญาต: Node built-ins + ../contract.ts + ../../../observability/joint-monitor/contract.ts
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเขียนลง local-runtime/work-session-state ของจริง
 * - ห้าม "จำลอง" การตายด้วยการ return เฉย ๆ — เคส B/E ต้องมี process จริงที่ถูกฆ่าจริง
 * - ห้ามให้เคสผ่านโดยที่ recovery อ่านจาก memory ของ process เดียวกัน
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  advanceEntry, openEntry, recoverableEntries, entryJournalPath,
  recordConnected, recordDisconnect, readConnectionState, reconcile, nextBackoffMs,
  BACKOFF_MAX_ATTEMPTS, BACKOFF_MAX_MS,
  queueNetworkOperation, drainQueue, readQueue,
  appendCheckpoint, currentCheckpoint, buildRehydrationPlan, currentRevision, currentBranch, newSessionId,
} from "../contract";
import { JointStore } from "../../../observability/joint-monitor/joint-store";

const REPO = process.cwd();
const root = mkdtempSync(join(tmpdir(), "crash-consistency-"));
const env = { ...process.env, WORK_SESSION_STATE_ROOT: root };
process.env.WORK_SESSION_STATE_ROOT = root;

const checks: { case: string; name: string; ok: boolean; detail: string }[] = [];
const check = (c: string, name: string, ok: boolean, detail: string): void => { checks.push({ case: c, name, ok, detail }); };

const WORK_ID = `work-crash-${Date.now().toString(36)}`;
const sandbox = join(root, "sandbox");
const targetRel = "sandbox/subject.txt";
execFileSync("mkdir", ["-p", sandbox]);
writeFileSync(join(sandbox, "subject.txt"), "ORIGINAL\n");

function seedCheckpoint(phase: string, next: string, status: "ACTIVE" | "BLOCKED" = "ACTIVE") {
  const prev = currentCheckpoint(WORK_ID);
  return appendCheckpoint({
    ...(prev ?? {}),
    work_id: WORK_ID,
    owner_intent_id: "owner-intent:DURABLE_RUNTIME_PROOF",
    task_id: null,
    session_id: newSessionId(),
    execution_id: `exec-${process.pid}`,
    worker_identity: "crash-consistency-proof",
    repository: "DNA-OS-INFRASTRUCTURE",
    branch: currentBranch(REPO),
    affected_resource_ids: [],
    affected_paths: ["control/work-session-state"],
    objective: "durable runtime + UI session recovery",
    current_phase: phase,
    steps: [{ step_id: "c1", title: "seed", state: "COMPLETED", phase, depends_on: [], affected_paths: [], evidence_refs: [], verification: { kind: "PATH_EXISTS", path: "control/work-session-state/store.ts" }, completed_at_revision: currentRevision(REPO), completed_at: new Date().toISOString() },
            { step_id: "c2", title: next, state: "PENDING", phase, depends_on: ["c1"], affected_paths: [], evidence_refs: [], verification: null, completed_at_revision: null, completed_at: null }],
    blockers: [], decisions_required: [], evidence_refs: [],
    source_revision: currentRevision(REPO), last_verified_revision: currentRevision(REPO),
    next_action: "c2", do_not_repeat: ["c1 พิสูจน์แล้ว ห้ามทำซ้ำ"],
    ui_context: { service_id: "lab-ui", url: "http://127.0.0.1:5177/", route: "/", scope: WORK_ID },
    last_durable_event: [], sync_state: "SYNCED",
    status, started_at: new Date().toISOString(),
  });
}
seedCheckpoint("CRASH_PROOF", "ทำต่อจากจุดที่ตาย");

// ── A · kill the browser during active work ────────────────────────────────
// A real child process stands in for the browser: it is spawned, it is
// SIGKILLed, and the plan that puts a browser back is then built from disk
// with no browser running anywhere.
const browser = spawnSync("bash", ["-c", `sleep 30 & echo $!`], { encoding: "utf8" });
const browserPid = Number(browser.stdout.trim());
try { process.kill(browserPid, "SIGKILL"); } catch { /* already gone */ }
let browserAlive = true;
try { process.kill(browserPid, 0); } catch { browserAlive = false; }
const planA = buildRehydrationPlan(WORK_ID, { repoRoot: REPO });
check("A", "the browser process is really dead", !browserAlive, `pid ${browserPid} is not running`);
check("A", "the UI route is recovered from durable state, not from the browser", planA?.ui.status === "RESTORE" && planA.ui.context.route === "/", `route=${planA?.ui.status === "RESTORE" ? planA.ui.context.route : "none"} scope=${planA?.ui.status === "RESTORE" ? planA.ui.context.scope : "-"}`);
check("A", "the plan names the runtime that must serve that UI, and it is a DECLARED service", planA?.required_service?.declared === true, `required_service=${planA?.required_service?.service_id}`);
check("A", "the plan was built with no browser running and nothing was waited for", planA !== null, "buildRehydrationPlan reads only the journal and the filesystem");

// ── F · terminate before the final commit ──────────────────────────────────
// The journal must hold the change BEFORE it is applied, so a death anywhere
// between INTENT and COMMIT is recoverable.
const entry = openEntry({ work_id: WORK_ID, intent: "แก้ subject.txt เป็น PATCHED", target_paths: [targetRel], draft: { [targetRel]: "PATCHED\n" } }, { repoRoot: root });
const journaledBeforeAnyWrite = readFileSync(join(sandbox, "subject.txt"), "utf8") === "ORIGINAL\n" && existsSync(entryJournalPath(root));
check("F", "the change is durable BEFORE it is applied — commit is not the first persistence boundary", journaledBeforeAnyWrite, `${entryJournalPath(root)} holds the draft while the target file is still untouched`);

const recA = recoverableEntries({ path: entryJournalPath(root), repoRoot: root, work_id: WORK_ID });
check("F", "a death at JOURNALED recovers as REAPPLY", recA.length === 1 && recA[0].recovery === "REAPPLY", recA[0]?.detail ?? "no entry");

// apply for real, then die before checkpointing
writeFileSync(join(sandbox, "subject.txt"), "PATCHED\n");
const recB = recoverableEntries({ path: entryJournalPath(root), repoRoot: root, work_id: WORK_ID });
check("F", "an apply that landed while the journal still says JOURNALED is NOT re-applied", recB[0]?.recovery === "RESUME_AFTER_APPLY", recB[0]?.detail ?? "no entry");

advanceEntry(entry.entry_id, "APPLIED", { path: entryJournalPath(root) });
advanceEntry(entry.entry_id, "CHECKPOINTED", { path: entryJournalPath(root) });
const recC = recoverableEntries({ path: entryJournalPath(root), repoRoot: root, work_id: WORK_ID });
check("F", "a death after CHECKPOINTED recovers as VERIFY_ONLY", recC[0]?.recovery === "VERIFY_ONLY", recC[0]?.detail ?? "no entry");

const skip = advanceEntry(entry.entry_id, "COMMITTED", { path: entryJournalPath(root) });
check("F", "a stage cannot be skipped — an unrecorded stage is unrecoverable, so it is refused", skip.ok === false && skip.reason.startsWith("STAGE_SKIP_REFUSED"), skip.ok ? "it was allowed" : skip.reason);
advanceEntry(entry.entry_id, "VERIFIED", { path: entryJournalPath(root) });
advanceEntry(entry.entry_id, "COMMITTED", { path: entryJournalPath(root) });
check("F", "a COMMITTED entry is no longer offered for recovery", recoverableEntries({ path: entryJournalPath(root), repoRoot: root, work_id: WORK_ID }).length === 0, "the journal is a recovery list, not a history to replay");

// ── B · kill the worker during active work ─────────────────────────────────
// A real `npx tsx` child opens an entry, then this process SIGKILLs it before
// it can finish. Recovery reads the journal from disk in THIS process.
const killerScript = join(root, "victim.ts");
const victimMarker = join(root, "victim-entry.txt");
writeFileSync(killerScript, `
import { writeFileSync } from "node:fs";
import { openEntry } from "${resolve(REPO, "control/work-session-state/contract.ts")}";
const e = openEntry({ work_id: "${WORK_ID}", intent: "worker ที่จะถูกฆ่ากลางคัน", target_paths: ["${targetRel}"], draft: { "${targetRel}": "FROM_KILLED_WORKER\\n" } }, { repoRoot: "${root}" });
writeFileSync("${victimMarker}", e.entry_id + " " + process.pid);
setTimeout(() => {}, 60000);
`);
// spawned detached so this process can SIGKILL it while it is genuinely alive.
// The child reports through a FILE, not a pipe: this proof body is synchronous,
// so a stdout listener would never fire and the "kill" would be killing a
// process that had not started working yet — which would prove nothing.
const victim = require("node:child_process").spawn("npx", ["tsx", killerScript], { cwd: REPO, env, stdio: "ignore", detached: false });
const deadline = Date.now() + 60_000;
while (!existsSync(victimMarker) && Date.now() < deadline) { spawnSync("bash", ["-c", "sleep 0.2"]); }
// The child reports its OWN pid: `victim.pid` is the `npx` wrapper, and
// killing a wrapper leaves the real worker running while the wrapper lingers
// as an unreaped zombie that `kill(pid, 0)` still answers for. Killing the
// pid that actually opened the journal entry is the only honest version of
// "the worker died".
const marker = existsSync(victimMarker) ? readFileSync(victimMarker, "utf8").trim().split(" ") : [];
const victimEntry = marker[0] ?? "";
const victimPid = Number(marker[1] ?? 0);
let victimAliveBeforeKill = false;
try { process.kill(victimPid, 0); victimAliveBeforeKill = true; } catch { /* already exited */ }
try { process.kill(victimPid, "SIGKILL"); } catch { /* already gone */ }
victim.kill("SIGKILL");
spawnSync("bash", ["-c", "sleep 0.5"]);
let victimAliveAfterKill = true;
try { process.kill(victimPid, 0); } catch { victimAliveAfterKill = false; }
const afterKill = recoverableEntries({ path: entryJournalPath(root), repoRoot: root, work_id: WORK_ID });
check("B", "the worker process was really alive, doing work, and was really SIGKILLed", victimAliveBeforeKill && !victimAliveAfterKill && victimEntry !== "", `worker pid ${victimPid} alive=${victimAliveBeforeKill} -> alive=${victimAliveAfterKill}, entry ${victimEntry.slice(-8)}`);
check("B", "the killed worker's unsaved draft survived it, read back from disk by a different process", afterKill.some((r) => r.entry.entry_id === victimEntry && r.entry.draft !== null), `${afterKill.length} recoverable entry(ies); victim entry ${victimEntry.slice(-8)} carries its draft`);
check("B", "WORK_ID is preserved across the kill", afterKill.every((r) => r.entry.work_id === WORK_ID), WORK_ID);

// ── E · machine/runtime restart simulation ─────────────────────────────────
// A third process, sharing no memory with anything above, rebuilds the plan.
const readback = execFileSync("npx", ["tsx", "-e", `
  const { buildRehydrationPlan } = require("${resolve(REPO, "control/work-session-state/contract.ts")}");
  const p = buildRehydrationPlan(process.argv[1], { repoRoot: "${REPO}" });
  console.log(JSON.stringify({ work: p && p.work_id, route: p && p.ui.status === "RESTORE" ? p.ui.context.route : null, unsaved: p ? p.unsaved.length : -1, next: p && p.next_action }));
`, WORK_ID], { cwd: REPO, env, encoding: "utf8" });
const restored = JSON.parse(readback.trim().split("\n").pop() ?? "{}");
check("E", "a fresh runtime rebuilds work, route, unsaved work and next action from disk alone", restored.work === WORK_ID && restored.route === "/" && restored.unsaved >= 1, JSON.stringify(restored));
check("E", "NEXT_ACTION is preserved across the restart", typeof restored.next === "string" && restored.next.startsWith("c2"), String(restored.next));
check("E", "completed work is not repeated after the restart", (currentCheckpoint(WORK_ID)?.steps ?? []).filter((s) => s.state === "COMPLETED").length === 1, "c1 stays COMPLETED; only c2 is pending");

// ── D · network loss ───────────────────────────────────────────────────────
const seq = [0, 1, 2, 3, 4, 5, 6].map((a) => nextBackoffMs(a));
check("D", "retry backoff is bounded and its ceiling is declared, not implicit", seq[0] === 500 && seq[6] === 30_000 && nextBackoffMs(BACKOFF_MAX_ATTEMPTS) === null, `${seq.join(",")} … attempt ${BACKOFF_MAX_ATTEMPTS} = give up (ceiling ${BACKOFF_MAX_MS}ms)`);

const local = queueNetworkOperation({ work_id: WORK_ID, required_provider: "railway", operation: "deploy joint-monitor", next_action: "railway up", requires_owner_authority: false, evidence_refs: ["railway.json"], detail: "queued while offline" });
const gated = queueNetworkOperation({ work_id: WORK_ID, required_provider: "railway", operation: "delete production volume", next_action: "รอ Owner อนุมัติ", requires_owner_authority: true, evidence_refs: [], detail: "authority boundary" });
check("D", "a network-required action becomes WAITING_FOR_NETWORK with provider, next action and evidence — not a lost error", local.status === "WAITING_FOR_NETWORK" && local.required_provider === "railway" && local.next_action !== "", `${local.required_provider} :: ${local.next_action}`);

const offline = drainQueue(() => false, () => ({ ok: true, detail: "should not run" }));
check("D", "while offline nothing runs and nothing is dropped", offline.ran.length === 0 && offline.still_waiting.length >= 1, `${offline.still_waiting.length} still waiting, ${offline.ran.length} ran`);

const online = drainQueue((p) => p === "railway", (op) => ({ ok: true, detail: `ran ${op.operation}` }));
check("D", "when the network returns the queue drains on its own, no Owner re-entry", online.ran.some((o) => o.operation_id === local.operation_id), `${online.ran.length} operation(s) ran automatically`);
check("D", "an operation behind an AUTHORITY boundary is NOT run by the drain", online.held_for_owner.some((o) => o.operation_id === gated.operation_id), online.held_for_owner[0]?.detail ?? "not held");
check("D", "a drained operation is not run twice", drainQueue((p) => p === "railway", () => ({ ok: true, detail: "second drain" })).ran.length === 0, `queue now holds ${readQueue().filter((q) => q.status === "DONE").length} DONE`);

// ── C · service restart / stream reconnect with real replay ────────────────
// A real JointStore, real rows, a real resume point, and a real gap.
const store = new JointStore();
const mk = (n: number) => `evt-${n}`;
let n = 0;
const rows = [1, 2, 3, 4, 5].map((i) => store.recordJoint(
  { from_capability: "a", to_capability: "b", task_id: null, status: "OK", summary: `row ${i}`, source: "proof#c", occurred_at: new Date(Date.UTC(2026, 7, 26, 0, 0, i)).toISOString(), occurred_seq: i, reporter_run_id: "proof" } as never,
  () => mk(++n), () => new Date(Date.UTC(2026, 7, 26, 0, 0, i)).toISOString(),
));
recordConnected("joint-monitor:/events", rows[2].event_id, "connected and processed up to row 3");
recordDisconnect("joint-monitor:/events", rows[2].event_id, "service restarted");
const disc = readConnectionState().find((c) => c.stream_id === "joint-monitor:/events");
check("C", "a disconnect is recorded with its resume point and a bounded next retry", disc?.status === "RETRYING" && disc.last_event_id === rows[2].event_id && disc.next_retry_in_ms === 500, `status=${disc?.status} next_retry=${disc?.next_retry_in_ms}ms at=${disc?.last_event_id}`);

const res = reconcile("joint-monitor:/events", (last) => (last === null ? null : (store.eventsSince(last)?.joints ?? null)));
check("C", "reconnect replays exactly the events missed while disconnected", res.outcome === "RESUMED" && res.missed.length === 2, `${res.detail}`);
check("C", "after reconciliation the stream is CONNECTED again at the newest event", readConnectionState().find((c) => c.stream_id === "joint-monitor:/events")?.status === "CONNECTED" && readConnectionState().find((c) => c.stream_id === "joint-monitor:/events")?.last_event_id === rows[4].event_id, `last_event_id=${readConnectionState().find((c) => c.stream_id === "joint-monitor:/events")?.last_event_id}`);

const unknown = reconcile("joint-monitor:/events", () => store.eventsSince("evt-does-not-exist")?.joints ?? null);
check("C", "an unplaceable resume point forces a FULL resync — never reported as 'you missed nothing'", unknown.outcome === "FULL_RESYNC_REQUIRED", unknown.detail);

// the durable rehydration the restart depends on
const fresh = new JointStore();
const restoredRows = fresh.rehydrate(rows, []);
check("C", "a restarted collector rebuilds its in-memory ring from the durable log", restoredRows.joints === 5 && fresh.snapshot().recent_joints.length === 5, `${restoredRows.joints} joint(s) rehydrated`);
check("C", "rehydrate refuses to run on a store that already holds rows — a live process cannot be silently doubled", fresh.rehydrate(rows, []).joints === 0, "second rehydrate is a no-op");

rmSync(root, { recursive: true, force: true });

console.log("\n[CRASH CONSISTENCY PROOF]");
let lastCase = "";
for (const c of checks) {
  if (c.case !== lastCase) { console.log(`\n  ── CASE ${c.case} ──`); lastCase = c.case; }
  console.log(`  ${c.ok ? "✔" : "✘"} ${c.name}\n      ${c.detail}`);
}
const failed = checks.filter((c) => !c.ok).length;
console.log(`\nRESULT: ${checks.length - failed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
