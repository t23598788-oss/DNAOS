/**
 * หน้าที่: the public boundary of `software/capability-registrar/` — the
 * only file another capability folder (e.g. `permissions/write-gate/`) may
 * import from, per `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md`
 * ข้อ 9. `./index.ts` stays reachable only through here.
 *
 * `getCapabilityIndex()` (2026-08-21, was a plain `CAPABILITY_INDEX`
 * const): lazy, memoized on first real call — see `./index.ts`'s own
 * header for the real module-load cycle this fixed. Merely importing
 * this contract.ts is now always safe regardless of caller/import order;
 * nothing runs until a caller actually invokes `getCapabilityIndex()`.
 *
 * Input: re-exports only.
 * Output: `getCapabilityIndex`, `findByCapabilityId`, `findByOwnerFolder`,
 * `searchOverlap`, plus `./types.ts`'s `CapabilityStatus`/`CapabilityMetadata`.
 * Dependency ที่อนุญาต: ./index.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never re-export any future discovery/writer internals
 * added to this folder — this stays read-only query surface only.
 */

export { getCapabilityIndex, findByCapabilityId, findByOwnerFolder, searchOverlap } from "./index";
export type { CapabilityMetadata, CapabilityStatus } from "./types";

/**
 * THE write-ownership index every Write Gate caller must use — composed once
 * in `./write-ownership-index.ts` from the registries that already exist.
 *
 * Exported here, and only here, so no caller merges registries itself. Two
 * callers composing their own index is how the gate ends up judging the same
 * path against different ownership, which is worse than the incomplete index
 * this replaces.
 *
 * `getCapabilityIndex` above stays exactly as it is: it is the ROUTING
 * projection and has other consumers. Write ownership is a different
 * question with stricter admission rules, and conflating them would let a
 * routable capability silently gain write permission.
 */
export { getWriteOwnershipIndex, inspectWriteOwnershipIndex } from "./write-ownership-index";
export type { WriteOwnershipEntry, ComposedIndex } from "./write-ownership-index";
