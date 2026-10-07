/**
 * หน้าที่: the public boundary of `permissions/network-auth-gate/`, per
 * CAPABILITY_FOLDER_LAW ข้อ 9.
 *
 * Output: `verifySharedSecret`, `evaluateBindPolicy`, `isLoopbackHost`.
 * Dependency ที่อนุญาต: ./policy.ts, ./types.ts.
 */
export { verifySharedSecret, evaluateBindPolicy, isLoopbackHost } from "./policy";
export type { BindPolicyDecision } from "./types";
