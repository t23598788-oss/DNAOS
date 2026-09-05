/**
 * หน้าที่: แยกให้ขาดว่า from("x") ตัวไหนคือตาราง ตัวไหนคือ storage bucket
 *
 * Owner, 2026-09-05 ข้อ 1: `supabase.from("x")` ไม่เท่ากับ `supabase.storage.from("x")`
 * ต้องแยกแบบ deterministic
 *
 * ที่มา: catalog เดิมใช้ regex `from\("..."\)` ตัวเดียว ทำให้ bucket ชื่อ
 * `attachments` ถูกบันทึกเป็นตาราง แล้วไปโผล่เป็น "ตารางที่หายไปจาก production"
 * ทั้งที่ production ไม่เคยต้องมีตารางนั้น — ตรวจผิด ไม่ใช่ระบบผิด
 *
 * Input: บรรทัดซอร์สหนึ่งบรรทัด
 * Output: รายการการอ้างถึงพร้อมชนิดที่จำแนกแล้ว
 * Dependency ที่อนุญาต: ไม่มี
 * สิ่งที่ห้ามแตะ:
 * - ห้ามรวมสองรูปแบบกลับเป็น regex เดียว
 * - ห้ามเดาชนิดจากชื่อ ต้องดูรูปประโยคเท่านั้น
 */

export type DataObjectKind = "TABLE" | "STORAGE_BUCKET";

export interface FromReference {
  readonly name: string;
  readonly kind: DataObjectKind;
  /** ข้อความจริงที่ทำให้ตัดสินแบบนี้ — ใช้ตรวจย้อนได้ */
  readonly matched: string;
}

/** `.storage.from("x")` — ต้องจับก่อน เพราะมันมี `.from(` อยู่ในตัว */
const BUCKET = /\.storage\s*\.\s*from\(\s*["'`]([A-Za-z0-9_\-]+)["'`]\s*\)/g;
/** `.from("x")` ทั่วไป */
const ANY_FROM = /\.from\(\s*["'`]([A-Za-z0-9_\-]+)["'`]\s*\)/g;

/**
 * ตัดคอมเมนต์ออกก่อนจำแนก
 *
 * เจอจริง 2026-09-05: `scanSupabaseFunctions.ts:4` เขียนอธิบายว่าตัวเองสแกน
 * `.from("table_name")` — ข้อความในคอมเมนต์นั้นถูกนับเป็นตารางชื่อ table_name
 * แล้วรายงานว่า "production ขาดตาราง" ทั้งที่ไม่มีใครเรียกจริง
 */
function stripComments(line: string): string {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return "";
  const idx = line.indexOf("//");
  return idx === -1 ? line : line.slice(0, idx);
}

export function classifyFromCalls(rawLine: string): readonly FromReference[] {
  const line = stripComments(rawLine);
  const out: FromReference[] = [];
  const bucketSpans: [number, number][] = [];

  for (const m of line.matchAll(BUCKET)) {
    const start = m.index ?? 0;
    bucketSpans.push([start, start + m[0].length]);
    out.push({ name: m[1], kind: "STORAGE_BUCKET", matched: m[0] });
  }
  for (const m of line.matchAll(ANY_FROM)) {
    const start = m.index ?? 0;
    // ถ้า `.from(` นี้อยู่ในช่วงที่ `.storage.from(` กินไปแล้ว อย่านับซ้ำเป็นตาราง
    const insideBucket = bucketSpans.some(([s, e]) => start >= s && start + m[0].length <= e);
    if (!insideBucket) out.push({ name: m[1], kind: "TABLE", matched: m[0] });
  }
  return out;
}
