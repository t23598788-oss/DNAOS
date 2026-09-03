/**
 * หน้าที่: the public boundary of `governance/source-validation/` — the
 * only file another capability folder may import from, per
 * `../architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9 (the same rule
 * this folder's own checker enforces).
 *
 * Input: re-exports only.
 * Output: `checkImportBoundaries`, `BoundaryViolation`.
 * Dependency ที่อนุญาต: ./boundary-checker.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never re-export ./host-runtime.ts here — private implementation.
 */

export { checkImportBoundaries } from "./boundary-checker";
export { runCapabilityFolderLawGate } from "./folder-law-gate";
export type { BoundaryViolation } from "./types";
export type { FolderLawGateResult, FolderLawViolation, FolderLawRuleRow, FolderLawVerdict } from "./types";
