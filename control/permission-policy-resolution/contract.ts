/**
 * หน้าที่: the public boundary of `control/permission-policy-resolution/` —
 * the only file another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 * `./resolver.ts` and `./policy-registry.ts` stay reachable only through here.
 *
 * Input: re-exports only.
 * Output: `resolvePolicy`, plus every type a caller needs.
 * Dependency ที่อนุญาต: ./resolver.ts, ./types.ts.
 */

export { resolvePolicy } from "./resolver";
export type { PolicyResolutionContext } from "./resolver";
export type { RequestedAction, PolicyDecision, PolicyResolutionInput, PolicyResult } from "./types";
