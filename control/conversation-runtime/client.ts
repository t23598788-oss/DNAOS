/**
 * หน้าที่: the PARENT-side client for `./main.ts`'s standalone process
 * (Owner UNLOCK 2026-09-06, PHASE 2C; spawn target fixed to prebuilt plain
 * JS by Owner UNLOCK REMOVE_TSX_FROM_PRODUCTION_CONVERSATION_RUNTIME).
 *
 * CONVERSATION_RUNTIME_LIVE_IO_V1:
 * - Validate the prebuilt entrypoint before spawn (missing/empty → precise error).
 * - Wait for a ready handshake before sending requests.
 * - Treat exit after a delivered response as non-failure for that request
 *   (waiter already removed from pending).
 * - Treat exit before ready / before response / non-zero / timeout as precise failures.
 * - Capture stderr ring for actionable 503 detail.
 *
 * Architecture: one persistent long-running child per parent process, not
 * one-shot-per-request. Requests are multiplexed by `request_id`.
 *
 * Dependency ที่อนุญาต: node:child_process, node:fs, node:path, node:readline,
 * ./protocol.ts.
 */

declare const require: any;
declare const __dirname: string;
declare const process: { execPath: string };

import type {
  ConversationReadyMessage,
  ConversationRequest,
  ConversationResult,
  ConversationStageMessage,
} from "./protocol";

const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const readline = require("node:readline");

/** Fixed, prebuilt, plain-CommonJS — never `.ts`, never routed through tsx. */
const RUNTIME_ENTRYPOINT: string = path.join(__dirname, "dist", "control", "conversation-runtime", "main.js");

const STDERR_RING_MAX = 8_000;
const DEFAULT_READY_TIMEOUT_MS = 30_000;

export interface ConversationRuntimeHandle {
  readonly pid: number;
  isAlive(): boolean;
  isReady(): boolean;
  request(req: ConversationRequest, timeoutMs?: number, onStage?: (event: ConversationStageMessage["event"]) => void): Promise<ConversationResult>;
  stop(): void;
}

export type ConversationRuntimeSpawnOptions = {
  /** Test-only override. Production always uses RUNTIME_ENTRYPOINT. */
  readonly entrypoint?: string;
  readonly readyTimeoutMs?: number;
};

function assertEntrypointUsable(entrypoint: string): void {
  if (!fs.existsSync(entrypoint)) {
    throw new Error(`CONVERSATION_RUNTIME_BUILD_MISSING: entrypoint not found at ${entrypoint}`);
  }
  const st = fs.statSync(entrypoint);
  if (!st.isFile() || st.size <= 0) {
    throw new Error(`CONVERSATION_RUNTIME_BUILD_EMPTY: entrypoint at ${entrypoint} is empty or not a file (size=${st.size})`);
  }
  // Force materialization of cloud-evicted files before spawn — empty reads
  // previously produced a silent code=0 child with no stdin listener.
  const bytes = fs.readFileSync(entrypoint);
  if (!bytes || bytes.length === 0) {
    throw new Error(`CONVERSATION_RUNTIME_BUILD_UNREADABLE: entrypoint at ${entrypoint} read as empty after stat reported size=${st.size}`);
  }
}

function appendRing(ring: { text: string }, chunk: string): void {
  ring.text = (ring.text + chunk).slice(-STDERR_RING_MAX);
}

/**
 * Spawns exactly one child process running the prebuilt conversation runtime.
 * FAIL CLOSED once the child exits or errors: every still-pending request is
 * rejected immediately. Requests that already received a ConversationResult
 * are unaffected (already removed from pending) — exit code=0 after a valid
 * response is therefore success for that request.
 */
export function spawnConversationRuntime(options: ConversationRuntimeSpawnOptions = {}): ConversationRuntimeHandle {
  const entrypoint = options.entrypoint ?? RUNTIME_ENTRYPOINT;
  const readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  assertEntrypointUsable(entrypoint);

  const child = spawn(process.execPath, [entrypoint], { stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map<string, {
    resolve: (r: ConversationResult) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    onStage?: (event: ConversationStageMessage["event"]) => void;
  }>();
  let alive = true;
  let ready = false;
  let exitCode: number | null = null;
  let exitSignal: string | null = null;
  const stderrRing = { text: "" };
  const readyWaiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];

  function stderrSuffix(): string {
    const t = stderrRing.text.trim();
    return t.length > 0 ? ` stderr_tail=${JSON.stringify(t.slice(-1_500))}` : "";
  }

  function rejectReadyWaiters(reason: string): void {
    while (readyWaiters.length > 0) {
      const w = readyWaiters.shift()!;
      w.reject(new Error(reason));
    }
  }

  function rejectAllPending(reason: string): void {
    alive = false;
    for (const [requestId, waiter] of pending) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`${reason} (request_id=${requestId})`));
    }
    pending.clear();
  }

  function markReady(): void {
    if (ready) return;
    ready = true;
    while (readyWaiters.length > 0) {
      const w = readyWaiters.shift()!;
      w.resolve();
    }
  }

  function waitUntilReady(timeoutMs: number): Promise<void> {
    if (ready) return Promise.resolve();
    if (!alive) {
      return Promise.reject(new Error(
        `CONVERSATION_RUNTIME_EXITED_BEFORE_READY: process exited (code=${exitCode}, signal=${exitSignal}) before ready handshake${stderrSuffix()}`,
      ));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = readyWaiters.findIndex((w) => w.resolve === onResolve);
        if (idx >= 0) readyWaiters.splice(idx, 1);
        reject(new Error(`CONVERSATION_RUNTIME_READY_TIMEOUT: no ready handshake within ${timeoutMs}ms${stderrSuffix()}`));
      }, timeoutMs);
      const onResolve = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const onReject = (e: Error): void => {
        clearTimeout(timer);
        reject(e);
      };
      readyWaiters.push({ resolve: onResolve, reject: onReject });
    });
  }

  child.stderr?.on("data", (chunk: Buffer | string) => {
    appendRing(stderrRing, typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  });

  child.on("exit", (code: number | null, signal: string | null) => {
    exitCode = code;
    exitSignal = signal;
    alive = false;
    const precise = ready
      ? `CONVERSATION_RUNTIME_EXITED_BEFORE_RESPONSE: process exited (code=${code}, signal=${signal}) while request(s) still pending${stderrSuffix()}`
      : `CONVERSATION_RUNTIME_EXITED_BEFORE_READY: process exited (code=${code}, signal=${signal}) before ready handshake${stderrSuffix()}`;
    rejectReadyWaiters(precise);
    rejectAllPending(precise);
  });
  child.on("error", (err: Error) => {
    alive = false;
    const precise = `CONVERSATION_RUNTIME_SPAWN_ERROR: ${err.message}${stderrSuffix()}`;
    rejectReadyWaiters(precise);
    rejectAllPending(precise);
  });

  const rl = readline.createInterface({ input: child.stdout, terminal: false });
  rl.on("line", (line: string) => {
    let parsed: ConversationResult | ConversationStageMessage | ConversationReadyMessage;
    try {
      parsed = JSON.parse(line) as ConversationResult | ConversationStageMessage | ConversationReadyMessage;
    } catch {
      return;
    }
    if ("message_type" in parsed && parsed.message_type === "ready") {
      markReady();
      return;
    }
    if (!("request_id" in parsed) || typeof (parsed as { request_id?: unknown }).request_id !== "string") return;
    const waiter = pending.get((parsed as { request_id: string }).request_id);
    if (!waiter) return;
    if ("message_type" in parsed && parsed.message_type === "stage") {
      waiter.onStage?.((parsed as ConversationStageMessage).event);
      return;
    }
    clearTimeout(waiter.timer);
    pending.delete((parsed as ConversationResult).request_id);
    waiter.resolve(parsed as ConversationResult);
  });

  return {
    pid: child.pid as number,
    isAlive(): boolean {
      return alive;
    },
    isReady(): boolean {
      return ready;
    },
    async request(req: ConversationRequest, timeoutMs = 30_000, onStage?: (event: ConversationStageMessage["event"]) => void): Promise<ConversationResult> {
      if (!alive) {
        return Promise.reject(new Error(
          `CONVERSATION_RUNTIME_NOT_ALIVE: process is not alive (request_id=${req.request_id}, last_exit_code=${exitCode}, last_exit_signal=${exitSignal})${stderrSuffix()}`,
        ));
      }
      await waitUntilReady(Math.min(timeoutMs, readyTimeoutMs));
      if (!alive) {
        return Promise.reject(new Error(
          `CONVERSATION_RUNTIME_EXITED_BEFORE_RESPONSE: process died after ready before request write (request_id=${req.request_id})${stderrSuffix()}`,
        ));
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(req.request_id);
          reject(new Error(`CONVERSATION_RUNTIME_TIMEOUT: did not respond within ${timeoutMs}ms for request_id=${req.request_id}${stderrSuffix()}`));
        }, timeoutMs);
        pending.set(req.request_id, { resolve, reject, timer, onStage });
        try {
          child.stdin.write(`${JSON.stringify(req)}\n`);
        } catch (error) {
          clearTimeout(timer);
          pending.delete(req.request_id);
          reject(new Error(
            `CONVERSATION_RUNTIME_STDIN_ERROR: ${error instanceof Error ? error.message : String(error)} (request_id=${req.request_id})${stderrSuffix()}`,
          ));
        }
      });
    },
    stop(): void {
      child.kill();
    },
  };
}

export function conversationRuntimeEntrypointPath(): string {
  return RUNTIME_ENTRYPOINT;
}
