/**
 * หน้าที่: แก้แถวเดียวที่พิสูจน์แล้วว่าเก็บปี พ.ศ. ไว้ — ใช้ครั้งเดียวจบ
 *
 * Owner อนุมัติด้วย Touch ID เมื่อ 2026-09-05 (chal-6f74a2c7, CLASS_4) สำหรับ
 * SLICE_C เท่านั้น
 *
 * ทุกอย่างในไฟล์นี้ถูกล็อกไว้แคบที่สุดเท่าที่ทำได้:
 * - แก้ได้ตารางเดียว คอลัมน์เดียว
 * - ต้องระบุ id ตรงตัว
 * - ต้องผ่านด่านว่าค่าปัจจุบันเป็นปีในช่วง 2500-2600 จริง ไม่งั้นปฏิเสธ
 * - ค่าใหม่คำนวณด้วยกฎเดียวกับที่ deploy ขึ้น production
 *
 * Dependency ที่อนุญาต: ./contract.ts credentials/macos-keychain
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเพิ่มตารางหรือคอลัมน์อื่นเข้ามาในไฟล์นี้
 * - ห้ามแก้หลายแถวในคำสั่งเดียว
 */

import { MacOsKeychainProvider } from "../../credentials/macos-keychain/provider";
import { KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE, MANAGEMENT_QUERY_ENDPOINT } from "./contract";

export const AUTHORIZATION_EVIDENCE = "verification-challenges.jsonl#chal-6f74a2c7-f92e-4267-869f-87b2edbb382f" as const;

const BE_MIN = 2500;
const BE_MAX = 2600;
const BE_OFFSET = 543;

/** กฎเดียวกับ supabase/functions/line-webhook-v2/engines/thai-year.ts */
export function normalizeThaiYear(value: string): { value: string; converted: boolean } {
  const m = value.match(/^(\d{4})(-\d{2}-\d{2}.*)$/);
  if (m === null) return { value, converted: false };
  const year = Number(m[1]);
  if (year < BE_MIN || year > BE_MAX) return { value, converted: false };
  return { value: String(year - BE_OFFSET) + m[2], converted: true };
}

async function run(sql: string): Promise<{ ok: true; rows: Record<string, unknown>[] } | { ok: false; reason: string }> {
  const provider = new MacOsKeychainProvider();
  const cred = await provider.resolve({ service: KEYCHAIN_SERVICE, account: KEYCHAIN_ACCOUNT, kind: "oauth_token" });
  if (!cred.ok) return { ok: false, reason: `KEYCHAIN_${cred.code}` };
  const res = await fetch(MANAGEMENT_QUERY_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${cred.secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.text();
  if (res.status !== 200 && res.status !== 201) return { ok: false, reason: `HTTP_${res.status}: ${body.slice(0, 200)}` };
  const parsed = JSON.parse(body);
  return { ok: true, rows: Array.isArray(parsed) ? parsed : (parsed?.result ?? []) };
}

export interface RepairResult {
  readonly id: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly applied: boolean;
  readonly reason: string;
}

export async function repairExpenseDate(rowId: string, apply: boolean): Promise<RepairResult> {
  if (!/^[0-9a-f-]{36}$/.test(rowId)) return { id: rowId, before: null, after: null, applied: false, reason: "รูปแบบ id ไม่ถูกต้อง" };

  const read = await run(`select id, expense_date::text as expense_date from public.company_expenses where id = '${rowId}'`);
  if (!read.ok) return { id: rowId, before: null, after: null, applied: false, reason: read.reason };
  if (read.rows.length !== 1) return { id: rowId, before: null, after: null, applied: false, reason: `พบ ${read.rows.length} แถว ต้องเป็น 1 เท่านั้น` };

  const before = String(read.rows[0].expense_date ?? "");
  const norm = normalizeThaiYear(before);
  if (!norm.converted) {
    return { id: rowId, before, after: before, applied: false, reason: `ค่าปัจจุบัน "${before}" ไม่ใช่ปีในช่วง ${BE_MIN}-${BE_MAX} — ปฏิเสธการแก้` };
  }
  if (!apply) return { id: rowId, before, after: norm.value, applied: false, reason: "โหมดจำลอง ไม่ได้เขียน" };

  // เงื่อนไขใน where ป้องกันการเขียนทับถ้ามีใครแก้ไปก่อนหน้า
  const upd = await run(
    `update public.company_expenses set expense_date = '${norm.value}' ` +
    `where id = '${rowId}' and expense_date::text = '${before}' returning id, expense_date::text as expense_date`,
  );
  if (!upd.ok) return { id: rowId, before, after: null, applied: false, reason: upd.reason };
  const after = upd.rows.length === 1 ? String(upd.rows[0].expense_date) : null;
  return { id: rowId, before, after, applied: upd.rows.length === 1, reason: upd.rows.length === 1 ? "แก้แล้วหนึ่งแถว" : "ไม่มีแถวถูกแก้ (ค่าอาจเปลี่ยนไปแล้ว)" };
}
