/**
 * หน้าที่: the public boundary of `software/repository-registry/` — the
 * only file another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Input: re-exports only.
 * Output: `registerRepository`, `getRepository`, `listRepositories`,
 * `suspendRepository`, `buildRepositoryId`, `createRepositoryRegistryStore`,
 * plus every type a caller needs.
 * Dependency ที่อนุญาต: ./registry.ts, ./types.ts, ./checkout-resolution.ts.
 */

export { registerRepository, getRepository, listRepositories, suspendRepository, rebindRepositoryCheckout, buildRepositoryId, createRepositoryRegistryStore } from "./registry";
export {
  resolveRepositoryCheckout,
  resolveControlPlaneCheckout,
  setCheckoutResolutionForTests,
  resolveGitDir,
} from "./checkout-resolution";
export type {
  CheckoutResolution,
  CheckoutResolutionFailureCode,
  CheckoutResolutionHost,
  CheckoutResolutionLookup,
} from "./checkout-resolution";
export type { RepositoryRegistryStore } from "./registry";
export type { RepositoryStatus, RepositoryRegistration, RegisterRepositoryInput } from "./types";

/* ADDITIVE (2026-09-01) — census classification: ทะเบียนนี้ปนกับ fixture ของเทสต์
   ตัวจำแนกอยู่ที่ ./registry.ts และไม่ลบข้อมูลใด */
export { classifyRepository, listOperationalRepositories, countRepositoriesByClassification,
  FIXTURE_OWNER_EXACT, FIXTURE_OWNER_PREFIXES } from "./registry";
export type { RepositoryClassification } from "./registry";
