/**
 * หน้าที่: the real test for ../server.ts — opens a raw HTTP connection to
 * the real `GET /events` SSE endpoint of a really-started server (real
 * `http` server, real TCP socket, real port — never mocked), asserts the
 * initial snapshot event arrives, then mutates the real CircuitState and
 * asserts a second `data:` event streams to the already-open connection.
 * Matches this repo's `npx tsx <file>` convention.
 *
 * How to run: npx tsx dna-os-circuit/runtime/tests/server.test.ts
 */

import { CircuitState } from "../circuit-state";
import { startCircuitServer } from "../server";

declare const require: (id: string) => unknown;
declare const process: { exitCode?: number; exit(code?: number): void };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

interface HttpModule {
  get(
    url: string,
    callback: (res: { on(event: "data", cb: (chunk: { toString(): string }) => void): void; on(event: "end", cb: () => void): void }) => void,
  ): { on(event: "error", cb: (err: Error) => void): void; destroy(): void };
}
const http = require("http") as HttpModule;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(): Promise<void> {
  console.log("=== dna-os-circuit/runtime/server.test.ts ===");

  const state = new CircuitState();
  const port = 8791;
  const server = startCircuitServer(state, port);

  try {
    await sleep(200); // real server needs a beat to bind the real port

    const events: string[] = [];
    let buffer = "";
    const req = http.get(`http://localhost:${port}/events`, (res) => {
      res.on("data", (chunk: { toString(): string }) => {
        buffer += chunk.toString();
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          if (part.startsWith("data: ")) events.push(part.slice("data: ".length));
        }
      });
    });
    req.on("error", (err: Error) => {
      throw new Error(`real SSE connection failed: ${err.message}`);
    });

    await sleep(300);
    assert(events.length >= 1, `expected at least the initial snapshot event, got ${events.length}`);
    const firstPayload = JSON.parse(events[0]);
    assert(firstPayload.type === "snapshot", `expected first SSE event type "snapshot", got ${firstPayload.type}`);
    assert(Array.isArray(firstPayload.snapshot.nodes) && firstPayload.snapshot.nodes.length > 0, "expected the initial snapshot to include real nodes from circuit.json");
    console.log("PASS: real SSE connection receives the initial snapshot event");

    // Now mutate real state and confirm the already-open connection receives the diff.
    const eventsBefore = events.length;
    state.updateNode("PERMISSION", "RUNNING", "server-test trigger");
    await sleep(300);
    assert(events.length > eventsBefore, `expected a new SSE event after a real state mutation, event count stayed at ${events.length}`);
    const lastPayload = JSON.parse(events[events.length - 1]);
    assert(lastPayload.type === "change" && lastPayload.event.id === "PERMISSION" && lastPayload.event.status === "RUNNING", `expected the streamed change event to describe the real mutation, got ${JSON.stringify(lastPayload)}`);
    console.log("PASS: a real circuit-state mutation streams live to the connected SSE client");

    req.destroy();
  } finally {
    server.close();
  }

  console.log("=== ALL server.test.ts CASES PASSED ===");
}

run()
  .catch((error) => {
    console.error("FAIL:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => {
    // Node keeps the event loop alive if any server/socket handle lingers; force a clean exit once assertions are done.
    setTimeout(() => process.exit(process.exitCode ?? 0), 50);
  });
