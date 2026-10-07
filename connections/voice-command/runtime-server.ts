/**
 * หน้าที่: the ONE persistent process that owns `./dispatcher.ts`'s
 * `state` and `../os-ui/voice-queue.mjs`'s `activeChild` for their
 * entire real lifecycle. Fixes the confirmed process-boundary defect
 * (2026-08-21 investigation): `whisper-listener.mjs` was spawning a
 * brand-new `tsx dispatch-cli.ts <transcript>` process per transcript —
 * since both `state` and `activeChild` are in-memory module variables,
 * every new process saw them freshly reset to IDLE/null, so
 * `state_before` was always "IDLE" and `cancelActiveSpeech()` could never
 * reach the real `say` child (it lived in whichever earlier process
 * actually called `speakQueued()`). This file is the single, persistent
 * home for both — every transcript, from any STT backend, must be routed
 * through THIS one process's `handleTranscript`/`cancelActiveSpeech`, via
 * a local Unix domain socket, never a fresh subprocess per transcript.
 *
 * Single source of truth: this process is the ONLY place `state`/
 * `activeChild` exist — clients (`./whisper-listener.mjs`) hold no
 * duplicate state of their own, only a socket connection.
 *
 * Restart semantics: state is intentionally in-memory only (no
 * persistence, no transcript queue/replay) — a fresh process always
 * starts at IDLE, matching the existing `dispatcher.ts` contract exactly.
 *
 * Input: newline-delimited JSON over the Unix socket at `SOCKET_PATH`:
 *   {"type":"STOP_FAST","transcript":string} — calls the real
 *     `cancelActiveSpeech()` synchronously first, replies `{cancelled}`
 *     immediately, THEN (not awaited by the reply) runs the transcript
 *     through the real `handleTranscript` for correct state
 *     transition/audit — same two-tier shape `./fast-stop-cli.mjs` used
 *     when it was a subprocess, just without the ~400ms process spawn.
 *   {"type":"DISPATCH","transcript":string} — runs `handleTranscript`,
 *     replies with the real `HandleTranscriptResult`.
 *   {"type":"STATE"} — replies `{state}` (diagnostic only).
 * Output: JSON replies as above; `RUNTIME_STARTED`/`RUNTIME_STOPPED` etc.
 * to stderr and `runtime-server.log`.
 * Dependency ที่อนุญาต: ./contract.ts (`handleTranscript`,
 * `getVoiceCommandState`), ../os-ui/voice-queue.mjs
 * (`cancelActiveSpeech`, dynamic import — same reason as
 * ./dispatcher.ts's own `voiceQueue()`).
 * สิ่งที่ห้ามแตะ: ./dispatcher.ts, ./intent-resolver.ts, ./audit.ts,
 * ./types.ts, ../os-ui/* — this file only calls their existing, unchanged
 * entry points, in-process, exactly once per real event.
 */
import { createServer } from "node:net";
import { existsSync, unlinkSync, writeFileSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { handleTranscript, getVoiceCommandState } from "./contract";

const REPO_ROOT = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE";
const DATA_DIR = join(REPO_ROOT, "connections/voice-command/data");
const SOCKET_PATH = join(DATA_DIR, "runtime.sock");
const LOCK_PATH = join(DATA_DIR, "runtime.lock");
const LOG_PATH = join(REPO_ROOT, "connections/voice-command/runtime-server.log");

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stderr.write(line);
  try { appendFileSync(LOG_PATH, line); } catch { /* logging must never crash the runtime */ }
}

async function voiceQueue() {
  return import("../os-ui/voice-queue.mjs");
}

function isPidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function ensureSingleInstance(): void {
  mkdirSync(DATA_DIR, { recursive: true });
  if (existsSync(LOCK_PATH)) {
    const prevPid = Number(readFileSync(LOCK_PATH, "utf-8").trim());
    if (Number.isFinite(prevPid) && isPidAlive(prevPid)) {
      log(`RUNTIME_ALREADY_RUNNING existing_pid=${prevPid}`);
      process.stderr.write(`RUNTIME_ALREADY_RUNNING existing_pid=${prevPid}\n`);
      process.exit(1);
    }
    log(`STALE_LOCK_FOUND stale_pid=${prevPid} — previous runtime process is dead, reclaiming lock`);
  }
  writeFileSync(LOCK_PATH, String(process.pid));
}

ensureSingleInstance();
if (existsSync(SOCKET_PATH)) {
  try { unlinkSync(SOCKET_PATH); } catch { /* stale socket file from an unclean previous shutdown */ }
}

const server = createServer((conn) => {
  let buf = "";
  conn.on("data", (chunk) => {
    buf += chunk.toString("utf-8");
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      void handleLine(conn, line);
    }
  });
  conn.on("error", (err) => log(`CONN_ERROR error=${err.message}`));
});

async function handleLine(conn: import("node:net").Socket, line: string): Promise<void> {
  let msg: { type?: string; transcript?: string };
  try {
    msg = JSON.parse(line);
  } catch {
    conn.write(`${JSON.stringify({ error: "BAD_JSON" })}\n`);
    return;
  }

  if (msg.type === "STOP_FAST") {
    const transcript = String(msg.transcript ?? "");
    const receivedAt = Date.now();
    const cancelled = (await voiceQueue()).cancelActiveSpeech();
    const respondedAt = Date.now();
    log(`STOP_FAST transcript=${transcript} cancelled=${cancelled} in_process_latency_ms=${respondedAt - receivedAt}`);
    conn.write(`${JSON.stringify({ cancelled })}\n`);
    // Full state transition + audit, same as any other transcript — fire-and-forget, never blocks the reply above.
    handleTranscript(transcript).catch((err) => log(`STOP_FAST_FOLLOWUP_ERROR error=${String(err)}`));
    return;
  }

  if (msg.type === "DISPATCH") {
    const transcript = String(msg.transcript ?? "");
    const result = await handleTranscript(transcript);
    log(`DISPATCH transcript=${transcript} result=${JSON.stringify(result)}`);
    conn.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (msg.type === "STATE") {
    conn.write(`${JSON.stringify({ state: getVoiceCommandState() })}\n`);
    return;
  }

  conn.write(`${JSON.stringify({ error: "UNKNOWN_TYPE" })}\n`);
}

server.on("error", (err) => {
  log(`SERVER_ERROR error=${err.message}`);
  process.exit(1);
});

server.listen(SOCKET_PATH, () => {
  log(`RUNTIME_STARTED pid=${process.pid} socket=${SOCKET_PATH} state=${getVoiceCommandState()}`);
});

function shutdown(signal: string): void {
  log(`RUNTIME_STOPPING signal=${signal} state_at_stop=${getVoiceCommandState()}`);
  try { server.close(); } catch { /* already closed */ }
  try { unlinkSync(SOCKET_PATH); } catch { /* already removed */ }
  try { unlinkSync(LOCK_PATH); } catch { /* already removed */ }
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
