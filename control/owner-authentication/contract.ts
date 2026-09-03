/**
 * หน้าที่: ขอบเขตสาธารณะของ control/owner-authentication/
 * Output: authenticateOwner, validateOwnerSession, revokeOwnerSession,
 *   grantAuthorityAsOwner + types.
 * Dependency ที่อนุญาต: ./authenticate.ts, ./owner-grant.ts, ./types.ts.
 */
export { authenticateOwner, validateOwnerSession, revokeOwnerSession } from "./authenticate";
export type { OwnerAuthDeps } from "./authenticate";
export { grantAuthorityAsOwner } from "./owner-grant";
export type { OwnerGrantResult } from "./owner-grant";
export type {
  OwnerAuthMethod, OwnerSessionState, OwnerSession,
  AuthenticateOwnerInput, AuthenticateOwnerResult,
  ValidateOwnerSessionResult, RevokeOwnerSessionResult,
} from "./types";
