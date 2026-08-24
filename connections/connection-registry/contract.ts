/**
 * หน้าที่: the public boundary of `connections/connection-registry/` —
 * the only file another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Input: re-exports only.
 * Output: `registerConnection`, `lookupConnection`, `listConnections`,
 * `updateConnectionStatus`, `attachCredential`, `buildConnectionId`,
 * `discoverGitRemote`, plus every type a caller needs.
 * Dependency ที่อนุญาต: ./registry.ts, ./git-discovery.ts, ./types.ts.
 */

export { registerConnection, lookupConnection, listConnections, updateConnectionStatus, attachCredential, buildConnectionId, createConnectionRegistryStore } from "./registry";
export type { ConnectionRegistryStore } from "./registry";
export { discoverGitRemote } from "./git-discovery";
export type { GitDiscoveryOutcome, GitDiscoveryFailureReason } from "./git-discovery";
export type { RegisterConnectionInput, ConnectionLookupQuery, GitRemoteDiscovery } from "./types";
