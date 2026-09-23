// ตัวช่วยกลางของ canonical generators — ทำให้ rerun บน source เดิมได้ไฟล์เดิม (idempotent)
//
// ONE IMPLEMENTATION · THREE CONSUMERS:
//   scripts/build-arch-book.ts · scripts/build-system-control-graph.ts · scripts/build-governance-summary.ts
//
// ไม่แตะความหมายของข้อมูล: เก็บค่า generated_at เดิมไว้ "เฉพาะเมื่อ" เนื้อหาส่วนที่เหลือเหมือนเดิม
// ทุกไบต์ — ถ้าเนื้อหาเปลี่ยนจริง timestamp จึงขยับ (เป็นเวลาที่เนื้อหานั้นเกิดขึ้นจริง)
import { existsSync, readFileSync } from "fs";

/**
 * Serialize โดยไม่ขึ้นกับลำดับ key ของ object — ใช้ "เทียบ" เนื้อหา 2 ก้อนเท่านั้น
 * ไม่ได้ใช้เขียนไฟล์ (ไฟล์ที่เขียนยังใช้ JSON.stringify ปกติ เหมือนเดิมทุกบรรทัด)
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * คืนค่า generated_at ที่ควรใช้กับ output ไฟล์ที่กำลังจะเขียน:
 *   - ถ้าไฟล์เดิมมีอยู่ และเนื้อหาส่วนที่เหลือ (ตัด generated_at ออก) เหมือนกับ content ที่เพิ่งสร้าง
 *     → คืนค่าเดิม ⇒ รันซ้ำบน source เดิมได้ไฟล์ byte-identical
 *   - ถ้าเนื้อหาเปลี่ยนจริง / ไฟล์เดิมอ่านไม่ได้ / ยังไม่มีไฟล์ → คืนเวลาปัจจุบัน (พฤติกรรมเดิม)
 */
export function stableGeneratedAt(existingFilePath: string, content: Record<string, unknown>): string {
  try {
    if (existsSync(existingFilePath)) {
      const previous = JSON.parse(readFileSync(existingFilePath, "utf-8")) as Record<string, unknown>;
      const previousAt = previous?.generated_at;
      if (typeof previousAt === "string" && previousAt) {
        const previousContent: Record<string, unknown> = { ...previous };
        const nextContent: Record<string, unknown> = { ...content };
        delete previousContent.generated_at;
        delete nextContent.generated_at;
        if (canonicalJson(previousContent) === canonicalJson(nextContent)) return previousAt;
      }
    }
  } catch {
    // ไฟล์เดิมเสียหาย/อ่านไม่ได้ ⇒ ตกไปใช้เวลาปัจจุบัน (ไม่ throw ให้ pipeline ล้ม)
  }
  return new Date().toISOString();
}
