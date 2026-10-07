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

/* ADDITIVE (Phase B, 2026-09-01) — ConnectionDeclaration อยู่ข้าง ๆ
   ConnectionRegistration ไม่ใช่ตัวแทน ทุก export ด้านบนยังทำงานเหมือนเดิม */
export {
  registerConnectionDeclaration, lookupConnectionDeclaration, listConnectionDeclarations,
  buildDeclarationId, validateConnectionDeclaration,
} from "./declaration-registry";
export type { RegisterDeclarationResult, DeclarationValidation, DeclarationRejectReason } from "./declaration-registry";
export type {
  ConnectionDeclaration, ConnectionDeclarationInput, DeclaredConnectionType,
  ConnectionDirection, ConnectionProtocol, DeclaredConnectionState, TargetResolution,
} from "../../contracts/connector/connection-declaration";

/* ADDITIVE (2026-09-01) — resolve-on-read ของ executor_capability_id
   อ่านอย่างเดียว ไม่เขียนกลับลง declaration */
export { resolveDeclarationExecutor } from "./executor-resolution";
export type { ResolvedExecutor, ExecutorSource } from "./executor-resolution";
