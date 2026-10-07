/**
 * หน้าที่: บังคับว่า SQL ที่ส่งออกไปเป็น metadata read เท่านั้น
 *
 * ด่านนี้อยู่ฝั่งเรา ก่อนถึง read_only ของ Postgres — สองชั้นอิสระกัน
 * ถ้าชั้นใดชั้นหนึ่งพัง อีกชั้นยังกันอยู่
 *
 * Input: ข้อความ SQL
 * Output: ผ่าน หรือ เหตุผลที่ปฏิเสธ
 * สิ่งที่ห้ามแตะ:
 * - ห้ามผ่อนให้มีหลาย statement ในคำสั่งเดียว
 * - ห้ามอนุญาต schema นอก ALLOWED_SCHEMAS
 */

import { ALLOWED_SCHEMAS } from "./contract";

export type GuardVerdict =
  | { ok: true; sql: string }
  | { ok: false; reason_code: string; reason: string };

const FORBIDDEN_KEYWORDS = [
  "INSERT", "UPDATE", "DELETE", "TRUNCATE", "MERGE",
  "CREATE", "ALTER", "DROP", "GRANT", "REVOKE", "COMMENT",
  "COPY", "CALL", "DO", "VACUUM", "ANALYZE", "REINDEX",
  "SET", "RESET", "BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT",
  "PREPARE", "EXECUTE", "LISTEN", "NOTIFY", "LOCK",
];

/** ชื่อ schema ที่ปรากฏหลัง FROM/JOIN ต้องอยู่ในรายการที่อนุญาตทั้งหมด */
const SCHEMA_QUALIFIED = /\b(?:from|join)\s+([a-z_][a-z0-9_]*)\s*\./gi;

export function guardMetadataSql(raw: string): GuardVerdict {
  const sql = raw.trim().replace(/;+\s*$/, "");
  if (sql.length === 0) return { ok: false, reason_code: "EMPTY_SQL", reason: "ไม่มีคำสั่ง" };
  if (sql.length > 8000) return { ok: false, reason_code: "SQL_TOO_LONG", reason: "คำสั่งยาวเกินขอบเขตที่ตรวจได้" };

  // หลาย statement ในคำสั่งเดียวคือช่องทางแทรกคำสั่งเขียน
  if (sql.includes(";")) return { ok: false, reason_code: "MULTI_STATEMENT", reason: "อนุญาตทีละคำสั่งเท่านั้น" };
  if (sql.includes("--") || sql.includes("/*")) {
    return { ok: false, reason_code: "COMMENT_NOT_ALLOWED", reason: "คอมเมนต์ใน SQL ใช้ซ่อนคำสั่งได้ จึงไม่อนุญาต" };
  }
  if (!/^(select|with)\b/i.test(sql)) {
    return { ok: false, reason_code: "NOT_A_READ", reason: "ต้องขึ้นต้นด้วย SELECT หรือ WITH เท่านั้น" };
  }

  const upper = sql.toUpperCase();
  for (const kw of FORBIDDEN_KEYWORDS) {
    if (new RegExp(`(^|[^A-Z0-9_])${kw}([^A-Z0-9_]|$)`).test(upper)) {
      return { ok: false, reason_code: "FORBIDDEN_KEYWORD", reason: `พบคำสั่งที่ไม่อนุญาต: ${kw}` };
    }
  }

  const referenced = [...sql.matchAll(SCHEMA_QUALIFIED)].map((m) => m[1].toLowerCase());
  if (referenced.length === 0) {
    return { ok: false, reason_code: "UNQUALIFIED_SOURCE", reason: "ต้องระบุ schema ให้ชัดเจน เช่น information_schema.tables" };
  }
  const outside = referenced.filter((s) => !ALLOWED_SCHEMAS.includes(s as (typeof ALLOWED_SCHEMAS)[number]));
  if (outside.length > 0) {
    return { ok: false, reason_code: "SCHEMA_NOT_ALLOWED", reason: `อ่านได้เฉพาะ ${ALLOWED_SCHEMAS.join(", ")} — พบ ${[...new Set(outside)].join(", ")}` };
  }

  return { ok: true, sql };
}
