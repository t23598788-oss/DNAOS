/**
 * Asserts Step-8 live Linux evidence written by own-machine-core-linux-live.sh.
 * Does not launch Docker itself (that harness is the process proof).
 *
 * Run after the Linux container proof:
 *   npx tsx contracts/architecture/own-machine-core-linux-live.test.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

declare const process: { cwd(): string; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const EVIDENCE = join(process.cwd(), "tests/__sandbox__/step8-linux-live");

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
  }
}

function read(name: string): string {
  return readFileSync(join(EVIDENCE, name), "utf8").trim();
}

function readJson(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(EVIDENCE, name), "utf8")) as Record<string, unknown>;
}

if (!existsSync(join(EVIDENCE, "boot-result.txt"))) {
  console.error("FAIL live Linux evidence missing — run contracts/architecture/own-machine-core-linux-live.sh");
  process.exitCode = 1;
} else {
  check("boot BOOT_OK", read("boot-result.txt") === "BOOT_OK");
  const health = readJson("health.json");
  check("health ok from live server.ts", health.ok === true);
  const runtime = health.runtime_instance as Record<string, unknown>;
  check("health reports pid", typeof runtime.pid === "number");
  check("health launch_agent_label is not launchd", runtime.launch_agent_label == null);
  check("unauthenticated POST /command is 401", read("unauth.status") === "401");
  check("authenticated POST /command is 200", read("command.status") === "200");
  const command = readJson("command.json");
  check("live POST /command entered submitOwnerCommand", command.next_layer === "EXISTING_MCP_SUBMIT_COMMAND");
  const mcp = command.mcp as Record<string, unknown>;
  const result = mcp.result as Record<string, unknown>;
  const lifecycle = mcp.lifecycle as { history?: { stage: string }[] };
  const stages = (lifecycle.history ?? []).map((h) => h.stage);
  check("router lifecycle classified+routed", stages.includes("classified") && stages.includes("routed"));
  check("command-router produced capability_id", typeof result.capability_id === "string" && String(result.capability_id).length > 0);
  check("authenticated permission POST is 200", read("permission.status") === "200");
  const permission = readJson("permission.json");
  check("permission POST entered submitOwnerCommand", permission.next_layer === "EXISTING_MCP_SUBMIT_COMMAND");
  const permMcp = permission.mcp as Record<string, unknown>;
  const permResult = permMcp.result as Record<string, unknown>;
  check("permission POST routed to permission-reasoner", permResult.capability_id === "permission-reasoner");
  const permEvidence = Array.isArray(permResult.evidence) ? permResult.evidence as { source?: string; note?: string }[] : [];
  const policyEvidence = permEvidence.find((e) => e.source === "permission-reasoner" && typeof e.note === "string" && e.note.includes("decision="));
  check("evaluateExecutionPermission evidence present", Boolean(policyEvidence), policyEvidence ? String(policyEvidence.note) : JSON.stringify(permEvidence));
  check("GET /task/:id 200", read("task.status") === "200");
  check("Mac authenticate fail-closed 503", read("mac-auth.status") === "503");
  const mac = readJson("mac-auth.json");
  check("Mac authenticate execution_attempted false", mac.execution_attempted === false && mac.required_node === "MAC_LOCAL_AGENT");
  check("local/operation fail-closed 503", read("local-op.status") === "503");
  check("SIGTERM graceful", read("shutdown.txt").includes("SIGTERM_OK"));
  check("Linux uname", read("uname.txt").includes("Linux"));
  check("Debian bookworm", read("os-release.txt").includes("bookworm"));
  check("launch command is current server.ts", read("launch-command.txt") === "npx tsx transport/owner-command-http/server.ts");
  const supplied = read("env-supplied.txt");
  check("OWNER_COMMAND_HTTP_SHARED_SECRET supplied", supplied.includes("OWNER_COMMAND_HTTP_SHARED_SECRET"));
  const absent = read("env-absent.txt");
  check("Railway/Vercel env names listed absent", absent.includes("RAILWAY_PROJECT_TOKEN") && absent.includes("VERCEL_TOKEN"));
  check("Linux suite runtime-endpoint-registry exit 0", read("runtime-endpoint-registry.exit") === "0");
  check("Linux suite domain-guard exit 0", read("portability-domain-guard.exit") === "0");
  check("Linux suite portable-supervisor exit 0", read("portable-supervisor.exit") === "0");
  check("Linux suite secret-resolver exit 0", read("secret-resolver.exit") === "0");
  check("Linux suite checkout-portability exit 0", read("checkout-portability.exit") === "0");
  check("Linux suite own-machine-core-acceptance exit 0", read("own-machine-core-acceptance.exit") === "0");
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}
