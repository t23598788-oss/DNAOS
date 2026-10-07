/**
 * หน้าที่: ลงทะเบียน "การอ้างถึง" credential ที่มีอยู่แล้ว โดยไม่สร้าง secret ใหม่
 *
 * Owner, 2026-09-05 ข้อ 2: ถ้ามีเส้นทางยืนยันตัวตนอยู่แล้วให้ REUSE ห้ามสร้างซ้ำ
 * Supabase CLI ของเจ้าของยืนยันไว้แล้วและเก็บ token ใน Keychain อยู่แล้ว งานนี้
 * จึงเป็นการ "ประกาศขอบเขต" ไม่ใช่การเขียน secret — ต่างจาก
 * registerOwnerApiCredential ที่รับ secret เข้ามาเขียน Keychain
 *
 * Input: challenge id ที่เจ้าของยืนยันด้วยตัวเองแล้ว
 * Output: แถวอ้างอิงใน credential registry
 * Dependency ที่อนุญาต: ./contract.ts control/owner-authentication/human-verification.ts
 * สิ่งที่ห้ามแตะ:
 * - ห้ามรับ secret เป็นพารามิเตอร์ ห้ามอ่าน secret ในไฟล์นี้
 * - ห้ามลงทะเบียนโดยไม่มี challenge ที่เจ้าของยืนยันจริง
 */

import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findChallenge } from "../../control/owner-authentication/human-verification";
import { CAPABILITY, CREDENTIAL_REF, KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE, PROJECT_REF, SCOPE } from "./contract";

const REGISTRY = join(process.cwd(), "credentials/registry/data/api-credential-references.jsonl");

export type RegisterResult =
  | { ok: true; credential_ref: string; already_present: boolean }
  | { ok: false; reason_code: string; detail: string };

export function registerSchemaReadReference(verifiedChallengeId: string): RegisterResult {
  const challenge = findChallenge(verifiedChallengeId);
  if (challenge === null) return { ok: false, reason_code: "CHALLENGE_NOT_FOUND", detail: "ไม่รู้จัก challenge นี้" };
  if (challenge.state !== "VERIFIED" && challenge.state !== "CONSUMED") {
    return { ok: false, reason_code: "CHALLENGE_NOT_VERIFIED", detail: `สถานะคือ ${challenge.state}` };
  }
  if (!challenge.purpose.includes(CREDENTIAL_REF)) {
    // การยืนยันของเจ้าของผูกกับวัตถุประสงค์ที่แสดงบนหน้าจอ ใช้ข้ามงานไม่ได้
    return { ok: false, reason_code: "PURPOSE_MISMATCH", detail: "challenge นี้ไม่ได้ยืนยันเพื่อ credential นี้" };
  }

  let existing = "";
  try { existing = readFileSync(REGISTRY, "utf-8"); } catch { existing = ""; }
  if (existing.includes(`"${CREDENTIAL_REF}"`)) {
    return { ok: true, credential_ref: CREDENTIAL_REF, already_present: true };
  }

  const row = {
    credential_ref: CREDENTIAL_REF,
    provider: "supabase",
    account: PROJECT_REF,
    capability: CAPABILITY,
    scope: [SCOPE],
    allowed_operations: ["SELECT_METADATA"],
    status: "ACTIVE",
    secret_storage: "macos-keychain",
    keychain_service: KEYCHAIN_SERVICE,
    keychain_account: KEYCHAIN_ACCOUNT,
    reused_existing_secret: true,
    registered_at: new Date().toISOString(),
    authorized_by: "owner-human-verification",
    authorization_evidence: `verification-challenges.jsonl#${challenge.challenge_id}`,
    verification_method_class: challenge.verification_method_class,
    enforcement: "connections/supabase-schema-read/guard.ts + Postgres read_only transaction",
  };
  appendFileSync(REGISTRY, `${JSON.stringify(row)}\n`, { encoding: "utf8" });
  return { ok: true, credential_ref: CREDENTIAL_REF, already_present: false };
}
