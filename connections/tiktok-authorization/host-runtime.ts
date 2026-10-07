/**
 * หน้าที่: ประกาศ host-runtime API ที่ capability นี้ใช้จริงเท่านั้น
 * (`process.env`, `fetch` POST+GET, `node:crypto` สำหรับ PKCE, `console`) —
 * โฟลเดอร์ self-contained แบบเดียวกับ
 * `connections/provider-authorization/host-runtime.ts` แต่เป็นการประกาศของ
 * ตัวเอง ไม่ import ข้ามโฟลเดอร์
 *
 * ต่างจากของ GitHub ตรงที่ TikTok ต้องใช้ทั้ง POST (แลก/เพิกถอน token) และ GET
 * (อ่านข้อมูลผู้ใช้เพื่อยืนยันตัวตน) จึงมีทั้ง `hostFetchPost` และ `hostFetchGet`
 *
 * Input: none.
 * Output: `readEnvVar`, `hostFetchPost`, `hostFetchGet`, `sha256Hex`,
 *   `randomHex`, `hostLog`, `hostError`, `HostResponse`, `HostFetchOutcome`.
 * Dependency ที่อนุญาต: node:crypto เท่านั้น.
 * สิ่งที่ห้ามแตะ: ห้าม log ค่า access_token/refresh_token/secret ใดๆ ผ่าน
 *   hostLog/hostError.
 */

import { createHash, randomBytes } from "node:crypto";

declare const process: { readonly env: Record<string, string | undefined> };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };
declare const AbortSignal: { timeout(milliseconds: number): unknown };
declare const fetch: (
  url: string,
  init: { method: "POST" | "GET"; headers: Record<string, string>; body?: string; signal: unknown }
) => Promise<HostResponse>;

export interface HostResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type HostFetchOutcome =
  | { kind: "response"; response: HostResponse }
  | { kind: "transport_error"; reason: string };

export function readEnvVar(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

export async function hostFetchPost(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMilliseconds: number
): Promise<HostFetchOutcome> {
  try {
    const response = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(timeoutMilliseconds) });
    return { kind: "response", response };
  } catch (error) {
    return { kind: "transport_error", reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function hostFetchGet(
  url: string,
  headers: Record<string, string>,
  timeoutMilliseconds: number
): Promise<HostFetchOutcome> {
  try {
    const response = await fetch(url, { method: "GET", headers, signal: AbortSignal.timeout(timeoutMilliseconds) });
    return { kind: "response", response };
  } catch (error) {
    return { kind: "transport_error", reason: error instanceof Error ? error.message : String(error) };
  }
}

/** SHA-256 → lowercase hex. ใช้กับ PKCE code_challenge ตาม spec desktop ของ TikTok. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** สุ่ม byte แล้วแทนเป็น hex — code_verifier และ state ที่คาดเดาไม่ได้ */
export function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

export function hostLog(...args: unknown[]): void {
  console.log(...args);
}

export function hostError(...args: unknown[]): void {
  console.error(...args);
}
