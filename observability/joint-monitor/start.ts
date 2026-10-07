/**
 * หน้าที่: the real, runnable entrypoint — builds a `JointStore`, starts
 * the SSE/JSON server on port 5178 by default. CORRECTION (owner,
 * 2026-08-22, "FIX RESEARCH API NAVIGATION" task): this file's original
 * comment claimed 5177 was "confirmed unclaimed" per
 * `reports/SYSTEM_JOINT_AND_SEARCH_WASTE_AUDIT_2026-08-22.md` — that claim
 * was proven false the same day: 5177 is DNA-LAB-PERMISSION-REASONER's
 * real, permanent, LaunchAgent-managed Research Monitor UI
 * (`research/dashboard/monitor-ui/serve-static.mjs`, running since before
 * that audit), never discovered because that audit only grepped this
 * repo's own source, not actual host process state or sibling repos.
 * Moved off 5177 entirely rather than leaving a default that would collide
 * with (or squat ahead of) the real canonical UI. The other real ports
 * bound anywhere are 8790 `dna-os-circuit`, 8791
 * `transport/owner-command-http`, 8787 DNA-LAB-PERMISSION-REASONER's
 * research API, 5177 DNA-LAB-PERMISSION-REASONER's research monitor UI,
 * plus `connections/dna-os-mcp` and `connections/voice-command`'s own
 * listeners. Not imported by anything else — this is the process
 * entrypoint, run via `npx tsx observability/joint-monitor/start.ts`.
 *
 * Dependency ที่อนุญาต: ./joint-store.ts, ./server.ts, ./host-runtime.ts.
 */

import { JointStore } from "./joint-store";
import { startJointMonitorServer } from "./server";
import { readEnvVar } from "./host-runtime";

declare const console: { log(...args: unknown[]): void };

const store = new JointStore();
// PORT read first (2026-08-24, migration hardening — same real finding as
// dna-os-circuit/runtime/start.ts: Railway injects PORT and routes traffic
// to it). JOINT_MONITOR_PORT preserved as the fallback for existing Mac
// usage.
const port = Number(readEnvVar("PORT") ?? readEnvVar("JOINT_MONITOR_PORT") ?? "5178");
startJointMonitorServer(store, port);
console.log(`[joint-monitor] server listening on http://localhost:${port}`);
