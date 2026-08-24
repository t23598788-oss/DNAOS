/**
 * หน้าที่: the real Voice Command Listener entrypoint — MICROPHONE ->
 * Speech-to-Text -> Voice Command Ingress -> (dispatcher handles the
 * rest). A plain sequential `while(true)` loop, never `setInterval` —
 * each cycle fully `await`s the previous one, so there is structurally
 * no way for overlapping capture/transcribe cycles to pile up against
 * each other (the exact bug class fixed in `../os-ui/voice-alert-
 * worker.mjs` this same week).
 *
 * Self-audio-suppression (STEP requirement 5, "ป้องกันระบบเอาเสียงของ
 * ตัวเองกลับมาเป็นคำสั่งใหม่"): before EVERY microphone capture, this
 * loop checks the real, shared `isSpeaking()` signal from
 * `../os-ui/voice-queue.mjs` — the SAME lock every speech caller in this
 * repo already shares. While true, the microphone is never even opened
 * for that cycle (not just filtered after the fact) — a real, provable
 * gate, not a heuristic.
 *
 * Screen Reader is NEVER polled here or anywhere in this loop — the only
 * thing this file loops on is listening for the next utterance;
 * `read_screen` only ever runs inside `./dispatcher.ts`'s
 * `handleTranscript`, itself only reachable from a real resolved READ
 * intent (STEP requirement 6).
 *
 * `void handleTranscript(...)` is deliberately NOT awaited here — a READ
 * command's full read+speak cycle can take several seconds; this loop
 * must keep listening (and stay able to hear a STOP) the entire time
 * that promise is still settling (STEP requirement 5's other half).
 *
 * Input: none (real microphone hardware).
 * Output: none (drives ./dispatcher.ts as a side effect).
 * Dependency ที่อนุญาต: ./microphone.mjs, ./speech-to-text.mjs,
 * ./dispatcher.ts, ../os-ui/voice-queue.mjs (`isSpeaking` only).
 */
import { recordUtterance } from "./microphone.mjs";
import { transcribeAudio } from "./speech-to-text.mjs";
import { handleTranscript } from "./dispatcher";

/**
 * Dynamic, not static — see ./dispatcher.ts's `voiceQueue()` for why:
 * a static import of this same `.mjs` file resolves to a SEPARATE
 * module instance from `connections/os-ui/screen-reader.ts`'s own
 * dynamic import, under this repo's tsx/Node ESM setup (verified live).
 */
async function isSpeaking(): Promise<boolean> {
  const mod = await import("../os-ui/voice-queue.mjs");
  return mod.isSpeaking();
}

const LISTEN_DURATION_SECONDS = 4;
const SUPPRESSED_RECHECK_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loop(): Promise<void> {
  for (;;) {
    if (await isSpeaking()) {
      await sleep(SUPPRESSED_RECHECK_MS); // self-audio-suppression: never open the mic while DNA OS is speaking.
      continue;
    }
    const wavPath = await recordUtterance(LISTEN_DURATION_SECONDS);
    if (!wavPath) continue; // real capture failure — try again next cycle, never a fabricated transcript.
    const transcription = await transcribeAudio(wavPath);
    if (!transcription.ok || !transcription.text) continue; // real STT failure/silence — nothing to dispatch.
    void handleTranscript(transcription.text); // fire-and-forget — see header: must not block the next listen cycle.
  }
}

void loop();
