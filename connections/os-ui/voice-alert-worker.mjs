#!/usr/bin/env node
/**
 * SPEAKING PERMANENTLY DISABLED (2026-08-21, Owner instruction — "SILENT
 * BY DEFAULT อย่างถาวร... ห้ามผูก task completed... เข้ากับ TTS trigger
 * อีก"). This worker's entire original purpose was announcing
 * work-order-audit outcomes (COMPLETED/FAILED/BLOCKED/
 * OWNER_ACTION_REQUIRED) out loud, unattended — exactly the
 * task-completion-to-speech binding the Owner has now permanently
 * banned. `consume()` below still tracks its cursor over
 * `work-order-audit.jsonl` (harmless bookkeeping) but the actual
 * `speak(...)` call has been removed — see `consume()`'s body. The ONLY
 * path allowed to speak now is `connections/voice-command/`'s existing,
 * on-demand, explicit-command-triggered dispatcher.
 *
 * Background voice bridge for the existing OS UI audit stream.
 * It only observes completed, non-dry-run outcomes and speaks a short,
 * redacted summary through the macOS `say` binary. It never executes a
 * Work Order and never reads credential values.
 *
 * LIVE EVENT ONLY (2026-08-21 fix — Owner-reported symptom: PID 3494
 * repeating stale 2026-08-19 BLOCKED records forever, traced live via
 * lsof/pgrep to an overlapping-setInterval pile-up against a stuck
 * cursor): this worker must never speak a
 * record that existed in `work-order-audit.jsonl` before THIS process
 * became ready. `initializeLiveCursor()` unconditionally resets the
 * cursor to the audit file's real, current end-of-file on every single
 * start — first run, restart, crash-recovery, cursor missing, cursor
 * corrupt — there is no code path left where a start reads from an old
 * offset. This also structurally fixes the root cause found in that
 * investigation: `setInterval` firing a new `consume()` every 750ms
 * without waiting for the previous one to finish, which — whenever a
 * real backlog existed — let many overlapping `consume()` calls pile up
 * against the single shared `say` lock, all replaying the same
 * unconsumed range forever because none of them ever lived long enough
 * to persist progress. Starting the cursor at EOF removes the backlog
 * that triggered the pile-up in the first place; the new `inFlight`
 * guard below (bottom of this file) additionally makes sure a slow
 * `consume()` — from a genuine burst of live events — can never overlap
 * with itself either.
 *
 * Audit history itself (`work-order-audit.jsonl`) is never touched,
 * truncated, or deleted by this file — only the cursor's STARTING
 * position changes. Every historical record is still on disk for any
 * other reader; this worker just never speaks anything from before its
 * own startup instant again.
 */
import fs from "node:fs";
import path from "node:path";

// Real speaking is permanently removed for the unattended daemon path
// (see file header) — `consume()`'s `speak` parameter now defaults to
// this no-op instead of the real `speakQueued`. Tests already inject
// their own fake `speak` function (see ../tests/voice-alert-worker.test.ts),
// so this change is invisible to them; only the real launchd-invoked
// daemon (bottom of this file, which calls `consume()` with no explicit
// `speak` argument) is affected.
async function noopSpeak() { return false; }

const dataDir = path.resolve(new URL(".", import.meta.url).pathname, "data");
const auditPath = path.join(dataDir, "work-order-audit.jsonl");
const cursorPath = path.join(dataDir, "voice-alert.cursor.json");
const pollMs = 750;
const speakTimeoutMs = 15000;
const speakable = new Set(["COMPLETED", "FAILED", "BLOCKED", "OWNER_ACTION_REQUIRED"]);

const defaultPaths = { auditPath, cursorPath };

/** Real, already-persisted progress — used only WHILE running, between one poll and the next. Never consulted at startup any more (see initializeLiveCursor). */
export function readCursor(paths = defaultPaths) {
  try {
    const parsed = JSON.parse(fs.readFileSync(paths.cursorPath, "utf8"));
    return Number.isFinite(parsed.offset) ? parsed.offset : fs.statSync(paths.auditPath).size;
  } catch {
    try { return fs.statSync(paths.auditPath).size; } catch { return 0; }
  }
}

export function writeCursor(offset, paths = defaultPaths) {
  fs.writeFileSync(paths.cursorPath, JSON.stringify({ offset, updated_at: new Date().toISOString() }) + "\n", "utf8");
}

/**
 * LIVE EVENT ONLY entrypoint — call exactly once, before the first poll,
 * on every start (first run AND restart alike). Always overwrites
 * whatever cursor value exists (valid, stale, missing, or corrupt) with
 * the audit file's real current size, so nothing written before this
 * call can ever be spoken by this process. Creates the audit file
 * (empty) if it does not exist yet — never deletes or truncates an
 * existing one.
 */
export function initializeLiveCursor(paths = defaultPaths) {
  fs.mkdirSync(path.dirname(paths.auditPath), { recursive: true });
  if (!fs.existsSync(paths.auditPath)) fs.writeFileSync(paths.auditPath, "", "utf8");
  const eof = fs.statSync(paths.auditPath).size;
  writeCursor(eof, paths);
  return eof;
}

export function safeText(record) {
  const order = record?.order ?? {};
  const outcome = record?.outcome ?? {};
  const action = String(order.ui_action ?? "งานระบบ");
  const status = String(outcome.status ?? "ผลลัพธ์");
  const summary = String(outcome.summary ?? "มีผลลัพธ์ใหม่").replace(/[\r\n]+/g, " ").slice(0, 240);
  return `DNA OS: ${action} ${status}. ${summary}`;
}

/**
 * One poll pass. Only ever reads forward from the real, persisted
 * cursor (which `initializeLiveCursor` already pinned to a live-only
 * starting point) — never re-derives a start position from file
 * content/age. `speak` is injectable so tests can observe exactly which
 * records this function decided to speak without invoking the real
 * `/usr/bin/say` binary.
 */
export async function consume(paths = defaultPaths, speak = noopSpeak) {
  let offset = readCursor(paths);
  let buffer;
  try {
    buffer = fs.readFileSync(paths.auditPath);
  } catch {
    return { consumed: offset, spoken: [] };
  }
  // Byte-exact slicing — offsets are always byte counts (from
  // fs.statSync().size or Buffer.byteLength sums below), so the file
  // must be sliced as a Buffer BEFORE decoding to a string. Slicing an
  // already-decoded utf8 string with a byte offset silently breaks the
  // moment any multi-byte character (e.g. an em dash in a historical
  // summary) appears before the cursor, since JS string indices count
  // UTF-16 code units, not bytes — a real bug this fix also closes.
  if (offset > buffer.length) offset = 0;
  const chunk = buffer.slice(offset).toString("utf8");
  const lines = chunk.split("\n");
  const completeLines = lines.slice(0, -1);
  let consumed = offset;
  const spoken = [];
  for (const line of completeLines) {
    consumed += Buffer.byteLength(line) + 1;
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      const outcome = record?.outcome ?? {};
      const action = record?.order?.ui_action;
      if (record?.order?.dry_run || action === "speak" || !speakable.has(outcome.status)) continue;
      const text = safeText(record);
      await speak(text, speakTimeoutMs);
      spoken.push(text);
    } catch {
      // Malformed historical lines are recorded by the producer; do not stop the bridge.
    }
  }
  writeCursor(consumed, paths);
  return { consumed, spoken };
}

function isMainModule() {
  return typeof process !== "undefined" && import.meta.url === `file://${process.argv[1]}`;
}

if (isMainModule()) {
  initializeLiveCursor();
  // Overlap guard — a slow consume() (a real burst of speakable events,
  // each serialized through the single shared say lock) can never
  // overlap with itself; the next tick that finds one still in flight is
  // simply skipped, not queued, so no pile-up of stale-offset re-reads
  // can ever form again.
  let inFlight = false;
  setInterval(() => {
    if (inFlight) return;
    inFlight = true;
    consume().finally(() => { inFlight = false; });
  }, pollMs);
}
