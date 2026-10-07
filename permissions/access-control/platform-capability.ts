/**
 * หน้าที่: enumerate exhaustively what the DNA OS Platform Owner may do —
 * the enforceable form of "Platform Owner != Data Owner." Anything not in
 * this list is NOT a platform-owner right, specifically including "read a
 * tenant's business data/documents/messages."
 *
 * Input: none (pure constant).
 * Output: `PlatformCapability`, `PLATFORM_OWNER_CAPABILITIES`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never add a capability here that implies reading tenant
 * business data by default — that path is break-glass.ts only, and only
 * with a reason + expiry.
 *
 * NOT_YET_BUILT: nothing checks against this list yet.
 */

export type PlatformCapability =
  | "view_tenant_metadata" // which tenant uses what service, health, storage/billing volume — never content
  | "manage_infrastructure" // deploy, connector registration, source code, policy
  | "break_glass_read"; // see break-glass.ts — never a standing right

export const PLATFORM_OWNER_CAPABILITIES: readonly PlatformCapability[] = [
  "view_tenant_metadata",
  "manage_infrastructure",
  "break_glass_read",
] as const;
