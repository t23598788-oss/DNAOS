/**
 * หน้าที่: ขอบเขตสาธารณะของ control/ui-verification-runner/
 *
 * Input: re-export เท่านั้น
 * Output: runVerification, PROFILES, ชนิดข้อมูลของผล
 * Dependency ที่อนุญาต: ./runner.ts, ./types.ts
 * สิ่งที่ห้ามแตะ: ห้าม export อะไรที่แก้ source ได้ — ตัวตรวจไม่ใช่ผู้แก้
 */

export { runVerification, PROFILES, VERIFICATIONS_FILE } from "./runner";
export type { VerificationRequest, VerificationResult, Check, CheckType, CheckStatus } from "./types";
