/**
 * หน้าที่: the public boundary of `software/repository-registry/` — the
 * only file another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Input: re-exports only.
 * Output: `registerRepository`, `getRepository`, `listRepositories`,
 * `suspendRepository`, `buildRepositoryId`, `createRepositoryRegistryStore`,
 * plus every type a caller needs.
 * Dependency ที่อนุญาต: ./registry.ts, ./types.ts.
 */

export { registerRepository, getRepository, listRepositories, suspendRepository, buildRepositoryId, createRepositoryRegistryStore } from "./registry";
export type { RepositoryRegistryStore } from "./registry";
export type { RepositoryStatus, RepositoryRegistration, RegisterRepositoryInput } from "./types";
