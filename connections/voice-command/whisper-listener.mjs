#!/usr/bin/env node
/**
 * หน้าที่: ALTERNATE STT backend for benchmarking against the existing,
 * VERIFIED Apple Speech app-host (../app-host/) — never replaces it,
 * never deletes it. Reuses ONLY real, already-installed components:
 * `/opt/homebrew/bin/whisper-stream` (real-time mic capture + Whisper
 * transcription, whisper.cpp 1.9.1) with the real, already-downloaded
 * `ggml-base.bin` model — no new model download, no new engine.
 *
 * MIC -> whisper-stream -> transcript segment -> (STOP: immediate,
 * exact/deterministic match on EVERY raw update, no debounce, no wait)
 * -> ../runtime-server.ts over a Unix socket (the ONE persistent process
 * that owns real dispatcher `state` + `voice-queue.mjs`'s `activeChild`
 * for their whole lifecycle — see ../runtime-server.ts's header for the
 * 2026-08-21 process-boundary defect this replaces: this file used to
 * spawn a brand-new `tsx dispatch-cli.ts`/`fast-stop-cli.mjs` process per
 * transcript, so `state`/`activeChild` were reset to
 * IDLE/null every single time and STOP could never reach the real `say`
 * child). This file now holds NO dispatcher/voice-queue state of its
 * own — only a socket connection to ../runtime-server.ts.
 *
 * Self-audio-suppression: reuses the SAME active-speech.json file
 * ../os-ui/voice-queue.mjs already writes/clears — never a new
 * suppression mechanism.
 *
 * Real architectural discovery (this round): `whisper-stream` has no
 * `--vad-model` option — only `whisper-cli` (file-based, not streaming)
 * supports the standalone Silero VAD model
 * (ggml-silero-v5.1.2.bin). whisper-stream uses its own built-in
 * energy-threshold VAD (`-vth`) instead. This file uses whisper-stream
 * as-is (the real, already-proven setup per ../../.. /voice-loop-tmp/
 * heard.txt) rather than silently deviating — reported honestly, not
 * worked around.
 *
 * ห้ามแก้: ../dispatcher.ts, ../intent-resolver.ts, ../../os-ui/*,
 * screen-reader — this file only ever reaches their existing, unchanged
 * entry points through ../runtime-server.ts, never directly.
 */
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import net from "node:net";

const repoRoot = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE";
const whisperBin = "/opt/homebrew/bin/whisper-stream";
const modelPath = "/Users/tam/whisper-models/ggml-base.bin";
const runtimeSocketPath = join(repoRoot, "connections/voice-command/data/runtime.sock");
const activeSpeechPath = join(repoRoot, "connections/os-ui/data/active-speech.json");
const hostLogPath = join(repoRoot, "connections/voice-command/whisper-listener.log");

// 2026-08-21 addition (Owner instruction — permanent interrupt priority
// list): "หยุดพูด"/"เงียบ" added as their own explicit entries — this set
// is matched exactly/by-token (see isExactStop below), so a fused
// compound word like "หยุดพูด" does NOT already match via "หยุด" the way
// a substring check would; it needs its own literal entry.
const exactStopPhrases = new Set(["หยุด", "หยุดอ่าน", "หยุดพูด", "พอ", "เงียบ", "stop"]);
const SEGMENT_SETTLE_MS = 700; // non-STOP text is dispatched only once it stops changing for this long — STOP itself never waits for this.

function nowMs() { return Date.now(); }
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stderr.write(line);
  try { appendFileSync(hostLogPath, line); } catch {}
}
function normalize(s) { return s.trim().toLowerCase(); }
function stripAnsi(s) { return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\r/g, "\n"); }

function isExactStop(text) {
  const n = normalize(text);
  if (exactStopPhrases.has(n)) return true;
  return n.split(/\s+/).filter(Boolean).some((tok) => exactStopPhrases.has(tok));
}

function readActiveSpeechText() {
  try {
    if (!existsSync(activeSpeechPath)) return null;
    const obj = JSON.parse(readFileSync(activeSpeechPath, "utf8"));
    return typeof obj.text === "string" ? obj.text : null;
  } catch { return null; }
}

function isSelfEcho(transcript, activeText) {
  const t = normalize(transcript);
  const a = normalize(activeText);
  if (!t || !a) return false;
  if (a.includes(t)) return true;
  const tWords = new Set(t.split(/\s+/).filter(Boolean));
  const aWords = new Set(a.split(/\s+/).filter(Boolean));
  if (tWords.size === 0) return false;
  const overlap = [...tWords].filter((w) => aWords.has(w)).length;
  return overlap / tWords.size >= 0.6;
}

/**
 * One request, one short-lived Unix-socket connection to
 * ../runtime-server.ts — cheap (no process spawn, no V8 startup) and
 * carries no state of its own; the runtime process is the single owner
 * of dispatcher `state`/`voice-queue.mjs`'s `activeChild`.
 */
function sendToRuntime(msg) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(runtimeSocketPath);
    let buf = "";
    sock.on("connect", () => sock.write(`${JSON.stringify(msg)}\n`));
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const idx = buf.indexOf("\n");
      if (idx >= 0) {
        const line = buf.slice(0, idx);
        sock.end();
        try { resolve(JSON.parse(line)); } catch (err) { reject(err); }
      }
    });
    sock.on("error", reject);
  });
}

function dispatchFastStop(matchedAt, transcript) {
  log(`STOP_MATCH_PARTIAL phrase=${transcript} t_ms=${matchedAt}`);
  sendToRuntime({ type: "STOP_FAST", transcript })
    .then((res) => {
      const terminatedAt = nowMs();
      log(`SAY_PROCESS_TERMINATED result=${JSON.stringify(res)} t_ms=${terminatedAt} latency_ms=${terminatedAt - matchedAt}`);
    })
    .catch((err) => log(`RUNTIME_UNAVAILABLE op=STOP_FAST error=${err.message}`));
}

function dispatchTranscript(text) {
  log(`DISPATCH transcript=${text}`);
  sendToRuntime({ type: "DISPATCH", transcript: text })
    .then((result) => log(`DISPATCH result=${JSON.stringify(result)}`))
    .catch((err) => log(`RUNTIME_UNAVAILABLE op=DISPATCH error=${err.message}`));
}

let hasFastStoppedThisSegment = false;
let lastRawText = "";
let settleTimer = null;
let micAudioStartMs = null;

function handleUpdate(rawLine) {
  const text = rawLine.trim();
  if (!text || text === lastRawText) return;
  lastRawText = text;
  log(`SEGMENT_UPDATE=${text}`);

  // Tier 1 — exact/deterministic STOP, checked on EVERY raw update, no debounce, no wait for anything else.
  if (!hasFastStoppedThisSegment && isExactStop(text)) {
    hasFastStoppedThisSegment = true;
    if (micAudioStartMs !== null) log(`MIC_TO_STOP_PARTIAL_LATENCY_MS=${nowMs() - micAudioStartMs}`);
    // ../runtime-server.ts's STOP_FAST handler runs the full handleTranscript()
    // itself as a fire-and-forget followup after cancelling — calling
    // dispatchTranscript() here too would dispatch the same STOP transcript twice.
    dispatchFastStop(nowMs(), text);
    return;
  }

  // Non-STOP text: wait for it to settle (stop changing) before treating it as a real segment — avoids dispatching every mid-word refinement.
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    hasFastStoppedThisSegment = false;
    const activeText = readActiveSpeechText();
    if (activeText && isSelfEcho(text, activeText)) {
      log(`SELF_ECHO_DETECTED transcript=${text} active=${activeText}`);
      return;
    }
    dispatchTranscript(text);
  }, SEGMENT_SETTLE_MS);
}

function realVolume() {
  try {
    return execFileSync("/usr/bin/osascript", ["-e", "get volume settings"], { encoding: "utf8" }).trim();
  } catch { return "UNKNOWN"; }
}

log(`WHISPER_LISTENER_STARTING volume_before=${realVolume()}`);

const runtimeCheck = await sendToRuntime({ type: "STATE" }).catch((err) => ({ error: err.message }));
if (runtimeCheck.error) {
  log(`RUNTIME_UNAVAILABLE_AT_STARTUP error=${runtimeCheck.error} — start ../runtime-server.ts first; refusing to listen with no dispatch path`);
  process.exit(1);
}
log(`RUNTIME_CONNECTED state=${runtimeCheck.state}`);

const args = ["-m", modelPath, "-l", "th", "-t", "4"];
const child = spawn(whisperBin, args, { cwd: repoRoot });

child.stdout.on("data", (chunk) => {
  const text = stripAnsi(chunk.toString("utf8"));
  for (const rawLine of text.split("\n")) {
    if (rawLine.includes("Start speaking") && micAudioStartMs === null) {
      micAudioStartMs = nowMs();
      log(`MIC_AUDIO_START t_ms=${micAudioStartMs} volume=${realVolume()}`);
      continue;
    }
    handleUpdate(rawLine);
  }
});
child.stderr.on("data", () => {}); // real whisper.cpp diagnostic/model-load noise — not logged, to keep this log readable; a nonzero exit code still surfaces below.
child.on("exit", (code) => log(`WHISPER_STREAM_EXITED code=${code} volume_after=${realVolume()}`));

process.on("SIGINT", () => { child.kill("SIGTERM"); process.exit(0); });
process.on("SIGTERM", () => { child.kill("SIGTERM"); process.exit(0); });
