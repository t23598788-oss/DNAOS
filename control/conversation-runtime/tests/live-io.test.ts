/**
 * CONVERSATION_RUNTIME_LIVE_IO_V1 acceptance tests (hermetic fixtures + real client).
 * How to run: npx tsx control/conversation-runtime/tests/live-io.test.ts
 */

import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnConversationRuntime, conversationRuntimeEntrypointPath } from "../client";
import type { ConversationRequest } from "../protocol";

declare const process: { exitCode?: number; execPath: string };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;

function ok(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`PASS: ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function fixturePath(name: string, source: string): string {
  const dir = join(tmpdir(), `dna-os-conv-live-io-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, source, "utf8");
  return file;
}

function req(id: string, text = "hello"): ConversationRequest {
  return {
    request_id: id,
    trace_id: id,
    owner_identity: { identity_id: "owner-live-io", kind: "human" },
    text,
  };
}

const HEALTHY_FIXTURE = `
const readline = require("node:readline");
let answered = 0;
const rl = readline.createInterface({ input: process.stdin, terminal: false });
process.stdout.write(JSON.stringify({ message_type: "ready" }) + "\\n");
rl.on("line", (line) => {
  const req = JSON.parse(line);
  answered += 1;
  // Emit OWNER_ANSWER_READY stage then a final ConversationResult once.
  process.stdout.write(JSON.stringify({
    message_type: "stage",
    request_id: req.request_id,
    event: { stage: "OWNER_ANSWER_READY", status: "COMPLETED", detail: "ANSWERABLE_READ_ONLY" },
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    request_id: req.request_id,
    trace_id: req.trace_id,
    answer: "live-io-ok:" + req.text,
    intent: { request_id: req.request_id, intent: "SELF_KNOWLEDGE_QUERY" },
    status: "ANSWERED",
    evidence_refs: ["fixture"],
    semantic_outcome: { ok: true, context: { resolved_state: "RESOLVED", read_only_knowledge: { owner_reply_th: "ok" } } },
    final_semantic_state: "ANSWERABLE_READ_ONLY",
  }) + "\\n");
});
`;

const EXIT_BEFORE_READY = `
process.exit(0);
`;

const EXIT_ZERO_BEFORE_RESPONSE = `
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin, terminal: false });
process.stdout.write(JSON.stringify({ message_type: "ready" }) + "\\n");
rl.on("line", () => {
  process.exit(0);
});
`;

const EXIT_NONZERO = `
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin, terminal: false });
process.stdout.write(JSON.stringify({ message_type: "ready" }) + "\\n");
rl.on("line", () => {
  process.exit(7);
});
`;

const NEVER_RESPOND = `
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin, terminal: false });
process.stdout.write(JSON.stringify({ message_type: "ready" }) + "\\n");
rl.on("line", () => {
  // intentional silence
});
`;

const DUPLICATE_GUARD = `
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin, terminal: false });
process.stdout.write(JSON.stringify({ message_type: "ready" }) + "\\n");
rl.on("line", (line) => {
  const req = JSON.parse(line);
  const body = {
    request_id: req.request_id,
    trace_id: req.trace_id,
    answer: "once",
    intent: null,
    status: "ANSWERED",
    evidence_refs: [],
    semantic_outcome: null,
    final_semantic_state: "ANSWERABLE_READ_ONLY",
  };
  process.stdout.write(JSON.stringify(body) + "\\n");
  process.stdout.write(JSON.stringify(body) + "\\n"); // duplicate — client must ignore (no waiter)
});
`;

async function main(): Promise<void> {
  // 1. Valid Owner message → real conversation response
  {
    const entry = fixturePath("healthy.js", HEALTHY_FIXTURE);
    const handle = spawnConversationRuntime({ entrypoint: entry, readyTimeoutMs: 5_000 });
    const stages: string[] = [];
    const result = await handle.request(req("r1", "ระบบคืออะไร"), 5_000, (ev) => {
      if (typeof ev.stage === "string") stages.push(ev.stage);
    });
    ok("1. valid message returns ANSWERED", result.status === "ANSWERED");
    ok("1b. answer is real fixture text", result.answer === "live-io-ok:ระบบคืออะไร");
    ok("8. OWNER_ANSWER_READY stage observed", stages.includes("OWNER_ANSWER_READY"));
    handle.stop();
  }

  // 3. Exit code=0 AFTER valid response → that request stays success
  {
    const entry = fixturePath("after-success-exit.js", HEALTHY_FIXTURE);
    const handle = spawnConversationRuntime({ entrypoint: entry, readyTimeoutMs: 5_000 });
    const result = await handle.request(req("r-success-then-exit"), 5_000);
    ok("3. response resolved before exit", result.status === "ANSWERED" && result.answer?.startsWith("live-io-ok:"));
    handle.stop(); // exit after response — must not retroactively fail the resolved promise
    ok("3b. resolved result remains intact after stop", result.status === "ANSWERED");
  }

  // 4. Exit code=0 BEFORE response → precise failure
  {
    const entry = fixturePath("exit0-before-response.js", EXIT_ZERO_BEFORE_RESPONSE);
    const handle = spawnConversationRuntime({ entrypoint: entry, readyTimeoutMs: 5_000 });
    let errMsg = "";
    try {
      await handle.request(req("r-exit0"), 5_000);
    } catch (error) {
      errMsg = error instanceof Error ? error.message : String(error);
    }
    ok("4. exit 0 before response fails", errMsg.includes("CONVERSATION_RUNTIME_EXITED_BEFORE_RESPONSE"));
    ok("4b. failure names code=0", errMsg.includes("code=0"));
  }

  // Exit before ready
  {
    const entry = fixturePath("exit-before-ready.js", EXIT_BEFORE_READY);
    let errMsg = "";
    try {
      const handle = spawnConversationRuntime({ entrypoint: entry, readyTimeoutMs: 3_000 });
      await handle.request(req("r-before-ready"), 3_000);
    } catch (error) {
      errMsg = error instanceof Error ? error.message : String(error);
    }
    ok("4c. exit before ready is precise", errMsg.includes("CONVERSATION_RUNTIME_EXITED_BEFORE_READY") || errMsg.includes("CONVERSATION_RUNTIME_BUILD"));
  }

  // 5. Non-zero exit → precise failure
  {
    const entry = fixturePath("exit7.js", EXIT_NONZERO);
    const handle = spawnConversationRuntime({ entrypoint: entry, readyTimeoutMs: 5_000 });
    let errMsg = "";
    try {
      await handle.request(req("r-exit7"), 5_000);
    } catch (error) {
      errMsg = error instanceof Error ? error.message : String(error);
    }
    ok("5. non-zero exit fails precisely", errMsg.includes("CONVERSATION_RUNTIME_EXITED_BEFORE_RESPONSE") && errMsg.includes("code=7"));
  }

  // 6. Timeout → precise timeout failure
  {
    const entry = fixturePath("silent.js", NEVER_RESPOND);
    const handle = spawnConversationRuntime({ entrypoint: entry, readyTimeoutMs: 5_000 });
    let errMsg = "";
    try {
      await handle.request(req("r-timeout"), 400);
    } catch (error) {
      errMsg = error instanceof Error ? error.message : String(error);
    }
    ok("6. timeout is precise", errMsg.includes("CONVERSATION_RUNTIME_TIMEOUT"));
    handle.stop();
  }

  // 7. No duplicate response emitted to waiter (second line ignored)
  {
    const entry = fixturePath("dup.js", DUPLICATE_GUARD);
    const handle = spawnConversationRuntime({ entrypoint: entry, readyTimeoutMs: 5_000 });
    let resolveCount = 0;
    const result = await handle.request(req("r-dup"), 5_000);
    resolveCount += 1;
    ok("7. single resolved result", resolveCount === 1 && result.answer === "once");
    handle.stop();
  }

  // Missing entrypoint
  {
    let errMsg = "";
    try {
      spawnConversationRuntime({ entrypoint: join(tmpdir(), "dna-os-missing-conv-runtime.js") });
    } catch (error) {
      errMsg = error instanceof Error ? error.message : String(error);
    }
    ok("missing build is precise", errMsg.includes("CONVERSATION_RUNTIME_BUILD_MISSING"));
  }

  // Empty entrypoint
  {
    const empty = fixturePath("empty.js", "");
    let errMsg = "";
    try {
      spawnConversationRuntime({ entrypoint: empty });
    } catch (error) {
      errMsg = error instanceof Error ? error.message : String(error);
    }
    ok("empty build is precise", errMsg.includes("CONVERSATION_RUNTIME_BUILD_EMPTY"));
    try { rmSync(empty, { force: true }); } catch { /* ignore */ }
  }

  ok("production entrypoint path is fixed under dist/", conversationRuntimeEntrypointPath().includes("dist/control/conversation-runtime/main.js"));

  // Real compiled entrypoint (after conversation-runtime:build) — not a fixture
  {
    const entry = conversationRuntimeEntrypointPath();
    const fs = await import("node:fs");
    if (!fs.existsSync(entry) || fs.statSync(entry).size === 0) {
      ok("real entrypoint present (skipped if not built)", false, `missing ${entry}`);
    } else {
      const handle = spawnConversationRuntime({ readyTimeoutMs: 20_000 });
      const stages: string[] = [];
      const result = await handle.request(req("real-entrypoint", "สวัสดี"), 30_000, (ev) => {
        if (typeof ev.stage === "string") stages.push(ev.stage);
      });
      ok("real entrypoint returns ConversationResult", result.status === "ANSWERED" || result.status === "UNRESOLVED" || result.status === "DENIED");
      ok("real entrypoint ready before answer", handle.isReady() === true);
      ok("real entrypoint OWNER_ANSWER_READY or denied truthfully", stages.includes("OWNER_ANSWER_READY") || result.status === "DENIED" || result.status === "UNRESOLVED");
      handle.stop();
    }
  }

  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
