/**
 * หน้าที่: proves Runtime Verification only accepts a real, fresh
 * evidence file — never a missing or stale one.
 *
 * How to run: npx tsx control/runtime-verification/tests/runtime-verification.test.ts
 */

import { writeFileSync, mkdirSync, utimesSync } from "node:fs";
import { verifyRuntime } from "../contract";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
function check(name: string, body: () => void): void {
  try {
    body();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const sandboxDir = "tests/__sandbox__/runtime-verification";
mkdirSync(sandboxDir, { recursive: true });
const freshEvidencePath = `${sandboxDir}/fresh-evidence.jsonl`;
const staleEvidencePath = `${sandboxDir}/stale-evidence.jsonl`;
writeFileSync(freshEvidencePath, "{}\n");
writeFileSync(staleEvidencePath, "{}\n");
const oldTime = new Date("2020-01-01T00:00:00.000Z");
utimesSync(staleEvidencePath, oldTime, oldTime);

check("A. missing evidence file -> UNRESOLVED", () => {
  const result = verifyRuntime({ capability_id: "capability-x", deploy_install_completed_at: new Date().toISOString(), runtime_evidence_ref: `${sandboxDir}/no-such-file.jsonl`, correlation_id: "c1" });
  assert(result.status === "UNRESOLVED", `expected UNRESOLVED, got ${result.status}`);
});

check("B. evidence file older than deploy/install completion -> RUNTIME_VERIFY_FAILED", () => {
  const result = verifyRuntime({ capability_id: "capability-x", deploy_install_completed_at: new Date().toISOString(), runtime_evidence_ref: staleEvidencePath, correlation_id: "c2" });
  assert(result.status === "RUNTIME_VERIFY_FAILED", `expected RUNTIME_VERIFY_FAILED, got ${result.status}`);
});

check("C. evidence file fresh (modified after deploy/install completion) -> RUNTIME_VERIFIED", () => {
  const beforeInstall = new Date(Date.now() - 60_000).toISOString();
  const result = verifyRuntime({ capability_id: "capability-x", deploy_install_completed_at: beforeInstall, runtime_evidence_ref: freshEvidencePath, correlation_id: "c3" });
  assert(result.status === "RUNTIME_VERIFIED", `expected RUNTIME_VERIFIED, got ${result.status}: ${result.reason}`);
});

check("D. invalid deploy_install_completed_at -> UNRESOLVED", () => {
  const result = verifyRuntime({ capability_id: "capability-x", deploy_install_completed_at: "not-a-date", runtime_evidence_ref: freshEvidencePath, correlation_id: "c4" });
  assert(result.status === "UNRESOLVED", `expected UNRESOLVED, got ${result.status}`);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
