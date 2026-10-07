/**
 * หน้าที่: the live proof for ../contract.ts — a real
 * `control/agent-host/`-launched, kernel-sandboxed process really writes
 * a real file containing a real Capability Folder Law violation, and:
 * (A) with `enforce: true`, `pollOnce()` really detects it, really calls
 * `killLaunch`, and the process is REALLY dead before it finishes its
 * own sleep (proven by the absence of its own "completed" marker, not
 * an inferred timing assumption); (B) with `enforce` unset (the real
 * default), the SAME violation is still reported but the process
 * genuinely survives to completion — proving the dry-run/enforce switch
 * works in both directions, not just that killing is possible.
 *
 * How to run: npx tsx control/circuit-breaker/tests/kill-on-violation-proof.test.ts
 * (macOS only — real `/usr/bin/sandbox-exec`, same requirement as
 * ../../agent-host/tests/proof.test.ts)
 */

declare const require: (id: string) => unknown;
declare const process: { exitCode?: number; cwd(): string; execPath: string };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };
declare const setTimeout: (fn: () => void, ms: number) => unknown;

interface NodeFsModule {
  existsSync(path: string): boolean;
  mkdirSync(path: string, options: { recursive: boolean }): void;
}
interface NodePathModule {
  join(...parts: string[]): string;
}
const fs = require("fs") as NodeFsModule;
const nodePath = require("path") as NodePathModule;

import { launchAgent } from "../../agent-host/contract";
import { pollOnce } from "../contract";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SANDBOX_DIR = nodePath.join(process.cwd(), "control/circuit-breaker/tests/__sandbox__");
const WORKER_SCRIPT = nodePath.join(process.cwd(), "control/circuit-breaker/tests/violating-worker.mjs");
const WORKER_SLEEP_MS = 3000;

async function run(): Promise<void> {
  console.log("=== control/circuit-breaker/tests/kill-on-violation-proof.test.ts ===");
  if (!fs.existsSync(SANDBOX_DIR)) fs.mkdirSync(SANDBOX_DIR, { recursive: true });

  // A. enforce=true — the real violation is detected AND the real process is killed.
  {
    const launchPromise = launchAgent(
      { allowedWorkspaceDir: SANDBOX_DIR, agentExecutable: process.execPath, agentArgv: [WORKER_SCRIPT, "violation-enforced.ts", String(WORKER_SLEEP_MS)], timeoutMs: 15000 },
      {},
      [],
    );
    await sleep(800); // real window for the worker to have written its file before we poll.

    const pollResult = await pollOnce({ enforce: true });
    assert(pollResult.violations_found > 0, `expected a real violation to be found, got ${pollResult.violations_found}`);
    assert(pollResult.launches_killed.length > 0, `expected at least one launch killed, got ${JSON.stringify(pollResult.launches_killed)}`);
    console.log(`PASS: enforce=true poll detected ${pollResult.violations_found} real violation(s), killed ${pollResult.launches_killed.length} launch(es)`);

    const launchResult = await launchPromise;
    assert(!launchResult.stdout.includes("SLEEP_COMPLETED_WITHOUT_BEING_KILLED"), "the process must NOT have reached its own completion marker — it was really killed mid-sleep");
    assert(launchResult.signal !== null, `expected a real termination signal, got signal=${launchResult.signal} exitCode=${launchResult.exitCode}`);
    console.log(`PASS: the sandboxed process was REALLY killed before completing (signal=${launchResult.signal}), not just reported as killed`);
  }

  // B. enforce unset (real default) — the SAME kind of violation is still reported, but the process survives.
  {
    const launchPromise = launchAgent(
      { allowedWorkspaceDir: SANDBOX_DIR, agentExecutable: process.execPath, agentArgv: [WORKER_SCRIPT, "violation-dryrun.ts", String(WORKER_SLEEP_MS)], timeoutMs: 15000 },
      {},
      [],
    );
    await sleep(800);

    const pollResult = await pollOnce({}); // enforce omitted -> real CIRCUIT_BREAKER_ENFORCE env read, unset in this test run -> false
    assert(pollResult.violations_found > 0, `expected the same real violation to still be found in dry-run mode, got ${pollResult.violations_found}`);
    assert(pollResult.launches_killed.length === 0, `dry-run must never kill — got ${JSON.stringify(pollResult.launches_killed)}`);
    console.log(`PASS: enforce unset (dry-run) poll detected ${pollResult.violations_found} real violation(s), killed ZERO — reported, not acted on`);

    const launchResult = await launchPromise;
    assert(launchResult.stdout.includes("SLEEP_COMPLETED_WITHOUT_BEING_KILLED"), "the process must have genuinely survived to its own completion marker in dry-run mode");
    assert(launchResult.signal === null && launchResult.exitCode === 0, `expected a clean, un-killed exit, got signal=${launchResult.signal} exitCode=${launchResult.exitCode}`);
    console.log("PASS: the sandboxed process genuinely survived and completed normally in dry-run mode — enforce switch proven in both directions");
  }

  console.log("=== ALL kill-on-violation-proof.test.ts CASES PASSED ===");
}

run()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
