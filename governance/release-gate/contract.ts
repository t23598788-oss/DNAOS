/**
 * หน้าที่: the public boundary of `governance/release-gate/` — the only
 * file another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Input: re-exports only.
 * Output: `decideRelease`, plus every type a caller needs.
 * Dependency ที่อนุญาต: ./resolver.ts, ./types.ts.
 */

export { decideRelease } from "./resolver";
export type { ReleaseDecisionStatus, DependencyDeclaration, ReleaseAuthorityInput, ReleaseAuthorityResult } from "./types";
