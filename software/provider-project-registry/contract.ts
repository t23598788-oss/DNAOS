/**
 * หน้าที่: ขอบเขตสาธารณะของ `software/provider-project-registry/` —
 * ไฟล์เดียวที่โฟลเดอร์อื่นได้รับอนุญาตให้ import ตาม CAPABILITY_FOLDER_LAW ข้อ 9
 *
 * Output: re-exports เท่านั้น
 * Dependency ที่อนุญาต: ./registry.ts, ./types.ts
 */
export { registerProviderProject, getProviderProject, listProviderProjects, buildProviderProjectId } from "./registry";
export type {
  ProviderProjectRegistration, RegisterProviderProjectInput, RegisterProviderProjectResult,
  ProviderProjectStatus, ProviderIdentifiers,
} from "./types";
