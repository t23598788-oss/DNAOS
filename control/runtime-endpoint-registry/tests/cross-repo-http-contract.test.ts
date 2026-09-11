/**
 * Read-only freeze of Deadboard / Control Workspace → Core HTTP hops.
 * Does not modify siblings. Skips a sibling that is not checked out.
 *
 * Run: npx tsx control/runtime-endpoint-registry/tests/cross-repo-http-contract.test.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

declare const process: { cwd(): string; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    console.error(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
  }
}

const ROOT = process.cwd();
const CORE_TRANSPORT = join(ROOT, "transport/owner-command-http");
const CORE = readFileSync(join(CORE_TRANSPORT, "server.ts"), "utf8");
const BACKBONE = readFileSync(join(CORE_TRANSPORT, "owner-backbone-routes.ts"), "utf8");
const CORE_ALL = CORE + BACKBONE;

check("Core still serves POST /command", CORE.includes("POST") && /\/command/.test(CORE));
check("Core still serves /owner/console", BACKBONE.includes("/owner/console"));
check("Core still serves /task/:id", CORE.includes("taskMatch") && CORE.includes("/task"));
check("Core still serves /runtime/inventory", CORE.includes("/runtime/inventory"));
check("Core still serves /handoffs", CORE.includes("/handoffs"));
check("Core listen default remains 8791 in catalog", readFileSync(join(ROOT, "control/runtime-control/host-runtime.ts"), "utf8").includes("port: 8791"));

const dead = "/Users/tam/Desktop/dna-os-deadboard";
if (existsSync(dead)) {
  const infraCommand = readFileSync(join(dead, "app/api/infra-command/route.ts"), "utf8");
  check("Deadboard INFRA_OWNER_COMMAND_URL default 8791", infraCommand.includes('process.env.INFRA_OWNER_COMMAND_URL ?? "http://127.0.0.1:8791"'));
  check("Deadboard POST /command", infraCommand.includes("${infraUrl}/command") || infraCommand.includes("`/${infraUrl}/command") || infraCommand.includes("/command"));
  check("Deadboard uses Bearer shared secret", infraCommand.includes("Authorization") && infraCommand.includes("INFRA_OWNER_COMMAND_SHARED_SECRET"));
  const consoleRoute = readFileSync(join(dead, "app/api/infra-console/route.ts"), "utf8");
  check("Deadboard GET /owner/console", consoleRoute.includes("/owner/console"));
  const taskRoute = readFileSync(join(dead, "app/api/infra-task/[taskId]/route.ts"), "utf8");
  check("Deadboard GET /task/:id", taskRoute.includes("/task/"));
  const ops = readFileSync(join(dead, "app/api/admin/agent-operations/route.ts"), "utf8");
  check("Deadboard /runtime/inventory", ops.includes("/runtime/inventory"));
  check("Deadboard /handoffs", ops.includes("/handoffs"));
} else {
  check("Deadboard checkout absent — Core freeze still recorded", true);
}

const cw = "/Users/tam/Developer/DNA-OS/source/dna-os-control-workspace";
if (existsSync(cw)) {
  const endpoints = readFileSync(join(cw, "server/core-endpoints.mjs"), "utf8");
  check("Control Workspace DNA_OS_CORE_URL default 8791", endpoints.includes('process.env.DNA_OS_CORE_URL ?? "http://127.0.0.1:8791"'));
  check("Control Workspace /owner/command", endpoints.includes("/owner/command"));
} else {
  check("Control Workspace checkout absent — skip product freeze", true);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
