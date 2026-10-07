#!/usr/bin/env node
/**
 * PERMANENTLY DISABLED (2026-08-21, Owner instruction — "SILENT BY
 * DEFAULT อย่างถาวร... ห้ามผูก task completed, agent summary, new
 * response, session finished เข้ากับ TTS trigger อีก"). This file used
 * to watch the live Claude session transcript and auto-speak every
 * assistant turn (`stop_reason === "end_turn"`) — this WAS the real root
 * cause of "the agent finishes a summary and it gets read out loud
 * unasked" (confirmed by tracing every real caller of `speakQueued`
 * repo-wide this round). That binding is now permanently removed, not
 * just toggled off — this process still runs (its launchd job has
 * `KeepAlive=true`), it just never speaks anything, ever, regardless of
 * what the session transcript contains. The ONLY path allowed to speak
 * now is `connections/voice-command/`'s existing, on-demand,
 * explicit-command-triggered dispatcher (READ intent -> read_screen ->
 * speak); it is untouched by this file.
 *
 * Kept as a real (inert) process rather than deleted so the launchd job
 * (`local-runtime/launchagents/com.dnaos.claude-voice-bridge.plist`,
 * `KeepAlive=true`) has something harmless to keep alive instead of
 * crash-looping — deleting the script out from under a KeepAlive daemon
 * would just make launchd respawn a missing-file error forever.
 */
import fs from "node:fs";
import path from "node:path";

const sessionDir = "/Users/tam/.claude/projects/-Users-tam-Desktop-DNA-OS-INFRASTRUCTURE";
const statePath = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE/connections/os-ui/data/claude-voice.cursor.json";
const pollMs = 900;

function readState() {
  try { return JSON.parse(fs.readFileSync(statePath, "utf8")); } catch { return {}; }
}
function writeState(state) {
  fs.writeFileSync(statePath, JSON.stringify(state) + "\n", "utf8");
}
function newestSession() {
  const files = fs.readdirSync(sessionDir).filter((name) => name.endsWith(".jsonl"));
  return files.map((name) => {
    const full = path.join(sessionDir, name);
    return { full, mtime: fs.statSync(full).mtimeMs };
  }).sort((a, b) => b.mtime - a.mtime)[0]?.full ?? null;
}
function redact(text) {
  return String(text)
    .replace(/(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}/g, "[redacted-key]")
    .replace(/(password|token|secret|api[_-]?key|authorization)\s*[:=]\s*\S+/gi, "$1 [redacted]")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}
async function consume() {
  const file = newestSession();
  if (!file) return;
  const state = readState();
  let offset = state.file === file && Number.isFinite(state.offset) ? state.offset : fs.statSync(file).size;
  const data = fs.readFileSync(file, "utf8");
  if (offset > Buffer.byteLength(data)) offset = 0;
  const lines = data.slice(offset).split("\n");
  let consumed = offset;
  for (const line of lines.slice(0, -1)) {
    consumed += Buffer.byteLength(line) + 1;
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      // Speaking-on-turn-completion is permanently removed (see file
      // header) — this loop now only advances the read cursor so the
      // state file doesn't grow unbounded re-reads; it never calls
      // speakQueued or inspects message content for speech purposes.
      void row;
    } catch { /* keep the bridge alive across partial transcript writes */ }
  }
  writeState({ file, offset: consumed, updated_at: new Date().toISOString() });
}

if (!fs.existsSync(statePath)) {
  const file = newestSession();
  writeState(file ? { file, offset: fs.statSync(file).size } : {});
}
setInterval(() => { void consume(); }, pollMs);
void consume();
