/**
 * Migrated callers still observe the same addresses as adapter JSONL backing.
 * Run: npx tsx control/runtime-endpoint-registry/tests/caller-migration.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CANONICAL_TARGET, LOCAL_TARGET, resolveLaunchTarget } from "../../../local-runtime/dna-dev-app-host/contract";
import {
  ensureRuntimeEndpointsLoaded,
  joinEndpointAddress,
  resetRuntimeEndpointsForTests,
  resolveRuntimeEndpoint,
} from "../contract";

declare const process: { cwd(): string; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    console.error(`FAIL ${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ""}`);
  }
}

resetRuntimeEndpointsForTests();
ensureRuntimeEndpointsLoaded();

const circuitPublic = resolveRuntimeEndpoint({ query: "endpoint://dna-os-circuit/public", purpose: "observe" });
const jointPublic = resolveRuntimeEndpoint({ query: "endpoint://joint-monitor/public", purpose: "observe" });
const circuitLocal = resolveRuntimeEndpoint("endpoint://dna-os-circuit/local");
const jointLocal = resolveRuntimeEndpoint("endpoint://joint-monitor/local");
const coreLocal = resolveRuntimeEndpoint("endpoint://owner-command-http/local");
const mcpLocal = resolveRuntimeEndpoint("endpoint://dna-os-mcp/local");

check("circuit public resolves from adapter JSONL", circuitPublic.ok);
check("joint public resolves from adapter JSONL", jointPublic.ok);
check("dna-dev canonical equals resolved public circuit",
  CANONICAL_TARGET.url === (circuitPublic.ok ? circuitPublic.endpoint.address : "") && CANONICAL_TARGET.runtime_kind === "REGISTERED_REMOTE");
check("dna-dev local equals resolved local circuit",
  LOCAL_TARGET.url === (circuitLocal.ok ? circuitLocal.endpoint.address : "") && LOCAL_TARGET.runtime_kind === "NODE_LOCAL");
check("dna-dev resolveLaunchTarget does not silently swap to local",
  resolveLaunchTarget("REGISTERED_REMOTE").url !== LOCAL_TARGET.url);

check("joint-monitor local is catalog port 5178", jointLocal.ok && jointLocal.endpoint.address === "http://127.0.0.1:5178");
check("owner-command-http local is catalog port 8791", coreLocal.ok && coreLocal.endpoint.address === "http://127.0.0.1:8791");
check("dna-os-mcp local is catalog port 8793", mcpLocal.ok && mcpLocal.endpoint.address === "http://127.0.0.1:8793");

const remoteSrc = readFileSync(join(process.cwd(), "control/production-checkpoint/remote-discovery.ts"), "utf8");
check("remote-discovery has no provider listen domain", !/\.(railway|vercel)\.app\b/.test(remoteSrc));
const deploySrc = readFileSync(join(process.cwd(), "control/production-checkpoint/railway-deploy.ts"), "utf8");
check("railway-deploy health URL is resolved, not a Core hostname constant", !/\.(railway|vercel)\.app\b/.test(deploySrc));
check("alert-correlation resolve has no provider listen domain",
  !/\.(railway|vercel)\.app\b/.test(readFileSync(join(process.cwd(), "control/alert-correlation/resolve.ts"), "utf8")));
check("dna-dev config has no provider listen domain",
  !/\.(railway|vercel)\.app\b/.test(readFileSync(join(process.cwd(), "local-runtime/dna-dev-app-host/config.ts"), "utf8")));
check("joint-monitor client has no provider listen domain",
  !/\.(railway|vercel)\.app\b/.test(readFileSync(join(process.cwd(), "observability/joint-monitor/client.ts"), "utf8")));
check("system-graph has no provider listen domain",
  !/\.(railway|vercel)\.app\b/.test(readFileSync(join(process.cwd(), "software/system-graph/projection.ts"), "utf8")));

if (circuitPublic.ok) {
  check("circuit observe URL is origin + catalog health path",
    joinEndpointAddress(circuitPublic.endpoint).endsWith("/circuit.json"));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
