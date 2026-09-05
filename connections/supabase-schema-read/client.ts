/**
 * หน้าที่: เรียก Supabase Management API เพื่ออ่าน metadata อย่างเดียว
 *
 * ตัว secret ถูกอ่านจาก Keychain โดยโมดูลนี้เอง ไม่เคยผ่านมือ Agent
 * ไม่เคยถูก return ออกไป และไม่เคยถูกเขียนลง log/evidence
 *
 * Input: SQL metadata ที่ผ่าน ./guard.ts แล้ว
 * Output: แถวผลลัพธ์ หรือเหตุผลที่ไม่สำเร็จ
 * Dependency ที่อนุญาต: ./contract.ts ./guard.ts credentials/macos-keychain
 * สิ่งที่ห้ามแตะ:
 * - ห้าม return secret หรือส่วนใดของ secret ออกจากไฟล์นี้
 * - ห้ามเรียก endpoint อื่นนอกจาก MANAGEMENT_QUERY_ENDPOINT
 * - ห้ามส่ง read_only: false
 */

import { MacOsKeychainProvider } from "../../credentials/macos-keychain/provider";
import {
  KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE, MANAGEMENT_QUERY_ENDPOINT, MANAGEMENT_TYPES_ENDPOINT,
} from "./contract";
import { guardMetadataSql } from "./guard";

export type QueryResult =
  | { ok: true; rows: readonly Record<string, unknown>[] }
  | { ok: false; reason_code: string; reason: string };

type TokenResult =
  | { ok: true; token: string }
  | { ok: false; reason_code: string; reason: string };

async function resolveToken(): Promise<TokenResult> {
  const provider = new MacOsKeychainProvider();
  const res = await provider.resolve({ service: KEYCHAIN_SERVICE, account: KEYCHAIN_ACCOUNT, kind: "oauth_token" });
  if (!res.ok) return { ok: false, reason_code: `KEYCHAIN_${res.code}`, reason: res.reason };
  return { ok: true, token: res.secret };
}

/** ยิงคำสั่งเดียวแบบ read-only สองชั้น: guard ของเรา + read_only ฝั่ง Postgres */
async function post(sql: string, token: string): Promise<{ status: number; body: string }> {
  const res = await fetch(MANAGEMENT_QUERY_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: true }),
  });
  return { status: res.status, body: await res.text() };
}

export async function readMetadata(rawSql: string): Promise<QueryResult> {
  const guarded = guardMetadataSql(rawSql);
  if (!guarded.ok) return guarded;
  const cred = await resolveToken();
  if (!cred.ok) return { ok: false, reason_code: cred.reason_code, reason: cred.reason };

  let out: { status: number; body: string };
  try {
    out = await post(guarded.sql, cred.token);
  } catch (e) {
    return { ok: false, reason_code: "TRANSPORT_FAILED", reason: (e as Error).message };
  }
  if (out.status !== 200 && out.status !== 201) {
    return { ok: false, reason_code: `HTTP_${out.status}`, reason: out.body.slice(0, 400) };
  }
  try {
    const parsed = JSON.parse(out.body);
    return { ok: true, rows: Array.isArray(parsed) ? parsed : (parsed?.result ?? []) };
  } catch {
    return { ok: false, reason_code: "UNPARSEABLE_RESPONSE", reason: out.body.slice(0, 200) };
  }
}

/**
 * ดึงสัญญาชนิดข้อมูลที่ Supabase สร้างจาก live schema — GET ล้วน ไม่มี body
 * ผลลัพธ์คือคำอธิบายตาราง/คอลัมน์ ไม่ใช่ข้อมูลธุรกิจ
 */
export async function fetchLiveTypescriptTypes(): Promise<
  { ok: true; types: string } | { ok: false; reason_code: string; reason: string }
> {
  const cred = await resolveToken();
  if (!cred.ok) return { ok: false, reason_code: cred.reason_code, reason: cred.reason };
  try {
    const res = await fetch(MANAGEMENT_TYPES_ENDPOINT, {
      method: "GET",
      headers: { Authorization: `Bearer ${cred.token}` },
    });
    const body = await res.text();
    if (res.status !== 200) return { ok: false, reason_code: `HTTP_${res.status}`, reason: body.slice(0, 300) };
    try {
      const parsed = JSON.parse(body);
      return { ok: true, types: typeof parsed?.types === "string" ? parsed.types : body };
    } catch {
      return { ok: true, types: body };
    }
  } catch (e) {
    return { ok: false, reason_code: "TRANSPORT_FAILED", reason: (e as Error).message };
  }
}

/**
 * พิสูจน์ว่าเขียนไม่ได้จริง — ใช้ CREATE TEMP TABLE ซึ่งต่อให้ผ่านก็อยู่แค่ใน
 * session และไม่ทิ้งอะไรไว้ใน production ตัวมันผ่าน guard ไม่ได้อยู่แล้ว จึงเรียก
 * ตรงเพื่อทดสอบชั้นที่สอง (read_only ฝั่ง Postgres) โดยเฉพาะ
 */
export async function probeWriteDenial(): Promise<{ denied: boolean; status: number; detail: string }> {
  const cred = await resolveToken();
  if (!cred.ok) return { denied: false, status: 0, detail: `${cred.reason_code}: ${cred.reason}` };
  try {
    const out = await post("create temp table dna_os_write_probe (x int)", cred.token);
    return { denied: out.status !== 200 && out.status !== 201, status: out.status, detail: out.body.slice(0, 300) };
  } catch (e) {
    return { denied: false, status: 0, detail: (e as Error).message };
  }
}
