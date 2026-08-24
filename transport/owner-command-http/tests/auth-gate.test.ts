/**
 * หน้าที่: the real test for this server's own use of
 * `permissions/network-auth-gate/` (2026-08-24 — peer review found the
 * gate itself was VERIFIED as a component, but nothing tested THIS
 * server's actual enforcement of it: no request ever exercised the real
 * dispatch path with no/wrong/correct token). Real HTTP, real TCP socket,
 * an ephemeral port (never 8791 — see ../server.ts's own real launchd
 * process on that port) — same pattern as
 * dna-os-circuit/runtime/tests/server.test.ts's `startCircuitServer(state, 0)`.
 *
 * Proves, for a real request against the exported `server`: no
 * Authorization header -> 401 and nothing downstream ran; a wrong token
 * -> 401 and nothing downstream ran; the correct token -> 200 and the
 * real Owner Command pipeline actually ran (mirrors ./wiring.test.ts's own
 * evidence-file check, not just the status code).
 *
 * How to run: npx tsx transport/owner-command-http/tests/auth-gate.test.ts
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { request } from "node:http";
import { server } from "../server";

declare const process: { env: Record<string, string | undefined>; exitCode?: number; cwd(): string };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const envelopesPath = join(process.cwd(), "control/owner-command/data/envelopes.jsonl");
const SECRET = "test-only-secret-auth-gate-verification-9f3a1c";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

/** Real evidence that the pipeline never ran for this idempotencyKey — same file, same check ./wiring.test.ts uses for the positive case, applied here as a negative assertion. */
function envelopeWasIngested(idempotencyKey: string): boolean {
  return readFileSync(envelopesPath, "utf8")
    .split("\n")
    .some((line) => line.includes(idempotencyKey));
}

/** Same real WorkOrder shape ./wiring.test.ts already proves end-to-end — used here so the correct-token case exercises the exact same real pipeline, and so a would-be-authorized request looks identical across all three cases. */
function realWorkOrderBody(idempotencyKey: string, targetPath: string): unknown {
  return {
    commandText: "create auth-gate probe file",
    idempotencyKey,
    workOrder: {
      operation: "CREATE",
      target_type: "FILE",
      target_path: targetPath,
      requested_change: "prove the auth gate's real enforcement at this server",
      content: "owner-command-http-auth-gate-probe\n",
      workspace_scope: "tests/__sandbox__/",
      mode: "sandbox",
      required_tests: ["sandbox.write", "sandbox.readback"],
      forbidden_files: [],
      evidence: [{ source: "transport/owner-command-http/tests/auth-gate.test.ts", note: "auth gate enforcement test" }],
    },
  };
}

/** Real `node:http` client — no global `fetch` assumed (this repo's own real local Node runtime predates it), same dependency discipline as dna-os-circuit/runtime/tests/server.test.ts's own `require("http")` use. */
function post(port: number, headers: Record<string, string>, idempotencyKey: string, targetPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(realWorkOrderBody(idempotencyKey, targetPath));
    const req = request(
      { host: "127.0.0.1", port, path: "/command", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), ...headers } },
      (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk.toString(); });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

async function run(): Promise<void> {
  console.log("=== transport/owner-command-http/tests/auth-gate.test.ts ===");
  process.env.OWNER_COMMAND_HTTP_SHARED_SECRET = SECRET;

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not report a bound port after listen()");
  const port = address.port;

  const createdPaths: string[] = [];
  try {
    {
      const key = `auth-gate-no-token-${Date.now()}`;
      const target = `tests/__sandbox__/auth-gate-probe-no-token-${Date.now()}.txt`;
      const { status } = await post(port, {}, key, target);
      assert(status === 401, `expected 401 with no Authorization header, got ${status}`);
      assert(!envelopeWasIngested(key), "no token must never reach the real Owner Command pipeline");
      assert(!existsSync(join(process.cwd(), target)), "no token must never cause a real file write");
      console.log("PASS: no Authorization header -> 401, nothing downstream ran");
    }

    {
      const key = `auth-gate-wrong-token-${Date.now()}`;
      const target = `tests/__sandbox__/auth-gate-probe-wrong-token-${Date.now()}.txt`;
      const { status } = await post(port, { Authorization: "Bearer wrong-value-entirely" }, key, target);
      assert(status === 401, `expected 401 with a wrong token, got ${status}`);
      assert(!envelopeWasIngested(key), "a wrong token must never reach the real Owner Command pipeline");
      assert(!existsSync(join(process.cwd(), target)), "a wrong token must never cause a real file write");
      console.log("PASS: wrong token -> 401, nothing downstream ran");
    }

    {
      const key = `auth-gate-correct-token-${Date.now()}`;
      const target = `tests/__sandbox__/auth-gate-probe-correct-token-${Date.now()}.txt`;
      createdPaths.push(target);
      const { status, body } = await post(port, { Authorization: `Bearer ${SECRET}` }, key, target);
      assert(status === 200, `expected 200 with the correct token, got ${status}: ${body}`);
      const parsed = JSON.parse(body) as { lifecycle?: { status?: string } };
      assert(parsed.lifecycle?.status === "completed", `expected the real pipeline to actually run, got ${JSON.stringify(parsed.lifecycle)}`);
      assert(envelopeWasIngested(key), "the correct token must reach the real Owner Command pipeline");
      console.log("PASS: correct token -> 200, real pipeline ran");
    }

    console.log("=== ALL auth-gate.test.ts CASES PASSED ===");
  } finally {
    for (const p of createdPaths) {
      const abs = join(process.cwd(), p);
      if (existsSync(abs)) rmSync(abs);
    }
    delete process.env.OWNER_COMMAND_HTTP_SHARED_SECRET;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
