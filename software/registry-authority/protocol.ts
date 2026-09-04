/**
 * สัญญาการขอเขียนทะเบียนผ่านผู้มีอำนาจ
 *
 * เหตุผลที่ต้องมี: canonical registry คือข้อมูลที่ Write Gate ใช้ตัดสินสิทธิ์เขียน
 * พิสูจน์แล้วว่าการเติมสามบรรทัดลงไฟล์ พลิกคำตัดสินจาก DENY เป็น ALLOW_MODIFY ได้
 * ตราบใดที่ tam เขียนไฟล์นั้นตรงได้ ชั้นตรวจสอบทั้งหมดข้างบนไม่มีความหมาย
 *
 * คำขอบรรยาย "ปฏิบัติการที่ต้องการ" เท่านั้น ไม่มีช่องใส่ path ไม่มีช่องใส่คำสั่ง
 * ผู้มีอำนาจเป็นคนกำหนดปลายทางเองจากค่าคงที่ในตัวมัน
 */

/** ปฏิบัติการที่ผู้มีอำนาจรู้จัก — ตรงกับ KNOWN_MUTATION_TYPES ของ registration-update */
export type AuthorityOperation =
  | "ADD_RELATIONSHIP" | "REMOVE_RELATIONSHIP" | "ADD_EVIDENCE" | "ADD_VERSION" | "RETIRE"
  | "WRITE_APPROVED_CANDIDATE" | "APPEND_REGISTRATION_EVENT";

export const KNOWN_AUTHORITY_OPERATIONS: ReadonlySet<string> = new Set<AuthorityOperation>([
  "ADD_RELATIONSHIP", "REMOVE_RELATIONSHIP", "ADD_EVIDENCE", "ADD_VERSION", "RETIRE",
  "WRITE_APPROVED_CANDIDATE", "APPEND_REGISTRATION_EVENT",
]);

/** ตารางที่เขียนได้ — ผู้มีอำนาจปฏิเสธชื่ออื่นทั้งหมด ไม่ว่าคำขอจะบอกอะไร */
export const WRITABLE_TABLES: ReadonlySet<string> = new Set([
  "capabilities", "resources", "resource_capabilities", "relationships",
  "relationships_removed", "versions", "evidence", "registration_events",
]);

export interface AuthorityRequest {
  readonly request_id: string;
  readonly created_at: string;
  readonly requester: string;
  readonly operation: AuthorityOperation;
  /** ตารางปลายทาง — ต้องอยู่ใน WRITABLE_TABLES เท่านั้น */
  readonly table: string;
  /** แถวที่จะต่อท้าย — ไม่มีความหมายเชิง path ใด ๆ */
  readonly row: Record<string, unknown>;
}

export interface AuthorityResult {
  readonly request_id: string;
  readonly status: "APPLIED" | "REJECTED";
  readonly reason_code: string | null;
  readonly decided_at: string;
}

const ID = /^[A-Za-z0-9_-]{8,64}$/;

/** ฟิลด์ที่ถ้าโผล่มาในคำขอ = ปฏิเสธทันที ไม่ใช่เพิกเฉย */
export const FORBIDDEN_REQUEST_FIELDS: readonly string[] = [
  "path", "file", "dir", "target_path", "dataDir", "canonicalDir",
  "command", "shell", "exec", "script", "argv", "chmod", "chown", "chflags",
];

export type Validation =
  | { readonly ok: true; readonly request: AuthorityRequest }
  | { readonly ok: false; readonly reason_code: string; readonly detail: string };

export function validateAuthorityRequest(raw: unknown): Validation {
  const deny = (c: string, d: string): Validation => ({ ok: false, reason_code: c, detail: d });
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return deny("NOT_AN_OBJECT", typeof raw);
  const o = raw as Record<string, unknown>;
  for (const f of FORBIDDEN_REQUEST_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(o, f)) return deny("FORBIDDEN_FIELD", f);
  }
  if (typeof o.request_id !== "string" || !ID.test(o.request_id)) return deny("BAD_REQUEST_ID", String(o.request_id));
  if (typeof o.created_at !== "string" || Number.isNaN(Date.parse(o.created_at))) return deny("BAD_CREATED_AT", String(o.created_at));
  if (typeof o.requester !== "string" || o.requester.length === 0) return deny("BAD_REQUESTER", "ต้องระบุผู้ขอ");
  if (typeof o.operation !== "string" || !KNOWN_AUTHORITY_OPERATIONS.has(o.operation)) return deny("UNKNOWN_OPERATION", String(o.operation));
  if (typeof o.table !== "string" || !WRITABLE_TABLES.has(o.table)) return deny("TABLE_NOT_WRITABLE", String(o.table));
  if (typeof o.row !== "object" || o.row === null || Array.isArray(o.row)) return deny("BAD_ROW", "row ต้องเป็น object");
  for (const k of Object.keys(o.row as Record<string, unknown>)) {
    if (FORBIDDEN_REQUEST_FIELDS.includes(k)) return deny("FORBIDDEN_FIELD_IN_ROW", k);
  }
  return { ok: true, request: o as unknown as AuthorityRequest };
}
