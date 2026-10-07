/**
 * หน้าที่: INTENT RESOLVER — the ONE deterministic function that turns a
 * transcribed utterance (already real text from Speech-to-Text) into a
 * `VoiceIntent`. Fixed keyword/phrase sets only — no AI inference, no
 * fuzzy scoring, no LLM call, matching this file's original discipline.
 *
 * 2026-08-21 addition (Owner instruction — Natural Voice Output Intent):
 * extended from the original binary READ|STOP|UNKNOWN into
 * STOP|TRANSLATE|SUMMARIZE|SELECTIVE_READ|SCREEN_INTERPRETATION|READ|
 * UNKNOWN, checked in that EXACT order, first match wins, no exceptions.
 * STOP is checked FIRST and returns immediately — never re-checked
 * against any other category, never subject to an "ambiguous, return
 * UNKNOWN" fallback the way READ/STOP used to be — this is a deliberate
 * priority rule: "STOP ต้องมี priority สูงกว่า SPEAK/READ/TRANSLATE/
 * SUMMARY ทุกชนิด" means a phrase like "ไม่ต้องอ่าน" (which contains the
 * substring "อ่าน" and would otherwise also match READ) must resolve to
 * STOP, full stop — never UNKNOWN, never READ.
 *
 * Input: a real transcript string.
 * Output: `resolveVoiceIntent` -> `VoiceIntent`.
 * Dependency ที่อนุญาต: ./types.ts.
 * สิ่งที่ห้ามแตะ: never call an LLM/AI adapter here — every keyword/phrase
 * set below is fixed, reviewed, deterministic text matching only.
 */

import type { VoiceIntent } from "./types";

// Absolute priority — checked first, matched, returned immediately. See
// header. "พอแล้ว"/"เข้าใจแล้วพอ" already resolve via the "พอ" substring;
// "ไม่ต้องพูด"/"ไม่ต้องอ่าน" need their own entries (the latter contains
// "อ่าน" but must still resolve STOP, never READ).
const STOP_KEYWORDS = ["หยุด", "พอ", "เงียบ", "ไม่ต้องพูด", "ไม่ต้องอ่าน", "stop"];

// "แปลภาษา"/translate-the-language phrasing — deliberately distinct from
// SCREEN_INTERPRETATION_PHRASES's "แปลความหมาย"/"ตีความหมาย" (explain
// the meaning) below, even though both start with "แปล", so
// "แปลความหมายหน้าจอให้หน่อย" resolves SCREEN_INTERPRETATION, not
// TRANSLATE, matching the Owner's own example categorization.
const TRANSLATE_PHRASES = ["แปลภาษาอังกฤษ", "แปลเป็นไทย", "ให้เป็นภาษาไทย", "ตรงกับความหมายบนหน้าจอ"];

const SUMMARIZE_KEYWORDS = ["สรุป"];

// Mouse/cursor-position phrases ("เมาส์คลุม"/"เมาส์ชี้") and "อ่านตรงนี้"/
// "ส่วนที่เลือก" are classified here correctly, but ../dispatcher.ts
// reports them NOT_AVAILABLE at execution time — no mouse-position/text-
// selection API exists in ../os-ui/screen-reader.ts today (checked
// before building, see ./README.md). Only "บรรทัดที่ N" (line number)
// and "ย่อหน้าสุดท้าย" (last paragraph) have real, deterministic
// execution, since both are resolvable from read_screen's own text.
const SELECTIVE_READ_PHRASES = ["บรรทัดที่", "ย่อหน้า", "อ่านตรงนี้", "เมาส์คลุม", "เมาส์ชี้", "ส่วนที่เลือก"];

const SCREEN_INTERPRETATION_PHRASES = ["หน้าจอมันเขียนว่า", "หน้าจอมันอ่านว่า", "แปลความหมายหน้าจอ", "ตีความหมายหน้าจอ"];

// "พูดต่อ" doesn't contain "อ่าน" and needs its own entry; every other
// READ example the Owner gave ("อ่านให้ฟังหน่อย", "อ่านต่อ", "อ่านทั้งหมด",
// "อ่านทั้งหมดได้เลย") already contains "อ่าน" as a substring.
const READ_KEYWORDS = ["อ่าน", "read", "พูดต่อ"];

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

function containsAny(text: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => text.includes(phrase));
}

export function resolveVoiceIntent(rawText: string): VoiceIntent {
  const text = normalize(rawText);
  if (text.length === 0) return "UNKNOWN";

  if (containsAny(text, STOP_KEYWORDS)) return "STOP";
  if (containsAny(text, TRANSLATE_PHRASES)) return "TRANSLATE";
  if (containsAny(text, SUMMARIZE_KEYWORDS)) return "SUMMARIZE";
  if (containsAny(text, SELECTIVE_READ_PHRASES)) return "SELECTIVE_READ";
  if (containsAny(text, SCREEN_INTERPRETATION_PHRASES)) return "SCREEN_INTERPRETATION";
  if (containsAny(text, READ_KEYWORDS)) return "READ";
  return "UNKNOWN";
}
