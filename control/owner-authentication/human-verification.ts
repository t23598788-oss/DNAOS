/**
 * หน้าที่: ขอบเขตการยืนยันตัวตนของเจ้าของด้วยกลไก macOS จริง — สร้าง challenge
 * เรียก native helper แล้วออก session ได้เฉพาะเมื่อผ่านทั้งสองชั้น
 *
 * ทำไมต้องแยกจาก ./authenticate.ts: ของเดิมออก session จาก "ชื่อ console user
 * ตรงกับที่คาด" อย่างเดียว ซึ่งเป็นการเช็คการมีอยู่ ไม่ใช่การยืนยันว่าเป็นคนนั้น
 * ทุก process ที่รันด้วยสิทธิ์ของเจ้าของมินต์ session ได้เอง — รวมถึง Agent
 * ที่นี่จึงบังคับสองชั้น: presence (เงื่อนไขจำเป็น) + human verification (เงื่อนไขพอ)
 *
 * Agent มินต์ผลเองไม่ได้เพราะ `VERIFIED` เกิดจาก exit code และ JSON ของ helper
 * ที่ macOS เป็นผู้ตัดสิน ไม่มีทางเรียกฟังก์ชันใดในไฟล์นี้แล้วได้ session โดยที่
 * ไม่มีมนุษย์แตะเซ็นเซอร์หรือใส่รหัสผ่านเครื่อง
 *
 * Input: คำขอ challenge และ challenge_id
 * Output: OwnerVerificationChallenge, VerificationOutcome, TrustedOwnerSession
 * Dependency ที่อนุญาต: ./authenticate.ts (presence), node built-ins, native/owner-verify
 * สิ่งที่ห้ามแตะ:
 * - ห้ามออก session โดยไม่มี challenge ที่ VERIFIED และยังไม่ถูกใช้
 * - ห้ามให้ challenge ใช้ซ้ำ
 * - ห้ามถอยไปใช้ presence เป็น authentication เมื่อ helper ใช้ไม่ได้
 * - ห้ามบันทึกรหัสผ่าน/ข้อมูล biometric — helper ไม่คืนมาให้อยู่แล้ว
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, randomBytes } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
export const CHALLENGE_FILE: string = join(HERE, "data", "verification-challenges.jsonl");
const HELPER = join(HERE, "native", "owner-verify");

/** ระดับความเสี่ยงของสิ่งที่ session จะได้รับอนุญาตให้ทำ */
export type AuthorityClass =
  | "CLASS_0_READ" | "CLASS_1_NAVIGATION" | "CLASS_2_INPUT"
  | "CLASS_3_SECURITY_OR_EXTERNAL_CONFIG" | "CLASS_4_IRREVERSIBLE";

export type ChallengeState = "PENDING" | "VERIFIED" | "CONSUMED" | "FAILED" | "EXPIRED";

export interface OwnerVerificationChallenge {
  readonly challenge_id: string;
  readonly created_at: string;
  readonly expires_at: string;
  readonly expected_owner: string;
  readonly purpose: string;
  readonly requested_authority_class: AuthorityClass;
  readonly work_id: string | null;
  readonly task_id: string | null;
  readonly nonce: string;
  readonly state: ChallengeState;
  /** วิธีที่ macOS ใช้ — ระดับชั้นเท่านั้น ไม่ใช่รายละเอียด */
  readonly verification_method_class: string | null;
  readonly verified_at: string | null;
  readonly reason_code: string | null;
}

function record(row: OwnerVerificationChallenge): void {
  mkdirSync(dirname(CHALLENGE_FILE), { recursive: true });
  appendFileSync(CHALLENGE_FILE, `${JSON.stringify(row)}\n`, "utf-8");
}

/** แถวหลังชนะ — สถานะล่าสุดของ challenge นั้น */
export function findChallenge(challengeId: string): OwnerVerificationChallenge | null {
  if (!existsSync(CHALLENGE_FILE)) return null;
  let found: OwnerVerificationChallenge | null = null;
  for (const line of readFileSync(CHALLENGE_FILE, "utf-8").split("\n")) {
    if (line.trim() === "") continue;
    try { const r = JSON.parse(line) as OwnerVerificationChallenge; if (r.challenge_id === challengeId) found = r; }
    catch { /* แถวเสียข้ามไป */ }
  }
  return found;
}

/** ผู้ที่ล็อกอินหน้าจออยู่จริง — เงื่อนไขจำเป็น ไม่ใช่เงื่อนไขพอ */
export function ownerPresence(): string | null {
  try {
    const out = String(execFileSync("/usr/bin/stat", ["-f%Su", "/dev/console"], { encoding: "utf8" })).trim();
    return out.length > 0 ? out : null;
  } catch { return null; }
}

export function createChallenge(input: {
  expected_owner: string; purpose: string; requested_authority_class: AuthorityClass;
  work_id?: string | null; task_id?: string | null; ttl_seconds?: number;
}): { ok: true; challenge: OwnerVerificationChallenge } | { ok: false; reason_code: string; detail: string } {
  const presence = ownerPresence();
  if (presence === null) return { ok: false, reason_code: "NO_CONSOLE_SESSION", detail: "ไม่มี GUI session" };
  if (presence !== input.expected_owner) {
    return { ok: false, reason_code: "OWNER_PRESENCE_MISMATCH", detail: `console user "${presence}" ไม่ตรงกับ "${input.expected_owner}"` };
  }
  const ttl = Math.min(Math.max(input.ttl_seconds ?? 180, 30), 600);
  const now = Date.now();
  const challenge: OwnerVerificationChallenge = {
    challenge_id: `chal-${randomUUID()}`,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + ttl * 1000).toISOString(),
    expected_owner: input.expected_owner, purpose: input.purpose,
    requested_authority_class: input.requested_authority_class,
    work_id: input.work_id ?? null, task_id: input.task_id ?? null,
    nonce: randomBytes(16).toString("hex"), state: "PENDING",
    verification_method_class: null, verified_at: null, reason_code: null,
  };
  record(challenge);
  return { ok: true, challenge };
}

export interface VerificationOutcome {
  readonly challenge_id: string;
  readonly outcome: "VERIFIED" | "DENIED" | "CANCELLED" | "UNAVAILABLE" | "ERROR";
  readonly verification_method_class: string | null;
  readonly verified_at: string | null;
  readonly error_code: string | null;
  readonly detail: string | null;
}

/**
 * เรียกหน้าต่างของ macOS ให้เจ้าของยืนยัน — ฟังก์ชันนี้บล็อกจนกว่าจะมีคำตอบ
 * ผลลัพธ์มาจาก exit code และ JSON ของ helper ซึ่ง macOS เป็นผู้ตัดสิน
 */
export function runVerification(challengeId: string): VerificationOutcome {
  const challenge = findChallenge(challengeId);
  const fail = (code: string, detail: string): VerificationOutcome =>
    ({ challenge_id: challengeId, outcome: "DENIED", verification_method_class: null, verified_at: null, error_code: code, detail });

  if (challenge === null) return fail("CHALLENGE_NOT_FOUND", "ไม่รู้จัก challenge นี้");
  if (challenge.state !== "PENDING") return fail("CHALLENGE_NOT_PENDING", `สถานะปัจจุบันคือ ${challenge.state}`);
  if (new Date(challenge.expires_at).getTime() < Date.now()) {
    record({ ...challenge, state: "EXPIRED", reason_code: "CHALLENGE_EXPIRED" });
    return fail("CHALLENGE_EXPIRED", "หมดอายุก่อนยืนยัน");
  }
  if (!existsSync(HELPER)) {
    // ไม่มี helper = ยืนยันไม่ได้ ต้องไม่ถอยไปใช้ presence แทน
    record({ ...challenge, state: "FAILED", reason_code: "HELPER_NOT_BUILT" });
    return { ...fail("HELPER_NOT_BUILT", "ยังไม่ได้ build ตัวยืนยันของ macOS"), outcome: "UNAVAILABLE" };
  }

  let parsed: VerificationOutcome;
  try {
    const stdout = String(execFileSync(HELPER, [], {
      input: JSON.stringify({ challenge_id: challenge.challenge_id, reason: challenge.purpose,
        expected_owner: challenge.expected_owner, requested_authority_class: challenge.requested_authority_class,
        expires_at: challenge.expires_at }),
      encoding: "utf8", timeout: 130_000,
    }));
    parsed = JSON.parse(stdout) as VerificationOutcome;
  } catch (error) {
    const anyErr = error as { stdout?: string };
    try { parsed = JSON.parse(String(anyErr.stdout ?? "")) as VerificationOutcome; }
    catch { parsed = fail("HELPER_FAILED", error instanceof Error ? error.message.slice(0, 160) : String(error)); }
  }

  // ผลต้องเป็นของ challenge นี้เท่านั้น — กันการสลับผลจากที่อื่น
  if (parsed.challenge_id !== challenge.challenge_id) {
    record({ ...challenge, state: "FAILED", reason_code: "CHALLENGE_ID_MISMATCH" });
    return fail("CHALLENGE_ID_MISMATCH", "ผลลัพธ์ไม่ตรงกับ challenge ที่ขอ");
  }
  // เจ้าของหน้าจอต้องไม่เปลี่ยนระหว่างทาง
  if (ownerPresence() !== challenge.expected_owner) {
    record({ ...challenge, state: "FAILED", reason_code: "OWNER_PRESENCE_CHANGED" });
    return fail("OWNER_PRESENCE_CHANGED", "ผู้ใช้ที่ล็อกอินเปลี่ยนระหว่างการยืนยัน");
  }

  record(parsed.outcome === "VERIFIED"
    ? { ...challenge, state: "VERIFIED", verified_at: parsed.verified_at ?? new Date().toISOString(),
        verification_method_class: parsed.verification_method_class ?? "UNKNOWN", reason_code: null }
    : { ...challenge, state: "FAILED", reason_code: parsed.error_code ?? parsed.outcome });
  return parsed;
}

export interface TrustedOwnerSession {
  readonly owner_session_id: string;
  readonly owner_identity: string;
  readonly verified_challenge_id: string;
  readonly verification_method: string;
  readonly issued_at: string;
  readonly expires_at: string;
  readonly authority_ceiling: AuthorityClass;
  readonly status: "ACTIVE";
}

/**
 * ใช้ challenge ที่ VERIFIED แล้วหนึ่งครั้งเพื่อออก session — ใช้ซ้ำไม่ได้
 * นี่คือทางเดียวที่ trusted session เกิดได้ ไม่มีทางลัดจาก console user
 */
export function consumeChallengeForSession(challengeId: string, ttlSeconds = 3600):
  { ok: true; session: TrustedOwnerSession } | { ok: false; reason_code: string; detail: string } {
  const challenge = findChallenge(challengeId);
  if (challenge === null) return { ok: false, reason_code: "CHALLENGE_NOT_FOUND", detail: "ไม่รู้จัก challenge นี้" };
  if (challenge.state === "CONSUMED") return { ok: false, reason_code: "CHALLENGE_ALREADY_CONSUMED", detail: "ใช้ไปแล้ว ใช้ซ้ำไม่ได้" };
  if (challenge.state !== "VERIFIED") return { ok: false, reason_code: "CHALLENGE_NOT_VERIFIED", detail: `สถานะคือ ${challenge.state}` };
  if (new Date(challenge.expires_at).getTime() < Date.now()) {
    record({ ...challenge, state: "EXPIRED", reason_code: "CHALLENGE_EXPIRED" });
    return { ok: false, reason_code: "CHALLENGE_EXPIRED", detail: "หมดอายุก่อนถูกใช้" };
  }
  if (ownerPresence() !== challenge.expected_owner) {
    return { ok: false, reason_code: "OWNER_PRESENCE_MISMATCH", detail: "ผู้ใช้ที่ล็อกอินไม่ตรงกับเจ้าของ challenge" };
  }
  record({ ...challenge, state: "CONSUMED" });
  const now = Date.now();
  return { ok: true, session: {
    owner_session_id: `owner-session-${randomUUID()}`,
    owner_identity: challenge.expected_owner,
    verified_challenge_id: challenge.challenge_id,
    verification_method: challenge.verification_method_class ?? "UNKNOWN",
    issued_at: new Date(now).toISOString(),
    expires_at: new Date(now + ttlSeconds * 1000).toISOString(),
    authority_ceiling: challenge.requested_authority_class,
    status: "ACTIVE",
  } };
}
