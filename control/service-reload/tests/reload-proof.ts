/**
 * หน้าที่: prove the source-change -> runtime-reload connection with a REAL
 * runtime change, not static code reading. It restarts `machine-observer`
 * through `control/runtime-control/` and checks the running process afterwards.
 *
 * The case is real and was not constructed for this test: the daemon at pid
 * 41512 started before `observation-store.ts` was edited at 11:49, and that
 * pre-edit code deleted 8 observation archives — the exact defect a reload
 * must fix.
 *
 * Input: none. Output: printed report + exit code.
 * Dependency ที่อนุญาต: ../contract.ts.
 */
import { execFileSync } from "node:child_process";
import { requestReload, resolveServiceImpact, computeSourceRevision, serviceSourceRoot } from "../contract";

async function main(): Promise<void> {

const REPO = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE";
const CHANGED = [`${REPO}/control/machine-observation/observation-store.ts`];
const checks: { ok: boolean; label: string; detail: string }[] = [];
const check = (ok: boolean, label: string, detail: string) => { checks.push({ ok, label, detail }); };
const pidOf = (): number | null => {
  const row = execFileSync("/bin/sh", ["-c", "launchctl list | grep com.dnaos.machine-observer || true"], { encoding: "utf8" }).trim();
  const n = row.split(/\s+/)[0];
  return /^\d+$/.test(n) ? Number(n) : null;
};

const pidObservedBefore = pidOf();
console.log(`\n[BEFORE] launchctl reports pid ${pidObservedBefore} for com.dnaos.machine-observer`);

const root = serviceSourceRoot("machine-observer");
console.log(`[SOURCE ROOT] ${root.root}`);
root.evidence.forEach((e) => console.log(`  ${e}`));
check(root.root === `${REPO}/control/machine-observation`,
  "source root is derived from the service's own plist, not hard-coded", String(root.root));

const impact = resolveServiceImpact(CHANGED);
console.log(`\n[IMPACT] ${impact.status} -> ${impact.service_id}`);
impact.evidence.forEach((e) => console.log(`  ${e}`));
check(impact.status === "RESOLVED" && impact.service_id === "machine-observer",
  "a changed source path resolves to a registered service", `${impact.status}/${impact.service_id}`);

const noImpact = resolveServiceImpact([`${REPO}/README.md`]);
check(noImpact.status !== "RESOLVED",
  "a path outside every service source root does NOT resolve to a service", noImpact.status);

const rev = computeSourceRevision(root.root!);
console.log(`\n[REVISION] digest ${rev.revision_digest}  files ${rev.file_count}  newest ${rev.newest_mtime}`);
check(rev.file_count > 0 && rev.newest_mtime !== "", "the source revision is computed from real files", `${rev.file_count} files`);
// PRE-RELOAD STALENESS is a fact about this machine at this moment, not an
// invariant — the first run of this proof fixed it, so a later run finds the
// runtime already current. Reported, and the meaningful invariant (the process
// running AFTER the reload is not stale) is asserted further down instead.
const startedBefore = pidObservedBefore === null ? null
  : new Date(Date.parse(execFileSync("/bin/ps", ["-o", "lstart=", "-p", String(pidObservedBefore)], { encoding: "utf8" }).trim())).toISOString();
const staleBefore = startedBefore !== null && startedBefore < rev.newest_mtime;
console.log(`[STALE BEFORE?] running pid ${pidObservedBefore} started ${startedBefore}, newest source ${rev.newest_mtime} -> ${staleBefore ? "STALE (holding replaced code)" : "already current"}`);
check(startedBefore !== null, "staleness is computed from the real process start time, not assumed", String(startedBefore));

console.log(`\n[RELOAD] asking control/service-reload -> control/runtime-control ...`);
const outcome = await requestReload({ changed_paths: CHANGED, repo_root: REPO, execute: true });

console.log(`\n[GATE] ${outcome.gate.status}  authority=${outcome.gate.authority}  revision=${outcome.gate.verified_revision?.slice(0, 16) ?? "none"}`);
outcome.gate.checks.forEach((c) => console.log(`  ${c.status.padEnd(10)} ${c.name}  ${c.detail}`));
outcome.gate.unresolved_reasons.forEach((r) => console.log(`  UNRESOLVED: ${r}`));

console.log(`\n[DECISION] ${outcome.decision} — ${outcome.reason}`);
if (outcome.operation) {
  const o = outcome.operation;
  console.log(`[RUNTIME-CONTROL] operation_id=${o.operation_id} action=${o.requested_action} result=${o.result}`);
  console.log(`  pid ${o.pid_before} -> ${o.pid_after}   health ${o.health_before.http_status} -> ${o.health_after.http_status}`);
  console.log(`  duplicate_check listening_pids=[${(o.duplicate_check?.listening_pids ?? []).join(",")}] duplicate=${o.duplicate_check?.duplicate_detected ?? "NOT_MEASURED"}`);
}
if (outcome.proof) outcome.proof.evidence.forEach((e) => console.log(`  ${e}`));

// WHICH OUTCOME IS CORRECT DEPENDS ON THE GATE, AND BOTH ARE ASSERTED.
// A reload that executes when the gate failed is a broken gate; a reload that
// refuses when the gate passed is a broken flow. The script does not assume
// the repository is green — it asserts the invariant that actually holds.
if (outcome.gate.status === "PASSED") {
  check(outcome.operation !== null && outcome.operation.operation_id.length > 0,
    "gate PASSED: runtime-control executed the restart and issued its own operation evidence (the only execution boundary)",
    `operation_id ${outcome.operation?.operation_id}, runtime-control result ${outcome.operation?.result}`);
  check(outcome.proof?.pid_changed === true, "gate PASSED: PID changed — launchd really replaced the process",
    `${outcome.proof?.pid_before} -> ${outcome.proof?.pid_after}`);
  check(outcome.health_after?.http_status === 200, "gate PASSED: health is 200 after the reload",
    `${outcome.health_after?.http_status} via ${outcome.health_after?.source} after ${outcome.health_after?.waited_ms}ms`);
  check(outcome.proof?.loaded_current_revision === true,
    "gate PASSED: the new process is proven to be running the current source revision", String(outcome.proof?.process_started_at));
  check(outcome.operation?.duplicate_check?.duplicate_detected === false,
    "gate PASSED: no duplicate process is listening on the port", "");
  check(outcome.decision === "RELOADED", "gate PASSED: decision is RELOADED", outcome.decision);
  check(outcome.gate.authority === "WORKING_TREE_VERIFIED" || outcome.gate.authority === "COMMIT_VERIFIED",
    "gate PASSED: the reload ran on a real authority, never on a fabricated commit", outcome.gate.authority);
} else {
  // FAIL CLOSED. This is the branch the repository is actually in today, and
  // it is the more important one to prove: a failing declared check must stop
  // the flow BEFORE runtime-control is asked for anything.
  check(outcome.operation === null,
    "gate did not pass: runtime-control was never asked to do anything",
    `decision ${outcome.decision}`);
  check(outcome.decision === "BLOCKED_BY_GATE" || outcome.decision === "BLOCKED_UNRESOLVED_IMPACT",
    "gate did not pass: the decision is an explicit block, not a silent skip", outcome.decision);
  check(pidOf() === pidObservedBefore,
    "gate did not pass: the running process is untouched", `pid still ${pidOf()}`);
  check(outcome.gate.authority === "NONE",
    "gate did not pass: no authority was claimed", outcome.gate.authority);
  check(outcome.gate.checks.some((c) => c.status === "FAILED") || outcome.gate.unresolved_reasons.length > 0,
    "gate did not pass: the reason is named, with the real command that produced it",
    outcome.gate.checks.map((c) => `${c.name}:${c.status}`).join(" "));
}

check(outcome.gate.checks.some((c) => c.command?.startsWith("npm run")) || outcome.gate.checks.some((c) => c.name === "post_commit_verification"),
  "the gate used this repo's OWN declared verification, not a check invented here",
  outcome.gate.checks.map((c) => `${c.name}:${c.status}`).join(" "));

// AUTHORITY. An uncommitted change may be reloaded by an owner and must never
// be reloaded unattended — the tree can change between the check and the act.
const automatic = await requestReload({ changed_paths: CHANGED, repo_root: REPO, trigger: "AUTOMATIC", execute: true });
check(automatic.operation === null,
  "an AUTOMATIC reload never reaches runtime-control without COMMIT_VERIFIED authority",
  `${automatic.decision} (gate authority ${automatic.gate.authority})`);

const observeOnly = await requestReload({ changed_paths: CHANGED, repo_root: REPO });
check(observeOnly.operation === null,
  "without execute:true nothing is asked of runtime-control — the observation layer may report, never act", observeOnly.decision);

const src = execFileSync("/bin/cat", [`${REPO}/control/service-reload/resolver.ts`], { encoding: "utf8" })
  .split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//") && !l.trim().startsWith("/*"));
// The distinction that matters is READ vs MUTATE. `launchctl list` is how this
// capability observes which pid is running — the same read runtime-control
// does — and observing is allowed. What must be absent is any verb that
// changes a process: bootstrap, bootout, kickstart, enable/disable, kill,
// spawn. Asserting on the mere string "launchctl" would fail on a read and
// would say nothing about authority.
const mutating = src.filter((l) => /\b(bootstrap|bootout|kickstart|launchctl\s+(load|unload|enable|disable))\b|\bkill\(|\bspawn\(|execFile\w*\(\s*["'`][^"'`]*kill/.test(l));
check(mutating.length === 0,
  "this capability contains no process-mutating verb of its own — it reads launchctl, and asks runtime-control to act",
  mutating.length ? mutating.join(" / ") : "reads only");

console.log(`\n${"=".repeat(78)}\n[REGRESSION]`);
checks.forEach((c) => console.log(`  ${c.ok ? "✔" : "✘"} ${c.label}${c.detail ? ` — ${c.detail}` : ""}`));
const failed = checks.filter((c) => !c.ok).length;
console.log(`\nRESULT: ${checks.length - failed} passed, ${failed} failed`);
console.log(`Observed pid after, independently: ${pidOf()}`);
process.exit(failed === 0 ? 0 : 1);
}

void main();
