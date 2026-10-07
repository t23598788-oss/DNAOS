/**
 * หน้าที่: the ONE real session controller — turns a resolved
 * `VoiceIntent` into the real `read_screen`/`speak` Work Orders via
 * `connections/os-ui/adapter-contract.ts`'s `runUiWorkOrder` (the SAME
 * admitted, audited path every other os-ui caller uses — never a
 * bypass), and owns the small `IDLE -> READING -> SPEAKING -> IDLE`
 * state machine plus its `STOP` cancellation.
 *
 * State machine (STEP requirement 6):
 *   IDLE -> START_COMMAND -> READING -> SPEAKING -> COMPLETE -> IDLE
 *   READING|SPEAKING -> STOP_COMMAND -> CANCEL -> IDLE
 *
 * Cancellation (STEP requirement 4): a `generation` counter is bumped on
 * every STOP. The in-flight `read_screen`/`speak` promise, once it
 * resolves, checks whether its own generation is still current — if not,
 * its result is discarded and nothing is spoken/no further action is
 * taken. Real, immediate interruption of an ACTIVE speech happens via
 * `cancelActiveSpeech()` (../os-ui/voice-queue.mjs, extended this round)
 * — a real SIGTERM to the one shared `say` child, never a wait for it to
 * finish naturally, PLUS a `speechGeneration` token inside voice-queue.mjs
 * itself (2026-08-21 addition) that invalidates any speak call still
 * waiting for the lock — closing the race a generation counter here
 * alone could not. This capability never touches
 * `connections/os-ui/screen-reader.ts` or the screenshot capability —
 * cancellation of an in-flight `read_screen` Accessibility read is
 * logical (discard-on-resolve), not a forced kill of that process,
 * since modifying screen-reader.ts is explicitly out of scope this round.
 *
 * 2026-08-21 addition (Owner instruction — Natural Voice Output Intent):
 * routes the five new intents `./intent-resolver.ts` can now resolve.
 * Checked before building: `../os-ui/screen-reader.ts` exposes only
 * `readScreen(target, timeoutMs)` (whole frontmost-window text) and
 * `speakText` — there is NO mouse-position/text-selection API anywhere
 * in this repo. Real, local Thai translation/summarization capability
 * was also checked this round (Ollama installed but its server was not
 * running, no model manifest confirmed, no other local NLP tool found)
 * — so:
 *   TRANSLATE, SUMMARIZE                 -> action "NOT_AVAILABLE" (recognized, not executed — no real local capability, never faked)
 *   SELECTIVE_READ (mouse/cursor/"ตรงนี้"/"ส่วนที่เลือก") -> action "NOT_AVAILABLE" (no mouse-position/selection API exists)
 *   SELECTIVE_READ (line number / last paragraph) -> action "STARTED_SELECTIVE_READ" (real, deterministic — extracted from read_screen's own text)
 *   SCREEN_INTERPRETATION                -> action "STARTED_SCREEN_INTERPRETATION" (real read_screen + a deterministic metadata/UUID/Task-ID filter before speaking — NOT genuine contextual interpretation, which is equally NOT_AVAILABLE without a real language-understanding capability; documented honestly, not oversold)
 *
 * Input: a real transcript string (already produced by Speech-to-Text).
 * Output: `handleTranscript`, `getVoiceCommandState`.
 * Dependency ที่อนุญาต: ../os-ui/adapter-contract.ts (`runUiWorkOrder` —
 * its one public entry point), ../os-ui/voice-queue.mjs
 * (`cancelActiveSpeech`, `isSpeaking` — extended this round, never a
 * second speech engine), ./intent-resolver.ts, ./audit.ts,
 * ./host-runtime.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never call `readScreen`/`speakText`/`/usr/bin/osascript`/
 * `/usr/bin/say` directly — always through `runUiWorkOrder`, so
 * admission and audit never have a bypass path. Never let a READ-family
 * intent start while state is not IDLE (no queueing, no guessing — a
 * stray READ while busy is IGNORED, matching STEP requirement 7's
 * fail-closed posture). Never call an LLM to fake TRANSLATE/SUMMARIZE/
 * genuine interpretation — report NOT_AVAILABLE instead.
 */

import { runUiWorkOrder } from "../os-ui/adapter-contract";
import { resolveVoiceIntent } from "./intent-resolver";
import { appendVoiceCommandAudit } from "./audit";
import { newCorrelationId, nowIso } from "./host-runtime";
import type { HandleTranscriptResult, VoiceCommandState, VoiceIntent } from "./types";

const READ_TIMEOUT_MS = 8_000;
const SPEAK_TIMEOUT_MS = 15_000;

/**
 * Dynamic, not static — matching `connections/os-ui/screen-reader.ts`'s
 * own `await import("./voice-queue.mjs")` pattern exactly. Verified live
 * (2026-08-21): under this repo's tsx/Node ESM setup, a STATIC import of
 * a `.mjs` file and a DYNAMIC `import()` of the identical absolute path
 * resolve to two SEPARATE module instances (`cancelActiveSpeech`/
 * `isSpeaking` from one side would never see state set by the other) —
 * two dynamic imports of the same path, however, always share one
 * instance. Since screen-reader.ts (forbidden to modify this round) uses
 * a dynamic import, this file must too, or `isSpeaking`/
 * `cancelActiveSpeech` would silently observe a different `activeChild`
 * than the one `speakText()` actually sets.
 */
async function voiceQueue() {
  return import("../os-ui/voice-queue.mjs");
}

let state: VoiceCommandState = "IDLE";
let generation = 0;

export function getVoiceCommandState(): VoiceCommandState {
  return state;
}

/** Test/diagnostic only — never called from the real listener loop. */
export function __resetVoiceCommandStateForTests(): void {
  state = "IDLE";
  generation += 1;
}

const THAI_NUMBER_WORDS: Readonly<Record<string, number>> = {
  หนึ่ง: 1, สอง: 2, สาม: 3, สี่: 4, ห้า: 5, หก: 6, เจ็ด: 7, แปด: 8, เก้า: 9, สิบ: 10,
};

/** Real, deterministic — never a guess. `null` if no resolvable line number is present in the transcript. */
function parseLineNumber(transcript: string): number | null {
  const digitMatch = transcript.match(/บรรทัดที่\s*(\d+)/);
  if (digitMatch) return Number(digitMatch[1]);
  for (const [word, num] of Object.entries(THAI_NUMBER_WORDS)) {
    if (transcript.includes(`บรรทัดที่${word}`) || transcript.includes(`บรรทัดที่ ${word}`)) return num;
  }
  return null;
}

/** No mouse-position/text-selection API exists in ../os-ui/screen-reader.ts today — these SELECTIVE_READ phrasings are structurally unresolvable, not just hard to parse. */
function isUnresolvableSelectiveRead(transcript: string): boolean {
  return ["เมาส์คลุม", "เมาส์ชี้", "ส่วนที่เลือก", "อ่านตรงนี้"].some((p) => transcript.includes(p));
}

/** Extracts the requested slice of `readText` for a SELECTIVE_READ transcript — real text operations, no AI. `null` means unresolvable from the transcript alone (never guessed). */
function resolveSelectiveReadTarget(transcript: string, readText: string): { text: string } | { reason: string } {
  const lineNumber = parseLineNumber(transcript);
  if (lineNumber !== null) {
    const lines = readText.split("\n").filter((l) => l.trim().length > 0);
    const line = lines[lineNumber - 1];
    return line !== undefined ? { text: line } : { reason: `line ${lineNumber} does not exist (read_screen text has ${lines.length} non-empty line(s))` };
  }
  if (transcript.includes("ย่อหน้า")) {
    const paragraphs = readText.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const last = paragraphs[paragraphs.length - 1];
    return last ? { text: last } : { reason: "no paragraph boundary found in read_screen text" };
  }
  return { reason: "SELECTIVE_READ target phrase not recognized as line-number or last-paragraph" };
}

/** Real, deterministic filter — strips patterns that look like Task IDs/UUIDs/correlation IDs before speaking. NOT genuine contextual interpretation (see file header) — just removes system metadata shapes. */
function filterSystemMetadata(text: string): string {
  return text
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "")
    .replace(/\bvoice-cmd-[0-9a-f-]+\b/gi, "")
    .replace(/\btask[-_]?id\s*[:=]\s*\S+/gi, "")
    .replace(/\bcorrelation[-_]?id\s*[:=]\s*\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface ReadCycleOutcome {
  action: "STARTED_READ" | "STARTED_SCREEN_INTERPRETATION" | "STARTED_SELECTIVE_READ" | "IGNORED";
  error: string | null;
}

/**
 * Shared read->transform->speak cycle for READ, SCREEN_INTERPRETATION,
 * and the resolvable SELECTIVE_READ phrasings. `transform` runs on the
 * real `read_screen` result text; if it reports unresolvable, nothing is
 * spoken and the cycle reports IGNORED with the real reason in `error`
 * (never speaks a guessed fallback).
 */
async function startReadThenSpeak(
  correlationId: string,
  successAction: "STARTED_READ" | "STARTED_SCREEN_INTERPRETATION" | "STARTED_SELECTIVE_READ",
  transform: (readText: string) => { text: string } | { reason: string }
): Promise<ReadCycleOutcome> {
  const myGeneration = generation;
  state = "READING";

  const readOutcome = await runUiWorkOrder({
    ui_action: "read_screen",
    target: "", // empty = whatever is frontmost at the moment this Work Order runs
    scope: "voice-command-read",
    timeout_ms: READ_TIMEOUT_MS,
    dry_run: false,
    risk_confirmed: true,
    idempotency_key: `${correlationId}-read`,
  });

  if (myGeneration !== generation) return { action: successAction, error: "cancelled before speaking" }; // STOP arrived mid-read — discard, never speak a stale result.
  if (!readOutcome.ok) {
    state = "IDLE";
    return { action: successAction, error: readOutcome.summary };
  }

  const transformed = transform(readOutcome.summary);
  if ("reason" in transformed) {
    state = "IDLE";
    return { action: "IGNORED", error: transformed.reason };
  }

  state = "SPEAKING";
  const speakOutcome = await runUiWorkOrder({
    ui_action: "speak",
    target: transformed.text,
    scope: "voice-command-speak",
    timeout_ms: SPEAK_TIMEOUT_MS,
    dry_run: false,
    risk_confirmed: true,
    idempotency_key: `${correlationId}-speak`,
  });

  if (myGeneration === generation) state = "IDLE";
  return { action: successAction, error: speakOutcome.ok ? null : speakOutcome.summary };
}

const NOT_AVAILABLE_REASON: Readonly<Record<VoiceIntent, string>> = {
  TRANSLATE: "no real local Thai translation capability confirmed this round (Ollama installed but server not running, no model manifest checked) — never faked",
  SUMMARIZE: "no real local summarization capability confirmed this round — never faked",
  SELECTIVE_READ: "no mouse-position/text-selection API exists in ../os-ui/screen-reader.ts",
  STOP: "", // never reaches NOT_AVAILABLE
  READ: "", // never reaches NOT_AVAILABLE
  SCREEN_INTERPRETATION: "", // never reaches NOT_AVAILABLE (has real, if partial, execution)
  UNKNOWN: "",
};

/**
 * The one real entry point. Resolves intent deterministically
 * (./intent-resolver.ts), then either starts a real read+transform+speak
 * cycle, cancels an active one, reports a recognized-but-unavailable
 * intent honestly, or ignores (unknown speech, or a stray command that
 * does not apply to the current state). Always returns — a READ-family
 * intent's returned promise resolves only once the full cycle settles
 * (or is discarded by a STOP); callers that must keep listening WHILE
 * that is in flight should not await this call before scheduling their
 * next listen cycle (see ../voice-command-listener.mjs).
 */
export async function handleTranscript(transcript: string): Promise<HandleTranscriptResult> {
  const correlationId = newCorrelationId();
  const intent = resolveVoiceIntent(transcript);
  const stateBefore = state;
  let action: HandleTranscriptResult["action"] = "IGNORED";
  let readKey: string | null = null;
  let speakKey: string | null = null;
  let error: string | null = null;

  if (intent === "STOP") {
    // Absolute priority (STEP + 2026-08-21 Owner instruction) — this
    // branch never checks any other condition first.
    //
    // Real bug found and fixed 2026-08-21 (test Q): gating cancellation
    // on dispatcher's OWN `state` alone meant a STOP was a silent no-op
    // against real, currently-playing audio that this dispatcher's own
    // READ cycle did not start (e.g. any other real caller sharing
    // ../os-ui/voice-queue.mjs's single `say` lock) — directly
    // contradicting "cancel ของที่กำลังพูดจริง" (cancel whatever is
    // REALLY speaking, regardless of who started it). Now gated on the
    // real, shared `isSpeaking()` signal OR this dispatcher's own state,
    // whichever says something is active.
    const reallySpeaking = (await voiceQueue()).isSpeaking();
    if (state === "READING" || state === "SPEAKING" || reallySpeaking) {
      generation += 1; // invalidates any in-flight read/speak promise's result, and any speak call still waiting for the lock (see ../os-ui/voice-queue.mjs's own speechGeneration).
      (await voiceQueue()).cancelActiveSpeech(); // real, immediate SIGTERM if something is actively speaking right now — no-op otherwise.
      state = "IDLE";
      action = "CANCELLED";
    }
    // Neither this dispatcher's own state nor the real shared isSpeaking() signal is active — STOP is a real, harmless no-op.
  } else if (intent === "TRANSLATE" || intent === "SUMMARIZE") {
    error = NOT_AVAILABLE_REASON[intent];
    action = "NOT_AVAILABLE";
  } else if (intent === "SELECTIVE_READ" && isUnresolvableSelectiveRead(transcript)) {
    error = NOT_AVAILABLE_REASON.SELECTIVE_READ;
    action = "NOT_AVAILABLE";
  } else if (intent === "READ" || intent === "SCREEN_INTERPRETATION" || intent === "SELECTIVE_READ") {
    if (state === "IDLE") {
      readKey = `${correlationId}-read`;
      speakKey = `${correlationId}-speak`;
      const transform =
        intent === "SCREEN_INTERPRETATION"
          ? (readText: string) => ({ text: filterSystemMetadata(readText) })
          : intent === "SELECTIVE_READ"
            ? (readText: string) => resolveSelectiveReadTarget(transcript, readText)
            : (readText: string) => ({ text: readText });
      const successAction =
        intent === "SCREEN_INTERPRETATION" ? "STARTED_SCREEN_INTERPRETATION" : intent === "SELECTIVE_READ" ? "STARTED_SELECTIVE_READ" : "STARTED_READ";
      const outcome = await startReadThenSpeak(correlationId, successAction, transform);
      action = outcome.action;
      error = outcome.error;
    }
    // state !== "IDLE": a stray READ-family intent while already busy is ignored, never queued.
  }
  // intent === "UNKNOWN": always IGNORED — no action, fail-closed.

  const result: HandleTranscriptResult = { transcript, intent, action, state_before: stateBefore, state_after: state, correlation_id: correlationId };
  appendVoiceCommandAudit({ ...result, recorded_at: nowIso(), read_work_order_key: readKey, speak_work_order_key: speakKey, error });
  return result;
}
