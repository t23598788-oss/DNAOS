/**
 * หน้าที่: ชนิดข้อมูลของ "ความผิดพลาดที่ระบบสังเกตเห็นเอง แล้วกลายเป็นงานที่ตามรอยได้"
 *
 * ── ไม่ใช่การแจ้งเตือน ──
 * ความผิดพลาดที่ทำอะไรต่อได้ ต้องมีตัวตนแบบเดียวกับคำสั่งของ Owner: event ->
 * command -> task -> work ถ้ามันเป็นแค่ข้อความบนจอ มันจะหายไปพร้อมกับการรีเฟรช
 * และไม่มีใครตามรอยได้ว่าใครแก้ แก้เมื่อไร แก้แล้วหรือยัง
 *
 * ── ห้ามแกล้งว่า Owner พิมพ์ ──
 * `origin_kind` แยกสองเลนออกจากกันที่ชนิดข้อมูล คำสั่งที่ระบบสร้างเองต้องอ่าน
 * ย้อนหลังแล้วรู้ทันทีว่าไม่ได้มาจากคน
 *
 * ── หลักฐานจริงต้องไม่ถูกแปลงเป็นร้อยแก้ว ──
 * `evidence` เก็บสิ่งที่วัดได้ตามที่วัดได้ ช่องที่ไม่มีคือ UNRESOLVED ไม่ใช่ค่าที่
 * AI เติมให้ — ระบบนี้เคยพิสูจน์มาแล้วว่าค่าที่แต่งขึ้นอ่านย้อนหลังแล้วแยกไม่ออก
 * จากค่าที่วัดจริง
 *
 * Input: `SystemErrorObservation`
 * Output: `OwnerConsoleItem`, `AutoDispatchDecision`, คำศัพท์ปิดทั้งหมด
 * Dependency ที่อนุญาต: none — สัญญาปลายทาง
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่มชนิดความผิดพลาดที่ทำลายได้เข้า `AUTO_DISPATCH_ELIGIBLE`
 * และห้ามให้ฟิลด์หลักฐานใดรับค่าที่ไม่ได้มาจากการสังเกตจริง
 */

export type OriginKind = "OWNER_COMMAND" | "SYSTEM_ERROR_COMMAND";

/** ชนิดความผิดพลาดที่ระบบรู้จัก — ชุดปิด การเพิ่มค่าต้องเห็นใน diff */
export type SystemErrorKind =
  | "TEST_FAILED"
  | "BUILD_FAILED"
  | "TYPECHECK_FAILED"
  | "AUTHORIZED_RUNTIME_OPERATION_FAILED"
  | "WORK_BLOCKED"
  | "RELATIONSHIP_UNRESOLVED"
  | "SOURCE_INTEGRATION_FAILED"
  | "VERIFICATION_FAILED"
  /* ── ต้องให้ Owner ตัดสิน ห้ามซ่อมอัตโนมัติ ── */
  | "SECURITY_DENIAL"
  | "UNAUTHORIZED_ACCESS_ATTEMPT"
  | "CREDENTIAL_CHANGE"
  | "COST_APPROVAL_REQUIRED"
  | "PRODUCTION_DELETION"
  | "PRODUCTION_DEPLOYMENT"
  | "OWNER_IDENTITY_CHANGE"
  | "POLICY_EXPANSION"
  | "PRIVILEGE_ESCALATION"
  | "AMBIGUOUS_DESTRUCTIVE_ACTION";

/**
 * ชนิดที่ให้ AI เข้าไปตรวจ/ซ่อมได้เองในโหมด BOOTSTRAP_OWNER_BUILD
 *
 * ทุกตัวในชุดนี้เป็นความผิดพลาดของ **การพัฒนา** ที่ผลลัพธ์ย้อนกลับได้ด้วย git
 * ไม่มีตัวใดแตะ credential, สิทธิ์, การเงิน, การลบ หรือการนำขึ้น production
 */
export const AUTO_DISPATCH_ELIGIBLE: readonly SystemErrorKind[] = [
  "TEST_FAILED", "BUILD_FAILED", "TYPECHECK_FAILED",
  "AUTHORIZED_RUNTIME_OPERATION_FAILED", "WORK_BLOCKED",
  "RELATIONSHIP_UNRESOLVED", "SOURCE_INTEGRATION_FAILED", "VERIFICATION_FAILED",
];

/**
 * ชนิดที่ห้ามซ่อมอัตโนมัติเด็ดขาด — ขึ้นจอในฐานะ OWNER_ATTENTION_REQUIRED
 *
 * ชุดนี้ไม่ใช่ "ส่วนที่เหลือ" แต่ถูกประกาศตรง ๆ เพื่อให้การเผลอย้ายค่าจากชุดนี้
 * ไปอีกชุดเป็นการกระทำที่เห็นได้ใน diff
 */
export const OWNER_ATTENTION_REQUIRED: readonly SystemErrorKind[] = [
  "SECURITY_DENIAL", "UNAUTHORIZED_ACCESS_ATTEMPT", "CREDENTIAL_CHANGE",
  "COST_APPROVAL_REQUIRED", "PRODUCTION_DELETION", "PRODUCTION_DEPLOYMENT",
  "OWNER_IDENTITY_CHANGE", "POLICY_EXPANSION", "PRIVILEGE_ESCALATION",
  "AMBIGUOUS_DESTRUCTIVE_ACTION",
];

export type DevelopmentAuthorityMode = "BOOTSTRAP_OWNER_BUILD" | "NORMAL";

/**
 * หลักฐานที่วัดได้จริง — ทุกช่องเป็น optional เพราะแต่ละแหล่งมีของไม่เท่ากัน
 * ช่องที่ไม่มี = UNRESOLVED ไม่ใช่ช่องที่รอให้ใครเติม
 */
export interface SystemErrorEvidence {
  readonly source_capability?: string;
  readonly source_service?: string;
  readonly source_process?: string;
  readonly status_code?: string;
  readonly exit_code?: number;
  readonly test_or_build_name?: string;
  readonly file_path?: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly error_message?: string;
  readonly repository_id?: string;
  readonly workspace_id?: string;
  readonly evidence_refs?: readonly string[];
}

export interface SystemErrorObservation {
  readonly error_kind: SystemErrorKind;
  /** ข้อความดิบตามที่เครื่องรายงาน ไม่ใช่คำอธิบายที่เขียนใหม่ */
  readonly raw_error_text: string;
  readonly observed_at: string;
  readonly evidence: SystemErrorEvidence;
  /** งานเดิมที่ล้ม ถ้าความผิดพลาดนี้เป็นของงานที่มีอยู่แล้ว */
  readonly parent_work_id?: string | null;
  readonly parent_command_id?: string | null;
  readonly parent_task_id?: string | null;
  /** event ต้นทางจริง ถ้ามาจากสายเหตุการณ์ที่มี id อยู่แล้ว */
  readonly source_event_id?: string | null;
  /** ความลึกของโซ่การซ่อม — งานซ่อมที่ล้มเองสร้างลูกได้จนถึงขอบเขตที่ประกาศไว้ */
  readonly repair_depth?: number;
}

export type AutoDispatchDecisionCode =
  | "ELIGIBLE"
  | "OWNER_ATTENTION_REQUIRED"
  | "NOT_BOOTSTRAP_MODE"
  | "REPAIR_DEPTH_EXCEEDED"
  | "DISPATCH_DISARMED";

export interface AutoDispatchDecision {
  readonly code: AutoDispatchDecisionCode;
  readonly detail: string;
  /** งานถูกส่งให้ worker จริงหรือยัง — แยกจาก "มีสิทธิ์ถูกส่ง" เสมอ */
  readonly dispatched: boolean;
  readonly worker_kind: string | null;
}

/** ขอบเขตความลึกของโซ่การซ่อม — ประกาศไว้ ไม่ใช่ค่าที่ซ่อนอยู่ในเงื่อนไข */
export const MAX_REPAIR_DEPTH = 2;

export interface OwnerConsoleItem {
  readonly origin_kind: OriginKind;
  readonly owner_visible: true;
  readonly origin_event_id: string | null;
  readonly command_id: string;
  readonly task_id: string | null;
  readonly work_id: string;
  readonly parent_work_id: string | null;
  readonly error_kind: SystemErrorKind | null;
  readonly raw_command_text: string;
  readonly status: string;
  readonly current_action: string;
  readonly evidence: SystemErrorEvidence | null;
  readonly auto_dispatch: AutoDispatchDecision | null;
  readonly recorded_at: string;
}

export type AdmitOutcome =
  | { readonly status: "ADMITTED"; readonly item: OwnerConsoleItem }
  | { readonly status: "DUPLICATE_SUPPRESSED"; readonly existing_event_id: string; readonly detail: string }
  | { readonly status: "REFUSED"; readonly reason_code: "REPAIR_DEPTH_EXCEEDED" | "CLAIM_CONFLICT"; readonly detail: string };
