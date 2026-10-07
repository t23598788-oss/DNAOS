/**
 * หน้าที่: the type contracts for Voice Control — real microphone input
 * → deterministic command → the EXISTING `read_screen`/`speak` Work
 * Order path (`connections/os-ui/`). This capability owns exactly one
 * thing: turning a transcribed utterance into a deterministic intent and
 * driving a small IDLE/READING/SPEAKING state machine — it never reads a
 * screen or speaks anything itself (see ./dispatcher.ts, which only ever
 * calls `runUiWorkOrder`).
 *
 * Input: none (pure type definitions).
 * Output: `VoiceIntent`, `VoiceCommandState`, `HandleTranscriptResult`.
 * Dependency ที่อนุญาต: none.
 */

// 2026-08-21 addition (Owner instruction — Natural Voice Output Intent):
// extended from the original READ|STOP|UNKNOWN. See ./intent-resolver.ts
// for the exact, priority-ordered keyword sets and why STOP is checked
// first, unconditionally, above every other category.
export type VoiceIntent = "STOP" | "TRANSLATE" | "SUMMARIZE" | "SELECTIVE_READ" | "SCREEN_INTERPRETATION" | "READ" | "UNKNOWN";

export type VoiceCommandState = "IDLE" | "READING" | "SPEAKING";

export interface HandleTranscriptResult {
  transcript: string;
  intent: VoiceIntent;
  /**
   * What the dispatcher actually did with this intent.
   * "IGNORED" — UNKNOWN speech, a READ-family intent that arrived while
   * already busy (never queued, never guessed), or a SELECTIVE_READ whose
   * target couldn't be resolved from the transcript alone.
   * "NOT_AVAILABLE" — a real intent was correctly recognized, but no real
   * local capability exists to execute it yet (TRANSLATE, SUMMARIZE, and
   * the mouse/selection-based SELECTIVE_READ phrases — see
   * ./dispatcher.ts's header for what was checked before landing here).
   * Never silently downgraded to a different action instead.
   */
  action: "STARTED_READ" | "STARTED_SCREEN_INTERPRETATION" | "STARTED_SELECTIVE_READ" | "CANCELLED" | "IGNORED" | "NOT_AVAILABLE";
  state_before: VoiceCommandState;
  state_after: VoiceCommandState;
  correlation_id: string;
}
