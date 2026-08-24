/**
 * หน้าที่: the public boundary of `connections/provider-authorization/` —
 * the only file another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Input: re-exports only.
 * Output: `beginAuthorization`, `getAuthorizationStatus`,
 * `completeAuthorization`, `revokeAuthorization`,
 * `buildGithubPluginStatus`, `runGithubBootstrapCheck`, plus every type a
 * caller needs.
 * Dependency ที่อนุญาต: ./lifecycle.ts, ./plugin-status.ts, ./bootstrap.ts, ./types.ts.
 */

export { beginAuthorization, getAuthorizationStatus, completeAuthorization, revokeAuthorization } from "./lifecycle";
export type { LifecycleDeps } from "./lifecycle";
export { buildGithubPluginStatus } from "./plugin-status";
export type { PluginStatusDeps } from "./plugin-status";
export { runGithubBootstrapCheck } from "./bootstrap";
export type {
  AuthorizationState,
  ProviderAuthorizationRecord,
  BeginAuthorizationInput,
  BeginAuthorizationResult,
  AuthorizationStatusResult,
  CompleteAuthorizationResult,
  RevokeAuthorizationResult,
  PluginStatusReadModel,
  BootstrapRequirement,
  BootstrapCheckResult,
} from "./types";
