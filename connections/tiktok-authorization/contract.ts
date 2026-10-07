/**
 * หน้าที่: ขอบเขตสาธารณะของ `connections/tiktok-authorization/` — ไฟล์เดียวที่
 * capability folder อื่น import ได้ ตาม
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9
 *
 * Input: re-exports only.
 * Output: `beginAuthorization`, `getAuthorizationStatus`,
 *   `completeAuthorization`, `revokeAuthorization`, `buildTiktokPluginStatus`,
 *   `PRIMARY_CONNECTION_ID`, และทุก type ที่ caller ต้องใช้.
 * Dependency ที่อนุญาต: ./lifecycle.ts, ./plugin-status.ts, ./types.ts.
 */

export { beginAuthorization, getAuthorizationStatus, completeAuthorization, revokeAuthorization, PRIMARY_CONNECTION_ID } from "./lifecycle";
export type { TiktokLifecycleDeps } from "./lifecycle";
export { buildTiktokPluginStatus } from "./plugin-status";
export type {
  TiktokAuthorizationState,
  TiktokAuthorizationRecord,
  BeginTiktokAuthorizationInput,
  BeginTiktokAuthorizationResult,
  CompleteTiktokAuthorizationInput,
  CompleteTiktokAuthorizationResult,
  RevokeTiktokAuthorizationResult,
  TiktokAuthorizationStatusResult,
  TiktokPluginStatusReadModel,
} from "./types";
