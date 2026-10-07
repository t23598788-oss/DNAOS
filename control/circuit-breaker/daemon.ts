/**
 * หน้าที่: the poll loop itself — Owner, 2026-08-22 ("Deterministic
 * Circuit Breaker", see `/Users/tam/.claude/plans/zesty-spinning-ripple.md`).
 * Watches `../agent-host/contract.ts`'s live `listActiveLaunches()` — **the
 * only source of PIDs this file may ever act on**, per the Owner's own
 * scoping decision (agent-host-launched subprocesses only, never an
 * interactive coding session; a kernel sandbox can only confine a
 * process launched inside it, so nothing here can reach further even if
 * it wanted to). For each active launch, checks whatever `.ts` files it
 * has written since it started against
 * `../../governance/source-validation/contract.ts`'s real
 * `checkImportBoundaries()` — the same mechanical Capability Folder Law
 * ข้อ 9 checker `reports/SYSTEM_JOINT_AND_SEARCH_WASTE_AUDIT_2026-08-22.md`
 * proved finds real violations at repo scale.
 *
 * Every detected violation is ALWAYS reported to
 * `../../observability/joint-monitor/contract.ts`'s `reportViolation` —
 * the dashboard goes red regardless of enforcement mode. The process is
 * only actually killed (`../agent-host/contract.ts`'s `killLaunch`) when
 * `enforce`/`CIRCUIT_BREAKER_ENFORCE=1` is set — default **off**, dry-
 * run/report-only, per the plan's own risk-staging (a false-positive
 * kill mid-write could corrupt work; this must be proven safe on a real
 * dry-run period before enforcement is ever turned on).
 *
 * `execution/run/`'s separate `workspacePolicyViolation` signal is
 * DELIBERATELY not polled here: that signal is computed post-hoc, after
 * the child process has already exited (see `execution/run/executor.ts`'s
 * `finalize()`), so by construction there is nothing left alive to kill
 * by the time it exists, and `execution/run/` does not spawn through
 * `../agent-host/` in the first place — out of this daemon's scope
 * entirely, not an oversight.
 *
 * Input: `CircuitBreakerOptions`.
 * Output: `CircuitBreakerHandle` (`startCircuitBreaker`), `PollResult`
 * (`pollOnce`, exported separately so a test can drive one real poll
 * cycle deterministically instead of waiting on a live timer).
 * Dependency ที่อนุญาต: ./types.ts, ./host-runtime.ts,
 * `../agent-host/contract.ts` (its public entry points —
 * `listActiveLaunches`, `killLaunch`), `../../governance/source-validation/contract.ts`
 * (`checkImportBoundaries`), `../../observability/joint-monitor/contract.ts`
 * (`reportViolation`).
 * สิ่งที่ห้ามแตะ: never call `killLaunch` on a `launchId` this file did
 * not itself read from `listActiveLaunches()` in the SAME poll cycle —
 * no caller-supplied launchId, no cached/stale id from a prior cycle.
 * Never kill when `enforce` is false, no matter how severe the
 * violation — dry-run means dry-run.
 */

import { listActiveLaunches, killLaunch } from "../agent-host/contract";
import { checkImportBoundaries } from "../../governance/source-validation/contract";
import { reportViolation } from "../../observability/joint-monitor/contract";
import { listFilesModifiedSince, readEnvVar, relativePath, repoRootDirname, startInterval, stopInterval } from "./host-runtime";
import type { CircuitBreakerHandle, CircuitBreakerOptions, PollResult } from "./types";

const DEFAULT_POLL_INTERVAL_MS = 2_000;

function isEnforced(options: CircuitBreakerOptions): boolean {
  if (options.enforce !== undefined) return options.enforce;
  return readEnvVar("CIRCUIT_BREAKER_ENFORCE") === "1";
}

/** One real poll cycle — exported standalone so a test can drive it deterministically, without waiting on `startInterval`'s live timer. */
export async function pollOnce(options: CircuitBreakerOptions = {}): Promise<PollResult> {
  const root = repoRootDirname();
  const enforce = isEnforced(options);
  const active = listActiveLaunches();
  const killed: string[] = [];
  let violationsFound = 0;

  for (const launch of active) {
    const startedAtMs = new Date(launch.startedAt).getTime();
    const changedAbsFiles = listFilesModifiedSince(launch.allowedWorkspaceDir, startedAtMs);
    if (changedAbsFiles.length === 0) continue;
    const changedRelFiles = changedAbsFiles.map((absPath) => relativePath(root, absPath));
    const violations = checkImportBoundaries(changedRelFiles);
    if (violations.length === 0) continue;

    violationsFound += violations.length;
    for (const violation of violations) {
      void reportViolation({
        launch_id: launch.launchId,
        reason: "IMPORT_BOUNDARY_VIOLATION",
        detail: `${violation.from_file} imports ${violation.to_file} (${violation.to_capability}) directly, bypassing its contract.ts`,
        source: "control/circuit-breaker/daemon.ts#pollOnce",
        enforced: enforce,
      });
    }

    if (enforce) {
      const result = killLaunch(launch.launchId, `IMPORT_BOUNDARY_VIOLATION: ${violations.length} violation(s) detected`);
      if (result.ok) killed.push(launch.launchId);
    }
  }

  return { checked_launches: active, violations_found: violationsFound, launches_killed: killed };
}

/** The live, timer-driven daemon — `./tests/kill-on-violation-proof.test.ts` uses `pollOnce()` directly instead, for a deterministic single-cycle proof. */
export function startCircuitBreaker(options: CircuitBreakerOptions = {}): CircuitBreakerHandle {
  const intervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const handle = startInterval(() => {
    void pollOnce(options);
  }, intervalMs);
  return { stop: () => stopInterval(handle) };
}
