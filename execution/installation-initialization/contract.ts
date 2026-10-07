/**
 * หน้าที่: ขอบเขตสาธารณะของ `execution/installation-initialization/` — ไฟล์เดียว
 * ที่ capability อื่นนำเข้าได้ ตาม CAPABILITY_FOLDER_LAW ข้อ 9
 *
 * Input: re-export เท่านั้น
 * Output: การอ่านสถานะและชนิดข้อมูลของผลลัพธ์; canonical create อยู่ใน
 * restricted composition surface แยกต่างหาก
 * Dependency ที่อนุญาต: ./store.ts, ./types.ts
 * สิ่งที่ห้ามแตะ: ห้าม export เส้นทางที่แก้ ลบ หรือเขียนทับระเบียนที่มีอยู่แล้ว
 */

export { readInstallationInitialization, initializationPath } from "./store";
export type { ReadOutcome, CreateOutcome, StoreReasonCode } from "./types";
export {
  createLocalInstallationCeremonyBoundary,
  computeLocalInstallationCeremonyDigest,
  enterLocalInstallationCeremony,
  validateLocalInstallationCeremonyBoundary,
  validateLocalInstallationCeremonyInvocation,
} from "./ceremony";
export type {
  AuthorizedInitializationPersistencePort,
  LocalInstallationCeremonyBoundaryV1,
  LocalInstallationCeremonyInvocationV1,
  LocalInstallationCeremonyResult,
  LocalInstallationCeremonyValidationResult,
} from "./ceremony";
