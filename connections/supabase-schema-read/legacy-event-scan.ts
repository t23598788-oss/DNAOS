/**
 * หน้าที่: อ่าน business_events แบบจำกัดคอลัมน์ เพื่อจำแนกแถวเก่าเท่านั้น
 *
 * Owner อนุมัติด้วย Touch ID เมื่อ 2026-09-05 (chal-8fac2350) สำหรับการสแกน
 * แบบอ่านอย่างเดียว งานนี้จึงมี capability ของตัวเองแยกต่างหาก — ไม่ได้ไปผ่อน
 * guard ของ supabase.schema.read ซึ่งตั้งใจให้อ่านได้เฉพาะ metadata
 *
 * คอลัมน์ที่อ่านได้ถูกจำกัดไว้เท่าที่ตัวจำแนกต้องใช้จริง ไม่มีชื่อลูกค้า
 * ไม่มีเบอร์โทร ไม่มีจำนวนเงิน
 *
 * Dependency ที่อนุญาต: ./client.ts ./contract.ts
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเพิ่มคอลัมน์ที่เป็นข้อมูลส่วนบุคคลหรือจำนวนเงินเข้า ALLOWED_COLUMNS
 * - ห้ามเขียนอะไรกลับไปที่ production
 */

import { MacOsKeychainProvider } from "../../credentials/macos-keychain/provider";
import { KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE, MANAGEMENT_QUERY_ENDPOINT } from "./contract";

export const CAPABILITY = "supabase.business_events.classify_read" as const;
export const AUTHORIZATION_EVIDENCE = "verification-challenges.jsonl#chal-8fac2350-355b-4c1f-b58b-e370731cfe57" as const;

/** เท่าที่ classifyLegacyRow ต้องใช้ ไม่มากกว่านี้ */
const ALLOWED_COLUMNS = ["event_code", "event_type", "status", "confidence", "material_text", "quantity", "destination"] as const;

export type ScanRow = Record<(typeof ALLOWED_COLUMNS)[number], unknown>;

export async function scanLegacyEvents(limit = 1000): Promise<
  { ok: true; rows: readonly ScanRow[] } | { ok: false; reason_code: string; reason: string }
> {
  const bounded = Math.min(Math.max(limit, 1), 5000);
  const sql =
    `select ${ALLOWED_COLUMNS.join(", ")} from public.business_events order by event_code desc limit ${bounded}`;

  const provider = new MacOsKeychainProvider();
  const cred = await provider.resolve({ service: KEYCHAIN_SERVICE, account: KEYCHAIN_ACCOUNT, kind: "oauth_token" });
  if (!cred.ok) return { ok: false, reason_code: `KEYCHAIN_${cred.code}`, reason: cred.reason };

  try {
    const res = await fetch(MANAGEMENT_QUERY_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${cred.secret}`, "Content-Type": "application/json" },
      // read_only ฝั่ง Postgres เป็นชั้นที่สอง — พิสูจน์แล้วว่าปฏิเสธการเขียนด้วย 25006
      body: JSON.stringify({ query: sql, read_only: true }),
    });
    const body = await res.text();
    if (res.status !== 200 && res.status !== 201) {
      return { ok: false, reason_code: `HTTP_${res.status}`, reason: body.slice(0, 300) };
    }
    const parsed = JSON.parse(body);
    return { ok: true, rows: Array.isArray(parsed) ? parsed : (parsed?.result ?? []) };
  } catch (e) {
    return { ok: false, reason_code: "TRANSPORT_FAILED", reason: (e as Error).message };
  }
}
