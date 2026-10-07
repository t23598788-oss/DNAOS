/**
 * หน้าที่: Node-side wrapper for ./speech-to-text.swift — the ONE real
 * Speech-to-Text mechanism (Apple's Speech framework). Spawns the real
 * Swift script per utterance, parses its single `TRANSCRIPT=`/`ERROR=`
 * output line. Never returns a guessed/partial transcript — a real
 * error from the Swift process is reported as `ok:false`, never coerced
 * into an empty-string success.
 *
 * Input: a real WAV file path (from ./microphone.mjs).
 * Output: `transcribeAudio` -> `{ ok, text, error }`.
 * Dependency ที่อนุญาต: node:child_process, node:path, node:url.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "speech-to-text.swift");

export async function transcribeAudio(wavPath, locale = "th-TH", timeoutMs = 22_000) {
  return new Promise((resolve) => {
    const child = spawn("/usr/bin/swift", [scriptPath, wavPath, locale], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (chunk) => { out += chunk.toString("utf8"); });
    const timer = setTimeout(() => { child.kill("SIGTERM"); }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      const line = out.trim().split("\n").pop() ?? "";
      if (line.startsWith("TRANSCRIPT=")) {
        resolve({ ok: true, text: line.slice("TRANSCRIPT=".length), error: null });
      } else if (line.startsWith("ERROR=")) {
        resolve({ ok: false, text: null, error: line.slice("ERROR=".length) });
      } else {
        resolve({ ok: false, text: null, error: `UNEXPECTED_OUTPUT:${line || "(empty)"}` });
      }
    });
    child.once("error", (error) => { clearTimeout(timer); resolve({ ok: false, text: null, error: `SPAWN_FAILED:${error.message}` }); });
  });
}
