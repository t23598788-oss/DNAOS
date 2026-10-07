/**
 * หน้าที่: proves Duplicate Reservation — sequential correctness (reuse of
 * the real, unmodified duplicate-resolution logic) plus REAL cross-process
 * tests (separate OS processes, not simulated) proving the required
 * acceptance criterion: many concurrent submissions of the identical real
 * capability produce exactly one canonical identity, now closed for real
 * via the atomic-authoritative-read/write `storeFactory` mechanism (see
 * ../resolver.ts's header).
 *
 * How to run: npx tsx control/duplicate-reservation/tests/duplicate-reservation.test.ts
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createPersistentFileStore } from "../../../software/registry-database/adapters/persistent-file-store";
import { findCapability } from "../../../software/registry-database/contract";
import { reserveAndRegister } from "../contract";
import { fingerprintCandidate } from "../../event-pipeline/contract";
import type { RegistrationCandidate } from "../../event-pipeline/contract";
import { acquireLock, releaseLock } from "../../../execution/process-lock/contract";

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

function fixtureCandidate(id: string, behaviorWords: number): RegistrationCandidate {
  return {
    candidate_id: `candidate-dup-reservation-${id}`,
    name: `test-dup-reservation-${id}`,
    kind: "capability",
    source_location: `control/duplicate-reservation/tests/fixtures/${id}/`,
    owner: "control/duplicate-reservation/tests/duplicate-reservation.test.ts",
    input: [], output: [], side_effects: [], dependencies: [],
    behavior: `a fixture capability for duplicate reservation ${"marker ".repeat(behaviorWords).trim()}`,
    version: "1.0.0",
    evidence_refs: ["control/duplicate-reservation/tests/duplicate-reservation.test.ts"],
    domain: "SOFTWARE_CONTROL_PLANE",
    resource_type: "CAPABILITY",
    data_classification: "INTERNAL",
    source_system: "dna-os-infrastructure",
    scope: "test",
  };
}

async function main() {
  // A SHARED, explicit dataDir with the REAL rehydrating adapter — the
  // storeFactory constructs a FRESH instance from this SAME directory
  // each call, exactly matching the real atomic-authoritative-read/write
  // mechanism under test (never a single long-lived cached instance).
  // createLocalFileStore is deliberately NOT used here — by its own
  // documented design it never reads back from disk at all (test-only,
  // deliberately ephemeral); only createPersistentFileStore genuinely
  // rehydrates from a shared directory, which this specific test needs.
  const sharedDataDir = join("tests/__sandbox__", `dup-reservation-single-process-${Date.now()}`);
  const storeFactory = () => createPersistentFileStore({ dataDir: sharedDataDir });

  await check("A. first reservation of a fresh fingerprint -> RESERVED_AND_REGISTERED, real REGISTERED pipeline result", () => {
    const candidate = fixtureCandidate("first", 1);
    const result = reserveAndRegister(candidate, storeFactory, "corr-a", "agent-1", 10_000);
    assert(result.reservation_outcome === "RESERVED_AND_REGISTERED", `expected RESERVED_AND_REGISTERED, got ${result.reservation_outcome}`);
    assert(result.pipeline_result !== null && (result.pipeline_result as { status: string }).status === "REGISTERED", `expected a real REGISTERED pipeline result, got ${JSON.stringify(result.pipeline_result)}`);
  });

  await check("B. sequential resubmission of the IDENTICAL fingerprint reuses the real, unmodified duplicate-resolution logic -> DUPLICATE, never a second capability_id", () => {
    const candidate = fixtureCandidate("second", 2);
    const first = reserveAndRegister(candidate, storeFactory, "corr-b1", "agent-1", 10_000);
    assert(first.reservation_outcome === "RESERVED_AND_REGISTERED", "setup must register");
    const duplicateCandidate = { ...candidate, candidate_id: "candidate-dup-reservation-second-again" };
    const second = reserveAndRegister(duplicateCandidate, storeFactory, "corr-b2", "agent-2", 10_000);
    assert(second.reservation_outcome === "RESERVED_AND_REGISTERED", "reservation itself succeeds — the pipeline still runs, it just reports DUPLICATE");
    assert((second.pipeline_result as { status: string })?.status === "DUPLICATE", `expected the real, unmodified duplicate-resolution to report DUPLICATE (proving the fresh, authoritative store construction really sees the first process's real commit), got ${JSON.stringify(second.pipeline_result)}`);
  });

  await check("C. lock held by another holder_id -> RESERVATION_CONFLICT, storeFactory and pipeline never called", () => {
    const candidate = fixtureCandidate("third", 3);
    const fp = fingerprintCandidate(candidate);
    const lockKey = `CAPABILITY_FINGERPRINT:${fp.semantic}`;
    const held = acquireLock({ lock_key: lockKey, holder_id: "blocker", lease_ms: 10_000 });
    assert(held.status === "ACQUIRED", "setup must hold the lock");
    let storeFactoryCalled = false;
    const result = reserveAndRegister(candidate, () => { storeFactoryCalled = true; return storeFactory(); }, "corr-c", "agent-1", 10_000);
    assert(result.reservation_outcome === "RESERVATION_CONFLICT", `expected RESERVATION_CONFLICT, got ${result.reservation_outcome}`);
    assert(result.pipeline_result === null, "pipeline must never be called on conflict");
    assert(storeFactoryCalled === false, "storeFactory must never be called before the lock is held — that would reintroduce the staleness gap");
    assert(result.held_by === "blocker", `expected the real holder reported, got ${result.held_by}`);
    releaseLock(lockKey, "blocker");
  });

  await check("D. the CAPABILITY_FINGERPRINT lock itself is real cross-process-safe — 15 separate OS processes racing the identical fingerprint's lock_key, exactly one acquires it", async () => {
    const candidate = fixtureCandidate("cross-process-lock-only", 4);
    const fp = fingerprintCandidate(candidate);
    const lockKey = `CAPABILITY_FINGERPRINT:${fp.semantic}`;
    const workerScript = join(__dirname, "..", "..", "..", "execution", "process-lock", "tests", "process-lock-worker.ts");
    const N = 15;
    const results = await Promise.all(Array.from({ length: N }, (_, i) => runWorker(workerScript, [lockKey, `proc-${i}`])));
    const acquiredCount = results.filter((r) => r.trim() === "ACQUIRED").length;
    assert(acquiredCount === 1, `expected exactly 1 real OS process to win the fingerprint lock, got ${acquiredCount}. results=${JSON.stringify(results)}`);
  });

  await check("E. GAP CLOSED, proven live — 15 real, separate OS processes submit the IDENTICAL real capability against a SHARED persistent store; exactly ONE real REGISTERED, every other process honestly sees DUPLICATE via the fresh, authoritative, post-lock store construction — never a second capability_id", async () => {
    const sharedCrossProcessDir = join("tests/__sandbox__", `dup-reservation-cross-process-${Date.now()}`);
    mkdirSync(sharedCrossProcessDir, { recursive: true });
    const workerScript = join(__dirname, "reservation-worker.ts");
    const N = 15;
    const results = await Promise.all(Array.from({ length: N }, (_, i) => runWorker(workerScript, [sharedCrossProcessDir, `proc-${i}`])));

    const registeredCount = results.filter((r) => r.startsWith("REGISTERED:REGISTERED")).length;
    const duplicateOrConflictCount = results.filter((r) => r.startsWith("REGISTERED:DUPLICATE") || r === "CONFLICT").length;

    assert(registeredCount === 1, `expected exactly 1 real REGISTERED across ${N} real OS processes (the gap is now closed), got ${registeredCount}. results=${JSON.stringify(results)}`);
    assert(registeredCount + duplicateOrConflictCount === N, `every process must resolve to REGISTERED or DUPLICATE/CONFLICT, got ${JSON.stringify(results)}`);

    const finalStore = createPersistentFileStore({ dataDir: sharedCrossProcessDir });
    const found = findCapability({ canonical_name: "test-cross-process-duplicate-reservation" }, finalStore);
    assert(found !== null, "the one real winner must be findable in the shared store");
    rmSync(sharedCrossProcessDir, { recursive: true, force: true });
  });

  console.log(`${passed} passed, ${failed} failed`);
  rmSync(sharedDataDir, { recursive: true, force: true });
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

main().catch((error) => {
  console.error("FATAL", error);
  process.exitCode = 1;
});
