// Thai Colloquial Normalization Layer (owner, 2026-07-30): "ตัวแปลภาษาที่
// เฮียสร้างไว้ เอามาใช้บวกกับ AI บวกกับระบบไหม...ทำไมมันคำถามไม่ลึกเลยนะ" —
// real bug found live: "วันที่ห้ามีฝนมั้ย" didn't match cognitive/pipeline.ts's
// weather/date patterns at all, because "มั้ย" (spoken/informal) isn't
// "ไหม" (written) and "ห้า" (Thai number word) isn't "5" (digit) — the
// pattern-matching layer only ever looked for the formal/digit forms.
// Rather than patching one literal spelling at a time forever (found via
// grep: `services/ai/translator.ts`, an earlier attempt at a similar
// translation layer, is itself unused/orphaned — confirmed zero importers —
// so it never actually solved this either), this is a real normalization
// step: informal/spoken Thai → one canonical form, run BEFORE any
// intent/fact pattern in the pipeline tries to match. Deterministic string
// substitution only — never a guess, never an LLM call (ห้ามเดา).

// Thai number-words for calendar days 1–31 — a bounded, known set (not
// general free-form Thai numeral parsing, which is a much bigger problem);
// scoped exactly to what "วันที่ <word>" ever needs.
const THAI_DAY_WORDS: Record<string, number> = {
  "หนึ่ง": 1, "เอ็ด": 1, "สอง": 2, "สาม": 3, "สี่": 4, "ห้า": 5,
  "หก": 6, "เจ็ด": 7, "แปด": 8, "เก้า": 9, "สิบ": 10,
  "สิบเอ็ด": 11, "สิบสอง": 12, "สิบสาม": 13, "สิบสี่": 14, "สิบห้า": 15,
  "สิบหก": 16, "สิบเจ็ด": 17, "สิบแปด": 18, "สิบเก้า": 19, "ยี่สิบ": 20,
  "ยี่สิบเอ็ด": 21, "ยี่สิบสอง": 22, "ยี่สิบสาม": 23, "ยี่สิบสี่": 24, "ยี่สิบห้า": 25,
  "ยี่สิบหก": 26, "ยี่สิบเจ็ด": 27, "ยี่สิบแปด": 28, "ยี่สิบเก้า": 29, "สามสิบ": 30,
  "สามสิบเอ็ด": 31,
};
// Longest-first so "ยี่สิบเอ็ด" matches before "ยี่สิบ"/"เอ็ด" alone do.
const THAI_DAY_WORDS_BY_LENGTH = Object.keys(THAI_DAY_WORDS).sort((a, b) => b.length - a.length);

// Common spoken/slang ↔ formal-written equivalents actually seen live.
const COLLOQUIAL_REPLACEMENTS: [RegExp, string][] = [
  [/มั้ย/g, "ไหม"],
  [/ป่าว(?!ยาก)/g, "เปล่า"], // "ป่าว" alone = "เปล่า"; don't touch "ปล่าวยาก" (not a real word, just a safety guard against odd matches)
  [/เหรอ/g, "หรือ"],
  [/ป่ะ/g, "หรือเปล่า"],
];

export function normalizeThaiColloquial(text: string): string {
  let out = text;
  for (const [pattern, replacement] of COLLOQUIAL_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  // "วันที่<Thai number word>" -> "วันที่<digit>" (e.g. "วันที่ห้า" -> "วันที่5")
  for (const word of THAI_DAY_WORDS_BY_LENGTH) {
    out = out.replace(new RegExp(`วันที่\\s*${word}(?!\\s*บาท)`, "g"), `วันที่${THAI_DAY_WORDS[word]}`);
  }
  return out;
}
