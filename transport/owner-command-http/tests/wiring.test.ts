import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { handleCommand } from "../server";

declare const process: { exitCode?: number; cwd(): string };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const targetPath = "tests/__sandbox__/owner-command-http-wiring-probe.txt";
const envelopesPath = join(process.cwd(), "control/owner-command/data/envelopes.jsonl");

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const envelopeBody = {
    commandText: "create owner command HTTP wiring probe",
    idempotencyKey: `http-wiring-${Date.now()}`,
    workOrder: {
      operation: "CREATE",
      target_type: "FILE",
      target_path: targetPath,
      requested_change: "prove the existing HTTP to DNA OS wiring",
      content: "owner-command-http-wiring\n",
      workspace_scope: "tests/__sandbox__/",
      mode: "sandbox",
      required_tests: ["sandbox.write", "sandbox.readback"],
      forbidden_files: [],
      evidence: [{ source: "transport/owner-command-http/tests/wiring.test.ts", note: "focused transport wiring test" }],
    },
    ownerIdentity: { id: "http-wiring-test-owner", email: "http-wiring-test@example.invalid" },
  };
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(envelopeBody))]), { method: "POST", url: "/command" }) as IncomingMessage;
  let statusCode = 0;
  let responseBody = "";
  const res = {
    writeHead(status: number) { statusCode = status; },
    end(payload?: string) { responseBody = payload ?? ""; },
  } as unknown as ServerResponse;

  try {
    await handleCommand(req, res);
    const body = JSON.parse(responseBody) as { lifecycle?: { status?: string }; task?: { status?: string; task_id?: string }; result?: { verified?: boolean | null }; envelope?: { envelope_id?: string } };
    assert(statusCode === 200, `expected HTTP handler success, got ${statusCode}: ${responseBody}`);
    assert(body.lifecycle?.status === "completed", `expected Input Gateway completed lifecycle, got ${JSON.stringify(body.lifecycle)}`);
    assert(body.task?.status === "COMPLETED", `expected existing Agent Gateway task completion, got ${JSON.stringify(body.task)}`);
    assert(body.result?.verified === true, `expected independent runtime verification evidence, got ${JSON.stringify(body.result)}`);
    const taskId = body.task?.task_id;
    assert(typeof taskId === "string" && taskId.length > 0, "expected real task id");
    assert(typeof body.envelope?.envelope_id === "string", "expected real envelope id");

    const stages = readFileSync(envelopesPath, "utf8")
      .split("\n")
      .filter((line) => line.includes(`"envelope_id":"${body.envelope!.envelope_id}"`))
      .map((line) => (JSON.parse(line) as { stage: string }).stage);
    assert(stages.includes("command_received"), `missing command_received evidence: ${stages.join(",")}`);
    assert(stages.includes("admitted"), `missing admitted evidence: ${stages.join(",")}`);
    assert(stages.includes("dispatched"), `missing dispatched evidence: ${stages.join(",")}`);
    assert(stages.includes("completed"), `missing completed evidence: ${stages.join(",")}`);

    console.log("PASS HTTP /command handler -> Input Gateway -> existing Agent Gateway -> verified task");
  } finally {
    if (existsSync(join(process.cwd(), targetPath))) rmSync(join(process.cwd(), targetPath));
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
