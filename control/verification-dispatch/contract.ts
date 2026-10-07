/**
 * หน้าที่: ขอบเขตสาธารณะของ control/verification-dispatch/
 *
 * Input: re-export เท่านั้น
 * Output: dispatchVerification, selectVerifier และชนิดข้อมูลของทั้งสอง
 * Dependency ที่อนุญาต: ./dispatch.ts, ./selection.ts
 * สิ่งที่ห้ามแตะ: ห้าม export ทางที่ให้ผู้เรียกระบุ verifier เองได้
 */

export { dispatchVerification } from "./dispatch";
export type { DispatchInput, DispatchOutcome } from "./dispatch";
export { selectVerifier } from "./selection";
export type { VerifierSelection, ChangeClass } from "./selection";
