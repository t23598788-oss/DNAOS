/**
 * หน้าที่: type contracts for `governance/source-validation/`'s real
 * checker (the first source this folder has ever had — see ./README.md's
 * G-VAL-004, which reserved this exact job without ever building it).
 *
 * Input: none (pure type definitions).
 * Output: `BoundaryViolation`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never add a field letting a caller mark a violation
 * "waived"/"approved" — this checker only ever reports what a real
 * import statement resolves to; any policy decision about what to DO
 * with a violation belongs to the caller (e.g. `control/circuit-breaker/`),
 * never to this type.
 */

/**
 * One real import that crosses from one capability folder into another
 * capability folder's internal (non-`contract.ts`) file — the literal
 * text of `../../governance/architecture-rules/CAPABILITY_FOLDER_LAW.md`
 * ข้อ 9: "ห้าม import ตรงเข้าไฟล์ implementation ภายในของอีก capability
 * folder เด็ดขาด".
 */
export interface BoundaryViolation {
  /** Repo-relative path of the file containing the offending import. */
  from_file: string;
  /** Top-two-path-segment capability folder `from_file` belongs to, e.g. "control/command-router". */
  from_capability: string;
  /** Repo-relative path of the file the import actually resolves to. */
  to_file: string;
  /** Top-two-path-segment capability folder `to_file` belongs to. */
  to_capability: string;
  /** The raw import specifier as written in source, e.g. "../../connections/os-ui/work-order". */
  import_specifier: string;
}
