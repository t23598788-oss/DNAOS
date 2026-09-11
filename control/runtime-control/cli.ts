#!/usr/bin/env -S npx tsx
/**
 * หน้าที่: one-shot CLI entrypoint for `control/runtime-control/` — NOT a
 * daemon, NOT a supervisor, NOT a polling loop. Runs exactly the requested
 * operation(s) once and exits. launchd remains the only long-running
 * process for the four target services; this file only issues bounded,
 * one-shot `launchctl`/HTTP calls through `./contract.ts` and prints the
 * resulting evidence.
 *
 * Usage: npx tsx control/runtime-control/cli.ts <start|stop|restart|health|status> <deadboard|lab-ui|research-api|compute-api|all>
 */

import { runOperation, SERVICES } from "./contract";
import type { Action, ServiceId } from "./types";

const [, , actionArg, targetArg] = process.argv;

const VALID_ACTIONS: Action[] = ["start", "stop", "restart", "health", "status"];
const VALID_TARGETS: (ServiceId | "all")[] = [
  "deadboard", "lab-ui", "research-api", "compute-api", "machine-observer",
  "dna-os-mcp", "owner-command-http", "dna-os-circuit", "all",
];

if (!actionArg || !targetArg || !VALID_ACTIONS.includes(actionArg as Action) || !VALID_TARGETS.includes(targetArg as ServiceId | "all")) {
  console.error(`Usage: npx tsx control/runtime-control/cli.ts <${VALID_ACTIONS.join("|")}> <${VALID_TARGETS.join("|")}>`);
  process.exit(2);
}

const action = actionArg as Action;
const targets: ServiceId[] = targetArg === "all" ? (Object.keys(SERVICES) as ServiceId[]) : [targetArg as ServiceId];

async function main(): Promise<void> {
  let anyFailed = false;
  for (const serviceId of targets) {
    const evidence = await runOperation(serviceId, action);
    if (evidence.result === "FAILED") anyFailed = true;
    console.log(JSON.stringify(evidence, null, 2));
  }
  process.exit(anyFailed ? 1 : 0);
}

main();
