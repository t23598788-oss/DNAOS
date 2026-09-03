/**
 * หน้าที่: ขอบเขตสาธารณะของ `control/computer-use-authority/` — ไฟล์เดียวที่
 * capability อื่น import ได้
 *
 * Output: grant/validate/revoke + isDnaOsExecutor + types + store factory.
 * Dependency ที่อนุญาต: ./lease.ts, ./store.ts, ./types.ts.
 */

export { grantAuthority, validateAuthority, revokeAuthority, isDnaOsExecutor } from "./lease";
export type { LeaseDeps } from "./lease";
export { levelOf, isSecurityLevel, requiresExplicitHighRisk, OPERATION_LEVEL } from "./levels";
export type { RiskLevel } from "./levels";
export { createAuthorityStore, findLease, upsertLease, listLeases } from "./store";
export type { AuthorityStore } from "./store";
export type {
  ComputerUseOperation,
  AuthorityState,
  ComputerUseAuthorityLease,
  GrantAuthorityInput,
  GrantAuthorityResult,
  ValidateAuthorityInput,
  ValidateAuthorityResult,
  RevokeAuthorityResult,
} from "./types";
