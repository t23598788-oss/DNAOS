/**
 * หน้าที่: อ่านข้อมูลการเงินของ production แบบจำกัดคอลัมน์ เพื่อตรวจสายการชำระเงิน
 *
 * Owner สั่งตรวจสายการเงินจากข้อมูลจริงแบบ read-only เมื่อ 2026-09-05
 * capability นี้แยกจาก supabase.schema.read (ที่อ่านได้เฉพาะ metadata) และแยก
 * จาก business_events.classify_read — เพราะขอบเขตต่างกัน จึงไม่เอามารวมกัน
 *
 * คอลัมน์ที่อ่านได้จำกัดไว้เท่าที่ตรวจสายเงินต้องใช้: ไม่มีชื่อคน ไม่มีเบอร์โทร
 * ไม่มีที่อยู่ ไม่มีเลขบัญชี — มีแต่ตัวชี้ ยอดเงิน สถานะ และเวลา
 *
 * Dependency ที่อนุญาต: ./contract.ts credentials/macos-keychain
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเพิ่มคอลัมน์ที่ระบุตัวบุคคลหรือเลขบัญชี
 * - ห้ามเขียนอะไรกลับไป ทุกคำสั่งวิ่งใน read-only transaction
 */

import { MacOsKeychainProvider } from "../../credentials/macos-keychain/provider";
import { KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE, MANAGEMENT_QUERY_ENDPOINT } from "./contract";

export const CAPABILITY = "supabase.finance.audit_read" as const;

/** ตารางและคอลัมน์ที่อนุญาต — นอกรายการนี้ปฏิเสธ */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  receipt_documents: [
    "id", "customer_company_id", "document_type", "status", "amount",
    "transaction_datetime", "matched_debt_event_id", "payment_verified",
    "line_event_id", "reference_number", "created_at", "media_path", "raw_ocr_text",
  ],
  debt_events: ["id", "customer_company_id", "event_type", "amount", "occurred_at", "source", "created_at"],
  debt_snapshots: ["customer_company_id", "total_outstanding", "collection_state", "overdue_amount", "updated_at"],
  // อนุมัติโดยเจ้าของ 2026-09-05 (chal-2bdd4156) — เฉพาะคอลัมน์ควบคุมงาน
  // ไม่มี input_text ไม่มี media_path ไม่มีข้อมูลลูกค้า
  ai_tasks: ["id", "kind", "status", "created_at", "processed_at", "line_event_id", "error"],
  // อนุมัติโดยเจ้าของ 2026-09-05 (chal-c8bbf283) — สำรวจแหล่งข้อมูลย้อนหลัง
  // line_events อ่านเฉพาะ metadata ไม่อ่าน message_text/ชื่อ
  line_events: ["id", "raw_type", "event_type", "line_message_id", "created_at", "status", "media_path", "raw_file_url", "direction"],
  bank_statement_transactions: ["id", "amount", "kind", "transaction_date", "channel", "matched_receipt_document_id", "created_at"],
  company_expenses: ["id", "receipt_document_id", "document_type", "amount", "amount_pre_vat", "vat_amount", "expense_date", "tax_invoice_no", "created_at"],
  objects: ["id", "name", "bucket_id", "created_at", "updated_at"],
  // อนุมัติโดยเจ้าของ 2026-09-05 (chal-55cda0ef) — ปิดงบรายเดือน
  invoices: ["id", "invoice_no", "invoice_status", "customer_company_id", "invoice_date", "subtotal", "vat_amount", "total_amount", "paid_amount", "created_at"],
  standalone_documents: ["id", "document_no", "document_type", "document_date", "customer_company_id", "subtotal", "vat_amount", "total_amount", "status", "created_at"],
  // อนุมัติโดยเจ้าของ 2026-09-05 (chal-c9b39c12) — งบจากเอกสารต้นฉบับ
  // รายการในเอกสาร: คำอธิบายสินค้า/บริการ จำนวน หน่วย ราคา ไม่มีชื่อหรือที่อยู่ลูกค้า
  invoice_items: ["id", "invoice_id", "description", "qty", "unit", "unit_price", "line_total", "sort_order", "created_at"],
  standalone_document_items: ["id", "document_id", "description", "qty", "unit", "unit_price", "sort_order", "created_at"],
  // อนุมัติโดยเจ้าของ 2026-09-05 (chal-38831ba5) — ตรวจสายเงินออก
  // ไม่อ่าน partner_name / partner_line_user_id / description
  partner_payable_requests: ["id", "partner_company_id", "amount", "business_event_id", "status",
    "owner_notified_at", "owner_acknowledged_at", "paid_line_event_id", "bank_email_verified",
    "completed_at", "created_at"],
  bank_notifications: ["id", "gmail_message_id", "amount", "reference_number", "transaction_datetime", "matched_receipt_document_id", "created_at"],
};

export type AuditRow = Record<string, unknown>;

export async function financeAuditRead(
  table: keyof typeof ALLOWED,
  options: { columns?: readonly string[]; where?: string; orderBy?: string; limit?: number } = {},
): Promise<{ ok: true; rows: readonly AuditRow[] } | { ok: false; reason_code: string; reason: string }> {
  const allowed = ALLOWED[table];
  if (allowed === undefined) return { ok: false, reason_code: "TABLE_NOT_ALLOWED", reason: `อ่าน ${table} ไม่ได้` };

  const cols = options.columns ?? allowed;
  const bad = cols.filter((c) => !allowed.includes(c));
  if (bad.length > 0) return { ok: false, reason_code: "COLUMN_NOT_ALLOWED", reason: `คอลัมน์ที่ไม่อนุญาต: ${bad.join(", ")}` };

  // where ต้องเป็นเงื่อนไขง่าย ๆ ที่อ้างเฉพาะคอลัมน์ที่อนุญาต และห้ามมีคำสั่งซ้อน
  const where = options.where ?? "";
  if (where !== "") {
    if (/[;]|--|\/\*/.test(where)) return { ok: false, reason_code: "UNSAFE_FILTER", reason: "เงื่อนไขมีอักขระที่ใช้แทรกคำสั่งได้" };
    const idents = [...where.matchAll(/[a-z_][a-z0-9_]*/gi)].map((m) => m[0].toLowerCase());
    const keywords = new Set(["is", "not", "null", "and", "or", "true", "false", "in", "like"]);
    const unknown = idents.filter((i) => !allowed.includes(i) && !keywords.has(i));
    if (unknown.length > 0) return { ok: false, reason_code: "FILTER_COLUMN_NOT_ALLOWED", reason: `เงื่อนไขอ้างถึง: ${unknown.join(", ")}` };
  }

  const limit = Math.min(Math.max(options.limit ?? 200, 1), 2000);
  const order = options.orderBy !== undefined && allowed.includes(options.orderBy) ? `order by ${options.orderBy} desc` : "";
  const schema = table === "objects" ? "storage" : "public";
  const sql = `select ${cols.join(", ")} from ${schema}.${table}${where ? ` where ${where}` : ""} ${order} limit ${limit}`;

  const provider = new MacOsKeychainProvider();
  const cred = await provider.resolve({ service: KEYCHAIN_SERVICE, account: KEYCHAIN_ACCOUNT, kind: "oauth_token" });
  if (!cred.ok) return { ok: false, reason_code: `KEYCHAIN_${cred.code}`, reason: cred.reason };

  try {
    const res = await fetch(MANAGEMENT_QUERY_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${cred.secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql, read_only: true }),
    });
    const body = await res.text();
    if (res.status !== 200 && res.status !== 201) return { ok: false, reason_code: `HTTP_${res.status}`, reason: body.slice(0, 300) };
    const parsed = JSON.parse(body);
    return { ok: true, rows: Array.isArray(parsed) ? parsed : (parsed?.result ?? []) };
  } catch (e) {
    return { ok: false, reason_code: "TRANSPORT_FAILED", reason: (e as Error).message };
  }
}
