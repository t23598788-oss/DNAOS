/**
 * หน้าที่: the ONE real microphone capture mechanism — `rec` (part of
 * `sox`, a real, already-installed binary on this machine — confirmed
 * via `which rec` during Discovery, never a new audio library added to
 * this repo). Records one bounded-duration utterance window to a real
 * temp WAV file per call. No streaming, no continuously-open device
 * handle — each call is a discrete, real recording, which is also what
 * makes self-audio-suppression provable: the caller simply never issues
 * the next recording call while DNA OS is speaking (see
 * ../voice-command-listener.mjs).
 *
 * Input: `durationSeconds`.
 * Output: `recordUtterance` -> the real WAV file path, or null on a real
 * capture failure (never fabricated).
 * Dependency ที่อนุญาต: node:child_process, node:fs, node:os, node:path.
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function recordUtterance(durationSeconds = 4, recBinary = "/opt/homebrew/bin/rec") {
  const dir = mkdtempSync(join(tmpdir(), "voice-command-mic-"));
  const wavPath = join(dir, "utterance.wav");
  return new Promise((resolve) => {
    const child = spawn(recBinary, ["-q", "-r", "16000", "-c", "1", wavPath, "trim", "0", String(durationSeconds)], { stdio: "ignore" });
    child.once("exit", (code) => resolve(code === 0 ? wavPath : null));
    child.once("error", () => resolve(null));
  });
}
