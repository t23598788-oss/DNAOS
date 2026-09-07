/**
 * หน้าที่: the PARENT-side client for `./main.ts`'s standalone process
 * (Owner UNLOCK 2026-09-06, PHASE 2C; spawn target fixed to prebuilt plain
 * JS by Owner UNLOCK REMOVE_TSX_FROM_PRODUCTION_CONVERSATION_RUNTIME).
 * Lives here rather than inside `transport/` because this capability
 * folder owns both ends of its own process boundary; a transport that
 * wants to talk to the conversation runtime imports only `./contract.ts`.
 *
 * `child_process.spawn` here is PARENT-side authority to launch the
 * conversation child with a fixed executable/argv — it does not grant the
 * conversation process itself any process-launch authority (see
 * `./main.ts`'s own header: it never imports `node:child_process`).
 *
 * PLAIN NODE, NOT tsx (root-caused 2026-09-06): the conversation child used
 * to be launched as `tsx/cli` interpreting `./main.ts` directly. Under real
 * production load — several other tsx-loaded processes already running on
 * the same machine — a freshly spawned tsx child hung indefinitely inside
 * tsx's own esbuild transform-service handshake, before `./main.ts`'s own
 * code (not even its module-level top) ever ran; proven via `sample` on the
 * hung PID (main thread parked on `uv_sem_wait`, tsx's loader worker thread
 * idle). tsx/esbuild are now entirely absent from this process's runtime
 * dependency: `RUNTIME_EXECUTABLE` is the real Node binary
 * (`process.execPath`, not a caller-supplied path) and `RUNTIME_ENTRYPOINT`
 * is the prebuilt, plain-CommonJS output of `./tsconfig.build.json`
 * (`./dist/control/conversation-runtime/main.js` — see that file's header
 * for the build command). Rebuild with
 * `npx tsc -p control/conversation-runtime/tsconfig.build.json` after any
 * source change in this capability's dependency closure; nothing here
 * builds on the fly.
 *
 * Transport is newline-delimited JSON over stdin/stdout, matching
 * `./main.ts`'s framing exactly (`ConversationRequest` in,
 * `ConversationResult` out, correlated by `request_id`).
 *
 * Dependency ที่อนุญาต: node:child_process, node:path, node:readline,
 * ./protocol.ts.
 * สิ่งที่ห้ามแตะ:
 * - never pass a caller-controlled executable path or extra argv into
 *   `spawn` here — the entrypoint script path and interpreter are fixed at
 *   the two constants below.
 * - never point `RUNTIME_ENTRYPOINT` back at a `tsx`/`.ts` path — this is
 *   the one thing this UNLOCK exists to prevent from regressing.
 */

declare const require: any;
declare const __dirname: string;
declare const process: { execPath: string };

import type { ConversationRequest, ConversationResult, ConversationStageMessage } from "./protocol";

const path = require("node:path");
const { spawn } = require("node:child_process");
const readline = require("node:readline");

/** Fixed, prebuilt, plain-CommonJS — never `.ts`, never routed through tsx. */
const RUNTIME_ENTRYPOINT: string = path.join(__dirname, "dist", "control", "conversation-runtime", "main.js");

export interface ConversationRuntimeHandle {
  readonly pid: number;
  isAlive(): boolean;
  request(req: ConversationRequest, timeoutMs?: number, onStage?: (event: ConversationStageMessage["event"]) => void): Promise<ConversationResult>;
  stop(): void;
}

/**
 * Spawns exactly one child process running `./main.ts`, fixed executable
 * (`tsx`, resolved via `require.resolve` — never a caller-supplied path)
 * and fixed single argv element (`RUNTIME_ENTRYPOINT`). Requests are
 * correlated by `request_id`; nothing here assumes in-order delivery.
 *
 * FAIL CLOSED (Owner UNLOCK 2026-09-06,
 * FLIP_PRODUCTION_OWNER_CONVERSATION_TO_ISOLATED_RUNTIME): once the child
 * exits or errors, every pending request is rejected immediately (never
 * left to time out) and `isAlive()` turns false — the caller is expected
 * to treat that as "conversation runtime unavailable" and deny, never to
 * quietly try `translateOwnerMessage`/`resolveOwnerCommandSemantics`
 * in-process instead.
 */
export function spawnConversationRuntime(): ConversationRuntimeHandle {
  const child = spawn(process.execPath, [RUNTIME_ENTRYPOINT], { stdio: ["pipe", "pipe", "inherit"] });
  const pending = new Map<string, { resolve: (r: ConversationResult) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout>; onStage?: (event: ConversationStageMessage["event"]) => void }>();
  let alive = true;

  function rejectAllPending(reason: string): void {
    alive = false;
    for (const [requestId, waiter] of pending) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`${reason} (request_id=${requestId})`));
    }
    pending.clear();
  }

  child.on("exit", (code: number | null, signal: string | null) => rejectAllPending(`conversation runtime process exited (code=${code}, signal=${signal})`));
  child.on("error", (err: Error) => rejectAllPending(`conversation runtime process error: ${err.message}`));

  const rl = readline.createInterface({ input: child.stdout, terminal: false });
  rl.on("line", (line: string) => {
    let result: ConversationResult | ConversationStageMessage;
    try {
      result = JSON.parse(line) as ConversationResult;
    } catch {
      return;
    }
    const waiter = pending.get(result.request_id);
    if (!waiter) return;
    if ("message_type" in result && result.message_type === "stage") {
      waiter.onStage?.((result as unknown as ConversationStageMessage).event);
      return;
    }
    clearTimeout(waiter.timer);
    pending.delete(result.request_id);
    waiter.resolve(result);
  });

  return {
    pid: child.pid as number,
    isAlive(): boolean {
      return alive;
    },
    request(req: ConversationRequest, timeoutMs = 30_000, onStage?: (event: ConversationStageMessage["event"]) => void): Promise<ConversationResult> {
      if (!alive) return Promise.reject(new Error(`conversation runtime process is not alive (request_id=${req.request_id})`));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(req.request_id);
          reject(new Error(`conversation runtime did not respond within ${timeoutMs}ms for request_id=${req.request_id}`));
        }, timeoutMs);
        pending.set(req.request_id, { resolve, reject, timer, onStage });
        child.stdin.write(`${JSON.stringify(req)}\n`);
      });
    },
    stop(): void {
      child.kill();
    },
  };
}
