import fs from "node:fs";
import { spawn } from "node:child_process";

const lockPath = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE/connections/os-ui/data/voice-output.lock";
// 2026-08-21 addition (Owner instruction — Option B, replacing
// setVoiceProcessingEnabled/VPIO, which real, measured evidence showed
// dropped real macOS output volume 100 -> 56 with no self-recovery):
// the real, current text DNA OS is speaking right now — read directly
// by ../voice-command/app-host/'s Swift binary (which cannot import a
// Node .mjs module) to classify a transcript it just heard as
// SELF_ECHO (drop, never dispatch) versus a real Owner utterance. Never
// used to decide STOP — STOP is decided by an exact/deterministic match
// BEFORE this file is even consulted (see main.swift).
const activeSpeechPath = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE/connections/os-ui/data/active-speech.json";

function acquire() {
  try {
    const fd = fs.openSync(lockPath, "wx");
    fs.writeSync(fd, `${process.pid}\n`);
    return fd;
  } catch {
    try {
      if (Date.now() - fs.statSync(lockPath).mtimeMs > 60_000) fs.unlinkSync(lockPath);
    } catch { /* another process owns or is clearing the lock */ }
    return null;
  }
}

function release(fd) {
  try { fs.closeSync(fd); } catch { /* already closed */ }
  try { fs.unlinkSync(lockPath); } catch { /* another recovery pass removed it */ }
}

// 2026-08-21 addition (Voice Control STOP requirement): tracks the ONE
// currently-running `say` child, if any — real, provable evidence that
// "the DNA OS speech process" means exactly one thing at a time, since
// every caller (voice-alert-worker, claude-voice-bridge, and now
// connections/voice-command/) already shares the SAME `voice-output.lock`
// and can therefore never have more than one `say` running concurrently.
// Never a second/parallel speech engine — this is the existing one,
// exposing a cancel handle it did not have before.
let activeChild = null;

// 2026-08-21 addition (Owner instruction — HARD INTERRUPT, generation
// token): this module is the ONE real place across the whole system that
// holds an actual OS process handle for TTS playback (`activeChild`,
// `/usr/bin/say`) — traced this round from voice-command's dispatcher
// down through here; every other caller (the now-permanently-disabled
// claude-voice-bridge.mjs / voice-alert-worker.mjs / agent-gateway
// voice-bridge.ts) already funnels through `speakQueued`/
// `cancelActiveSpeech` here too, so a guard placed here — not upstream
// keyword filtering — closes the race for every caller, present or
// future. `speechGeneration` bumps on every `cancelActiveSpeech()` call
// (even if nothing is currently speaking); any `speakQueued()` call
// snapshots the generation it started with and checks it again
// immediately before ever spawning `say` — if a STOP happened anywhere
// in between (including while it was still waiting for the lock), it
// aborts without producing any audio, rather than possibly winning the
// lock right after a STOP and starting stale speech.
let speechGeneration = 0;

/** True while a real `/usr/bin/say` child spawned by this process is running — the one provable signal ../voice-command/'s self-audio-suppression gate checks before opening the microphone. */
export function isSpeaking() {
  return activeChild !== null;
}

/**
 * Immediately terminates the currently-running `say` child, if any —
 * never waits for it to finish naturally — AND invalidates every
 * speak request already in flight (waiting for the lock, or about to
 * spawn `say`) by bumping `speechGeneration`, so none of them can start
 * stale speech afterward. Returns true only if a real process was
 * actually signaled (a caller only waiting on the lock still gets
 * invalidated, just doesn't count toward this return value). The
 * pending `speakQueued()` call this interrupts resolves `false` (its own
 * `child.once("exit", ...)` handler still fires from the SIGTERM), same
 * as any other real say failure.
 */
export function cancelActiveSpeech() {
  speechGeneration += 1;
  if (!activeChild) return false;
  activeChild.kill("SIGTERM");
  return true;
}

export async function speakQueued(text, timeoutMs = 20_000) {
  const myGeneration = speechGeneration;
  const safe = String(text).replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 700);
  const deadline = Date.now() + timeoutMs;
  let fd = null;
  while (!fd && Date.now() < deadline) {
    if (myGeneration !== speechGeneration) return false; // cancelled while still waiting for the lock — never even tries to acquire it.
    fd = acquire();
    if (!fd) await new Promise((resolve) => setTimeout(resolve, 150));
  }
  if (!fd) return false;
  if (myGeneration !== speechGeneration) { release(fd); return false; } // cancelled in the instant right after the lock was acquired — release immediately, never spawn `say`.
  try {
    fs.writeFileSync(activeSpeechPath, JSON.stringify({ text: safe, started_at: new Date().toISOString() }), "utf-8");
    const ok = await new Promise((resolve) => {
      const child = spawn("/usr/bin/say", [safe], { stdio: "ignore" });
      activeChild = child;
      const timer = setTimeout(() => { child.kill("SIGTERM"); }, timeoutMs);
      child.once("exit", (code, signal) => { clearTimeout(timer); if (activeChild === child) activeChild = null; resolve(signal !== "SIGTERM" && code === 0); });
      child.once("error", () => { clearTimeout(timer); if (activeChild === child) activeChild = null; resolve(false); });
    });
    return ok;
  } finally {
    try { fs.unlinkSync(activeSpeechPath); } catch { /* already cleared or never written */ }
    release(fd);
  }
}
