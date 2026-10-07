/**
 * หน้าที่: the public boundary of `connections/voice-command/` — the
 * only file another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Input: re-exports only.
 * Output: `handleTranscript`, `getVoiceCommandState`,
 * `resolveVoiceIntent`, plus every type a caller needs.
 * Dependency ที่อนุญาต: ./dispatcher.ts, ./intent-resolver.ts, ./types.ts.
 */

export { handleTranscript, getVoiceCommandState } from "./dispatcher";
export { resolveVoiceIntent } from "./intent-resolver";
export type { VoiceIntent, VoiceCommandState, HandleTranscriptResult } from "./types";
