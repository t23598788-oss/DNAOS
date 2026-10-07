/**
 * หน้าที่: ประกาศขอบเขตของ capability supabase.schema.read
 *
 * Owner, 2026-09-05: ต้องการเส้นทางอ่าน live schema แบบ read-only และ bounded
 * เพื่อปิด UNKNOWN ของตาราง attachments/documents โดยไม่แตะข้อมูลธุรกิจ
 *
 * ไฟล์นี้เป็นสัญญา ไม่ใช่โค้ดทำงาน — ตัวบังคับอยู่ที่ ./guard.ts
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเพิ่ม operation ที่เขียนได้เข้า ALLOWED_OPERATIONS
 * - ห้ามเพิ่ม schema ธุรกิจเข้า ALLOWED_SCHEMAS
 */

export const CAPABILITY = "supabase.schema.read" as const;

export const CREDENTIAL_REF = "credential://supabase/xeytcavxejhyzxwevgto/schema-read" as const;

/** ใช้ซ้ำจาก Supabase CLI ที่เจ้าของยืนยันตัวตนไว้แล้ว — ไม่มีการสร้าง secret ใหม่ */
export const KEYCHAIN_SERVICE = "Supabase CLI" as const;
export const KEYCHAIN_ACCOUNT = "supabase" as const;

export const PROJECT_REF = "xeytcavxejhyzxwevgto" as const;

export const SCOPE = "SCHEMA_READ_ONLY" as const;

/** schema ที่อ่านได้ — metadata เท่านั้น ไม่มี public หรือ schema ธุรกิจใด ๆ */
export const ALLOWED_SCHEMAS = ["information_schema", "pg_catalog"] as const;

export const ALLOWED_OPERATIONS = ["SELECT_METADATA"] as const;

export const DENIED_OPERATIONS = [
  "INSERT", "UPDATE", "DELETE", "TRUNCATE",
  "CREATE", "ALTER", "DROP", "GRANT", "REVOKE",
  "RLS_MUTATION", "AUTH_MUTATION", "STORAGE_MUTATION",
] as const;

/** ปลายทางที่เรียกได้ — มีเท่านี้ ทั้งสองอ่านอย่างเดียว */
export const MANAGEMENT_QUERY_ENDPOINT =
  `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query` as const;

/**
 * สัญญาชนิดข้อมูลที่ Supabase สร้างจาก live schema — GET อย่างเดียวโดยธรรมชาติ
 * Owner, 2026-09-05 ข้อ 7: ให้เก็บ snapshot ของสัญญาถ้าดึงได้ผ่าน capability เดิม
 * เพิ่มเป็นปลายทางที่สองแบบประกาศชื่อ ไม่ได้เปิดให้เรียก endpoint อะไรก็ได้
 */
export const MANAGEMENT_TYPES_ENDPOINT =
  `https://api.supabase.com/v1/projects/${PROJECT_REF}/types/typescript` as const;
