/**
 * หน้าที่: the public boundary of `control/target-resolution/` — the
 * only file another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 * `./resolver.ts` stays reachable only through here.
 *
 * Input: re-exports only.
 * Output: `resolveTarget`, plus every type a caller needs.
 * Dependency ที่อนุญาต: ./resolver.ts, ./types.ts.
 */

export { resolveTarget } from "./resolver";
export type { TargetResolutionContext } from "./resolver";
export type { TargetResolutionStatus, TargetKind, ArtifactForTargetResolution, ResolvedTarget } from "./types";
