/**
 * หน้าที่: the ONE fast-path STOP invocation — plain JavaScript (never
 * TypeScript/tsx), so launching it never pays tsx's TypeScript
 * transpilation cold-start cost. Calls the EXISTING, unchanged
 * `cancelActiveSpeech()` from ../os-ui/voice-queue.mjs directly — no
 * new cancellation logic, just a faster way to reach the same real
 * function than the full `dispatch-cli.ts` -> `handleTranscript()`
 * round trip.
 *
 * ../app-host/main.swift is the only real caller — spawned the instant
 * a PARTIAL transcript exact-matches a deterministic STOP phrase, before
 * the slower full dispatch (which still runs afterward, unchanged, to
 * produce the real audit/state transition — this file's only job is
 * terminating the active speech process as fast as possible).
 *
 * Input: none.
 * Output: prints `{"cancelled": boolean}` to stdout.
 * Dependency ที่อนุญาต: ../os-ui/voice-queue.mjs (cancelActiveSpeech only).
 */
import { cancelActiveSpeech } from "../os-ui/voice-queue.mjs";

const cancelled = cancelActiveSpeech();
console.log(JSON.stringify({ cancelled }));
