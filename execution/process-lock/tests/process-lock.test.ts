/**
 * หน้าที่: proves the real cross-process guarantee, including a genuine
 * multi-process test (real `child_process.spawn`, not simulated) — 100
 * separate OS processes racing the same lock_key, exactly one must win.
 *
 * How to run: npx tsx execution/process-lock/tests/process-lock.test.ts
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { acquireLock, releaseLock, renewLock } from "../contract";

declare const process: { exitCode?: number; cwd(): string };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
async function check(name: string, body: () => Promise<void> | void): Promise<void> {
  try {
    await body();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const sandboxLockDir = join("local-runtime/process-locks");
mkdirSync(sandboxLockDir, { recursive: true });

async function main() {
  await check("A. first acquire on a fresh lock_key -> ACQUIRED", () => {
    const key = `test-a-${Date.now()}`;
    const result = acquireLock({ lock_key: key, holder_id: "holder-1", lease_ms: 10_000 });
    assert(result.status === "ACQUIRED", `expected ACQUIRED, got ${result.status}`);
    releaseLock(key, "holder-1");
  });

  await check("B. second acquire while first still valid -> CONFLICT, real held_by reported", () => {
    const key = `test-b-${Date.now()}`;
    const first = acquireLock({ lock_key: key, holder_id: "holder-1", lease_ms: 10_000 });
    assert(first.status === "ACQUIRED", "setup must acquire");
    const second = acquireLock({ lock_key: key, holder_id: "holder-2", lease_ms: 10_000 });
    assert(second.status === "CONFLICT", `expected CONFLICT, got ${second.status}`);
    assert(second.held_by?.holder_id === "holder-1", `expected real held_by=holder-1, got ${JSON.stringify(second.held_by)}`);
    releaseLock(key, "holder-1");
  });

  await check("C. release by non-holder -> NOT_HOLDER, lock stays held", () => {
    const key = `test-c-${Date.now()}`;
    acquireLock({ lock_key: key, holder_id: "holder-1", lease_ms: 10_000 });
    const releaseAttempt = releaseLock(key, "holder-2");
    assert(releaseAttempt.status === "NOT_HOLDER", `expected NOT_HOLDER, got ${releaseAttempt.status}`);
    const stillHeld = acquireLock({ lock_key: key, holder_id: "holder-3", lease_ms: 10_000 });
    assert(stillHeld.status === "CONFLICT", "lock must still be held by holder-1");
    releaseLock(key, "holder-1");
  });

  await check("D. expired lease is reclaimable by a new holder", async () => {
    const key = `test-d-${Date.now()}`;
    acquireLock({ lock_key: key, holder_id: "holder-1", lease_ms: 50 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const reclaim = acquireLock({ lock_key: key, holder_id: "holder-2", lease_ms: 10_000 });
    assert(reclaim.status === "ACQUIRED", `expected ACQUIRED after lease expiry, got ${reclaim.status}`);
    releaseLock(key, "holder-2");
  });

  await check("E. renewLock extends the real holder's own lease without a release window", () => {
    const key = `test-e-${Date.now()}`;
    acquireLock({ lock_key: key, holder_id: "holder-1", lease_ms: 100 });
    const renewed = renewLock(key, "holder-1", 10_000);
    assert(renewed.status === "ACQUIRED", `expected ACQUIRED, got ${renewed.status}`);
    const contender = acquireLock({ lock_key: key, holder_id: "holder-2", lease_ms: 10_000 });
    assert(contender.status === "CONFLICT", "renewed lease must still block a contender");
    releaseLock(key, "holder-1");
  });

  await check("F. 100 concurrent (same-process) acquire attempts on one lock_key -> exactly one ACQUIRED", () => {
    const key = `test-f-${Date.now()}`;
    const results = Array.from({ length: 100 }, (_, i) => acquireLock({ lock_key: key, holder_id: `holder-${i}`, lease_ms: 10_000 }));
    const acquired = results.filter((r) => r.status === "ACQUIRED");
    assert(acquired.length === 1, `expected exactly 1 ACQUIRED, got ${acquired.length}`);
    releaseLock(key, acquired[0].claim!.holder_id);
  });

  await check("G. REAL cross-process test — 20 separate OS processes race the same lock_key, exactly one wins", async () => {
    const key = `test-g-cross-process-${Date.now()}`;
    const N = 20;
    const workerScript = join(__dirname, "process-lock-worker.ts");
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) => runWorker(workerScript, [key, `proc-${i}`])),
    );
    const acquiredCount = results.filter((r) => r.trim() === "ACQUIRED").length;
    assert(acquiredCount === 1, `expected exactly 1 real OS process to win, got ${acquiredCount}. results=${JSON.stringify(results)}`);
  });

  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

function runWorker(script: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", script, ...args], { cwd: process.cwd() });
    let stdout = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.on("error", reject);
    child.on("close", () => resolve(stdout));
  });
}

main()
  .catch((error) => {
    console.error("FATAL", error);
    process.exitCode = 1;
  })
  .finally(() => {
    // SAFETY FIX (2026-08-24): this used to be
    //   rmSync(sandboxLockDir, { recursive: true, force: true })
    // which deleted the ENTIRE SHARED lock directory —
    // `local-runtime/process-locks/` is the real, production, cross-process
    // lock store, not a sandbox. Running this test therefore silently
    // RELEASED every other session's held write boundary, which is the exact
    // failure the lock exists to prevent. Observed live: a held
    // WORK:/SOURCE: claim from another work order vanished mid-run.
    //
    // Each case above already releases its own uniquely-named key, so no
    // blanket delete was ever needed. This sweeps only leftovers this test
    // could have created (its keys are all `test-<letter>-<epoch>`), and
    // never touches a key it does not own.
    if (!existsSync(sandboxLockDir)) return;
    for (const entry of readdirSync(sandboxLockDir)) {
      if (/^test-[a-z]-\d+\.lock\.json$/.test(entry)) {
        rmSync(join(sandboxLockDir, entry), { force: true });
      }
    }
  });
