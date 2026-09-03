/**
 * หน้าที่: proves the real observation shape — runs an actual `status`
 * operation (real `launchctl list` + real `lsof` + one real HTTP probe)
 * against every registered service and checks the evidence record is
 * fully populated and internally consistent. Never asserts a specific
 * healthy/unhealthy outcome (that depends on whatever is actually running
 * on this machine at test time) — only that every fact was genuinely
 * observed and the evidence shape is correct.
 *
 * How to run: npx tsx control/runtime-control/tests/runtime-control.test.ts
 */

import { runOperation, SERVICES } from "../contract";
import type { ServiceId } from "../types";

declare const process: { exitCode?: number };
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

async function main() {
  for (const serviceId of Object.keys(SERVICES) as ServiceId[]) {
    await check(`status(${serviceId}) returns a fully-populated, internally consistent evidence record`, async () => {
      const ev = await runOperation(serviceId, "status");
      assert(ev.service_id === serviceId, "service_id echoed back");
      assert(ev.launchd_label === SERVICES[serviceId].launchd_label, "launchd_label matches registry");
      assert(ev.port === SERVICES[serviceId].port, "port matches registry");
      assert(typeof ev.timestamp_started === "string" && ev.timestamp_started.length > 0, "timestamp_started present");
      assert(typeof ev.timestamp_completed === "string" && ev.timestamp_completed.length > 0, "timestamp_completed present");
      assert(ev.health_before !== undefined && ev.health_after !== undefined, "health facts present (even if unhealthy)");
      assert(Array.isArray(ev.duplicate_check?.listening_pids), "duplicate_check.listening_pids is a real array");
      // launchd's own pid claim and the real listening-socket owner are
      // deliberately allowed to differ in this assertion — they are two
      // separate facts by design (Owner rule 8), not required to match.
      if (ev.result === "FAILED") {
        assert(typeof ev.failure_reason === "string" && ev.failure_reason.length > 0, "FAILED result always carries a non-empty failure_reason");
      } else {
        assert(ev.failure_reason === null, "SUCCESS result never carries a stale failure_reason");
      }
    });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
