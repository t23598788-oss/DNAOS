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

/**
 * ผลของการตรวจกฎหนึ่งข้อใน Governance Gate (`CAPABILITY_FOLDER_LAW.md` ข้อ 10)
 *
 * `rule_row` อ้างแถวในตารางของกฎตรง ๆ เพื่อให้ผู้อ่านตามกลับไปที่ข้อความจริงได้
 * โดยไม่ต้องเชื่อคำอธิบายในโค้ด — และเพื่อให้เห็นทันทีถ้ามีใครเพิ่มกฎที่ไม่ได้
 * อยู่ในเอกสาร
 */
export type FolderLawRuleRow =
  | "CAPABILITY_WITHOUT_OWN_FOLDER"
  | "SOURCE_FILE_OUTSIDE_CAPABILITY_BOUNDARY"
  | "DUPLICATE_OR_OVERLAPPING_CAPABILITY"
  | "CROSS_CAPABILITY_INTERNAL_IMPORT";

/** ผลตามกฎ ใช้คำเดียวกับตารางในเอกสาร ไม่แปลใหม่ */
export type FolderLawVerdict = "REJECT" | "BLOCK_AND_REVIEW";

export interface FolderLawViolation {
  readonly rule_row: FolderLawRuleRow;
  readonly verdict: FolderLawVerdict;
  /** สิ่งที่ถูกตรวจ — path ของไฟล์/โฟลเดอร์ หรือ capability_id */
  readonly subject: string;
  readonly capability_id: string | null;
  readonly resource_id: string | null;
  readonly source_location: string | null;
  /** ข้อเท็จจริงที่วัดได้ ไม่ใช่ความเห็น */
  readonly measured: string;
  readonly evidence_ref: string;
}

/**
 * ผลของด่านทั้งด่าน — อ่านด้วยเครื่องได้ทั้งก้อน
 * ไม่มีช่องสำหรับ "ผ่านเพราะดูแล้วโอเค" โดยเจตนา: `status` เป็นฟังก์ชันของ
 * `failed_count` เท่านั้น
 */
export interface FolderLawGateResult {
  readonly gate_id: string;
  readonly stage_id: string;
  readonly checked_at: string;
  readonly subject_count: number;
  readonly passed_count: number;
  readonly failed_count: number;
  readonly violations: readonly FolderLawViolation[];
  readonly evidence_refs: readonly string[];
  readonly status: "PASS" | "FAIL";
  /**
   * จำนวนสิ่งที่ถูกตรวจจริงต่อกฎแต่ละข้อ
   *
   * มีไว้เพื่อแยก "ตรวจแล้วไม่พบ" ออกจาก "ไม่ได้ตรวจเลย" — สองอย่างนี้ให้
   * failed_count เท่ากันคือศูนย์ และถ้าไม่มีตัวเลขนี้ ด่านที่พังจนไม่ตรวจอะไรเลย
   * จะรายงานว่า PASS ได้อย่างหน้าตาเฉย
   */
  readonly checked_per_rule: Readonly<Record<FolderLawRuleRow, number>>;
  /** กฎที่ตรวจจาก snapshot ไม่ได้ — ประกาศไว้ ไม่ใช่แกล้งว่าตรวจแล้ว */
  readonly not_snapshot_checkable: readonly string[];
}
