/**
 * หน้าที่: the ONLY module outside this folder is allowed to import from —
 * the public contract of `control/entry-context/`. `resolver.ts` is
 * private implementation. Mirrors this repo's existing pattern (see
 * `../command-router/contract.ts`, `../../permissions/execution-policy/
 * contract.ts`).
 *
 * Input: re-exports only.
 * Output: `resolveEntryContext`, `EntryContextRequest`,
 * `EntryContextResolution`.
 * Dependency ที่อนุญาต: ./resolver.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: none beyond the general contract-file rule already
 * documented in every sibling contract.ts.
 *
 * NOT_YET_BUILT: no runtime caller yet — see ./tests/entry-context.test.ts.
 */

export { resolveEntryContext } from "./resolver";
export type { EntryContextRequest, EntryContextResolution } from "./types";
