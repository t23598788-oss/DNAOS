/**
 * หน้าที่: ขอบเขตสาธารณะของ governance/connection-lock-guard/
 *
 * Input: re-export เท่านั้น
 * Output: verifyConnectionLocks, computeLockState, LOCKED_REGIONS, LOCKED_FILES
 * Dependency ที่อนุญาต: ./guard.ts
 * สิ่งที่ห้ามแตะ: ห้าม export อะไรที่เขียนหรือรีเบสไลน์ lock.json ได้
 */
export { verifyConnectionLocks, computeLockState, loadBaseline, LOCKED_REGIONS, LOCKED_FILES } from "./guard";
export type { LockVerdict, LockEntry, LockedRegion, LockBaseline } from "./guard";
