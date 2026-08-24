/**
 * หน้าที่: the public boundary of `control/repository-discovery/` — the
 * only file another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 * `./scanner.ts` and `./rules.ts` stay reachable only through here.
 *
 * Input: re-exports only.
 * Output: `runDiscovery`, plus every type a caller needs.
 * Dependency ที่อนุญาต: ./scanner.ts, ./types.ts.
 */

export { runDiscovery } from "./scanner";
export type { FileKind, DiscoveryRecord, DuplicateGroup, FileKindTotals, DiscoveryInventory } from "./types";
