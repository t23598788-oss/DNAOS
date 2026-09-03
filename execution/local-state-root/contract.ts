/**
 * หน้าที่: ขอบเขตสาธารณะของ `execution/local-state-root/` — ไฟล์เดียวที่
 * capability อื่นนำเข้าได้ ตาม CAPABILITY_FOLDER_LAW ข้อ 9
 *
 * Input: re-export เท่านั้น
 * Output: ตัว resolve path, ตัวชี้ตำแหน่ง, ชนิดข้อมูล และค่าคงที่สิทธิ์
 * Dependency ที่อนุญาต: ./resolver.ts, ./types.ts
 * สิ่งที่ห้ามแตะ: ห้าม export ฟังก์ชันที่สร้างไดเรกทอรี เขียนไฟล์ หรือ chmod
 * จาก capability นี้ — มันตอบได้เรื่องเดียวคือ "ที่ไหน" ไม่ใช่ "สร้างให้ด้วย"
 */

export { resolveLocalStateRoot, installationDirectoryOf, initializationFileOf, DNA_OS_STATE_ROOT_ENV } from "./resolver";
export { STATE_DIRECTORY_MODE, STATE_FILE_MODE } from "./types";
export type {
  LocalStateRootV1, ResolvedLocalStateRootV1, UnresolvedLocalStateRootV1,
  IneligibleLocalStateRootV1, LocalStateRootStatus, LocalStateRootOrigin,
  ResolveLocalStateRootInput,
} from "./types";
