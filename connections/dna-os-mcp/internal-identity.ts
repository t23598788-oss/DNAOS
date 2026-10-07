/**
 * หน้าที่: ตัวตนของเครื่องสำหรับช่องทาง MCP ภายใน — พิสูจน์ว่า "ผู้เรียกถือกุญแจ
 * ของช่องทางนี้" ไม่ใช่พิสูจน์ว่าเป็นเจ้าของ
 *
 * Owner, 2026-09-05: internal client ต้องเรียกเครื่องมืออ่านได้โดยไม่ต้องใช้
 * session ของเจ้าของ เพราะ session มีอายุสั้นและผูกกับการยืนยันตัวตนของมนุษย์
 * การเอามาใช้เป็นกุญแจของโปรเซสจะทำให้สองเรื่องนี้ปนกัน
 *
 * ขอบเขตที่ตัวนี้ให้: เห็นและเรียกได้เฉพาะเครื่องมืออ่านสี่ตัว ห้ามมากกว่านั้น
 * มันไม่มีทางกลายเป็น Owner authority ได้เลยเพราะ ./export-policy.ts ตรวจ
 * VERIFIED_OWNER_SESSION แยกต่างหากสำหรับเครื่องมือที่เปลี่ยนสถานะระบบ
 *
 * ความจริงที่ต้องพูดตรง ๆ: บนเครื่องผู้ใช้เดียวที่ทุกอย่างรันเป็น tam สิ่งนี้
 * พิสูจน์ได้แค่ "ถือความลับ" (POSSESSION_BASED) ไม่ใช่ "เป็นโปรเซสของ DNA OS จริง"
 * การผูกกับ binary ที่ลงนามต้องใช้ Keychain ACL/code signing ซึ่งยังไม่ได้ทำ
 *
 * Input: ค่าจาก header ของ transport
 * Output: ผ่าน/ไม่ผ่าน — ไม่มีความลับออกจากฟังก์ชันใดเลย
 * Dependency ที่อนุญาต: credentials/registry/, credentials/macos-keychain/, node:crypto
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเขียนความลับลง source/registry/log/evidence
 * - ห้ามให้ค่านี้ผ่านด่าน VERIFIED_OWNER_SESSION
 * - ห้ามเทียบความลับด้วย === (ต้องเป็นการเทียบเวลาคงที่)
 */

import { execFileSync } from "node:child_process";
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { findApiCredential, registerApiCredential, setApiCredentialStatus } from "../../credentials/registry/api-credential-registry";

export const INTERNAL_CREDENTIAL_REF = "credential://dna-os/mcp/internal-transport";
const KEYCHAIN_SERVICE = "dna-os-mcp-internal-transport";
const KEYCHAIN_ACCOUNT = "dna-os";
export const INTERNAL_CREDENTIAL_HEADER = "x-dna-os-internal-credential";

/** อ่านความลับจาก Keychain — ค่าไม่เคยถูก return ออกนอกไฟล์นี้ */
function readSecret(): string | null {
  try {
    return String(execFileSync("/usr/bin/security",
      ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w"],
      { encoding: "utf8" })).trim();
  } catch { return null; }
}

/**
 * สร้างกุญแจใหม่และบันทึกตัวชี้ลงทะเบียน — เรียกโดยเจ้าของ/ตอนติดตั้งเท่านั้น
 * คืนค่าความลับ "ครั้งเดียว" ให้ผู้ติดตั้งเอาไปตั้งค่า client ไม่เก็บที่อื่น
 */
export async function provisionInternalIdentity(): Promise<{ ok: true; credential_ref: string; secret: string } | { ok: false; reason_code: string; detail: string }> {
  const secret = randomBytes(32).toString("base64url");
  try {
    const { registerOwnerApiCredential } = await import("../../credentials/macos-keychain/api-registration");
    await (registerOwnerApiCredential as (i: unknown) => Promise<unknown>)({
      requester_identity: "connections/dna-os-mcp/internal-identity.ts",
      credential_ref: INTERNAL_CREDENTIAL_REF, provider: "dna-os", account: "mcp-internal-transport",
      scope: ["mcp.internal_read"], service: KEYCHAIN_SERVICE, keychainAccount: KEYCHAIN_ACCOUNT, secret,
    });
  } catch (error) {
    return { ok: false, reason_code: "KEYCHAIN_WRITE_FAILED", detail: error instanceof Error ? error.message.slice(0, 160) : String(error) };
  }
  const now = new Date().toISOString();
  try {
    registerApiCredential({
      credential_ref: INTERNAL_CREDENTIAL_REF, provider: "dna-os", account: "mcp-internal-transport",
      scope: ["mcp.internal_read"], status: "ACTIVE", created_at: now, updated_at: now,
      resolver_kind: "macos_keychain", resolver_service: KEYCHAIN_SERVICE, resolver_account: KEYCHAIN_ACCOUNT,
    });
  } catch { /* แถวอาจมีอยู่แล้ว — ตัวชี้ไม่ใช่ความลับ */ }
  return { ok: true, credential_ref: INTERNAL_CREDENTIAL_REF, secret };
}

export function revokeInternalIdentity(): { ok: boolean; status: string } {
  try { const e = setApiCredentialStatus(INTERNAL_CREDENTIAL_REF, "REVOKED"); return { ok: true, status: e.status }; }
  catch { return { ok: false, status: "NOT_FOUND" }; }
}

export function reinstateInternalIdentity(): { ok: boolean; status: string } {
  try { const e = setApiCredentialStatus(INTERNAL_CREDENTIAL_REF, "ACTIVE"); return { ok: true, status: e.status }; }
  catch { return { ok: false, status: "NOT_FOUND" }; }
}

/**
 * ตรวจค่าที่มากับ header — เทียบแบบเวลาคงที่ และต้องผ่านสถานะในทะเบียนด้วย
 * เพิกถอนแล้วต้องตกทันทีแม้ความลับใน Keychain จะยังอยู่
 */
export function verifyInternalCredential(presented: string | null | undefined): { ok: boolean; reason_code: string } {
  if (typeof presented !== "string" || presented === "") return { ok: false, reason_code: "NO_INTERNAL_CREDENTIAL" };
  const entry = findApiCredential(INTERNAL_CREDENTIAL_REF);
  if (!entry) return { ok: false, reason_code: "INTERNAL_CREDENTIAL_NOT_REGISTERED" };
  if (entry.status !== "ACTIVE") return { ok: false, reason_code: `INTERNAL_CREDENTIAL_${entry.status}` };
  const secret = readSecret();
  if (secret === null) return { ok: false, reason_code: "INTERNAL_CREDENTIAL_UNREADABLE" };
  // เทียบ digest ความยาวคงที่ เพื่อไม่ให้ความยาวของค่าที่ส่งมารั่วผ่านเวลา
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b) ? { ok: true, reason_code: "INTERNAL_DNA_OS" } : { ok: false, reason_code: "INTERNAL_CREDENTIAL_MISMATCH" };
}
