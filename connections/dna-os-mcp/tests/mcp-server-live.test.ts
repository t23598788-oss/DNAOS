/**
 * OWNER_COMMAND_LIVE — ENVIRONMENT_REQUIRED. Not part of source admission.
 * FIXTURE: none. Uses the authorized running Owner-command HTTP surface when present.
 *
 * How to run:
 *   npx tsx connections/dna-os-mcp/tests/mcp-server-live.test.ts
 */

import { DNA_OS_MCP_TOOLS, DnaOsHttpClient } from "../contract";

declare const process: { env: Record<string, string | undefined>; exit: (code: number) => void };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

async function main(): Promise<void> {
  const submitTool = DNA_OS_MCP_TOOLS.find((tool) => tool.metadata.name === "submit_command");
  if (!submitTool) {
    console.error("OWNER_COMMAND_LIVE=FAILED missing submit_command");
    process.exit(1);
    return;
  }
  const secret = process.env.OWNER_COMMAND_HTTP_SHARED_SECRET;
  if (!secret) {
    console.log("OWNER_COMMAND_LIVE=AUTH_REQUIRED");
    console.log("AUTH_REQUIRED missing OWNER_COMMAND_HTTP_SHARED_SECRET");
    process.exit(3);
  }
  const client = new DnaOsHttpClient();
    const response = await submitTool.handler({ commandText: "ตรวจสถานะ firewall", agentIdentity: { id: "live-fixture", email: "live@fixture" } }, client);
  const body = response.structuredContent as Record<string, unknown>;
  const status = body.status as number;
  const error = String(body.error ?? "");
  if (status === 401 || error === "unauthorized" || error === "write authentication is not configured") {
    console.log("OWNER_COMMAND_LIVE=AUTH_REQUIRED");
    console.log(`AUTH_REQUIRED status=${status} error=${error}`);
    process.exit(3);
  }
  if (status === 200 || status === 403 || error === "OWNER_AUTHENTICATION_REQUIRED") {
    console.log("OWNER_COMMAND_LIVE=VERIFIED");
    process.exit(0);
  }
  console.error(`OWNER_COMMAND_LIVE=FAILED status=${status} error=${error}`);
  process.exit(1);
}

void main();
