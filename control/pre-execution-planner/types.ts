/**
 * หน้าที่: สัญญาของ "แผนก่อนลงมือ" — สิ่งที่ DNA OS ต้องรู้ก่อนจะส่งงานให้ใคร
 * (Owner, BUILD_OWNER_PREEXECUTION_PLANNER).
 *
 * หลักการเดียวที่ทั้งไฟล์นี้ยึด: **Agent ไม่ใช่ขั้นที่หนึ่ง** ขั้นที่หนึ่งคือการรู้ว่า
 * งานนี้เกี่ยวกับอะไร ต้องดูอะไรก่อน และความสามารถอะไรที่จำเป็น — เมื่อรู้ครบแล้ว
 * ค่อยเลือกทรัพยากร และเรียกก็ต่อเมื่อถึงขั้นที่จำเป็นจริง
 *
 * `icon_key` เป็น metadata สำหรับการแสดงผลล้วน ๆ ไม่มีโค้ดใดตัดสินเส้นทางจากมัน
 * และการเลือกทรัพยากรไม่เคยอ่านค่านี้เลย
 *
 * Input: none (นิยามชนิดล้วน).
 * Output: `PreExecutionPlan`, `PlanStep`, `StepStatus`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: ห้ามใส่ชื่อ provider ลงในตรรกะการวางแผน, ห้ามสร้าง step ที่
 * ไม่มีเหตุการณ์จริงรองรับ (ห้ามมี progress ปลอม).
 */

/** ชนิดของการกระทำ — ใช้เลือกไอคอนตอนแสดงผล ไม่ใช้ตัดสินเส้นทาง */
export type ActionKind =
  | "OWNER_REQUEST" | "SUBJECT_RESOLUTION" | "KNOWLEDGE_LOOKUP" | "REGISTRY_LOOKUP"
  | "SOURCE_LOCATION" | "FOLDER_OPEN" | "FILE_READ" | "SEARCH"
  | "CAPABILITY_PLAN" | "RESOURCE_RESOLUTION" | "RESOURCE_INVOCATION"
  | "TEST" | "BUILD" | "EVIDENCE" | "VERIFICATION" | "RESULT";

export type StepStatus = "PLANNED" | "RUNNING" | "DONE" | "BLOCKED" | "FAILED";

export interface PlanStep {
  step_id: string;
  parent_step_id: string | null;
  action: ActionKind;
  /** ข้อความภาษาคน — สิ่งที่ Owner อ่าน */
  headline: string;
  status: StepStatus;
  /** ไอคอนที่จะแสดง — มาจากชนิดการกระทำ หรือจาก metadata ของทรัพยากรที่ถูกเลือก */
  icon_key: string;
  started_at: string;
  ended_at: string | null;
  /** รายละเอียดเชิงเทคนิค ซ่อนไว้ใต้ปุ่ม ไม่แสดงเป็นค่าเริ่มต้น */
  detail: Readonly<Record<string, unknown>>;
  /** เหตุผลจริงเมื่อถูกปิดกั้น — ต้องบอกได้ว่าโซ่ขาดตรงไหน */
  blocked_reason: string | null;
}

export interface CapabilityPlanEntry {
  required_capability: string;
  why: string;
  /** resource ที่ทะเบียนบอกว่าให้ความสามารถนี้ได้ */
  candidate_resource_ids: readonly string[];
  selected_resource_id: string | null;
  selection_verdict: "ELIGIBLE" | "UNKNOWN" | "NOT_ELIGIBLE" | "NO_PROVIDER";
  reason: string;
}

export interface PreExecutionPlan {
  plan_id: string;
  command_id: string;
  owner_text: string;
  subject: string | null;
  intent: string | null;
  target_system: string | null;
  known_context: readonly string[];
  required_information: readonly string[];
  capability_plan: readonly CapabilityPlanEntry[];
  required_dependencies: readonly string[];
  source_locations: readonly string[];
  evidence_requirements: readonly string[];
  verification_requirements: readonly string[];
  allowed_side_effects: readonly string[];
  steps: readonly PlanStep[];
  /** true จนกว่าจะจบ — หน้าจอใช้ค่านี้ตัดสินว่ายังต้องตามต่อไหม */
  running: boolean;
  blocked_at_step_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * บริบทที่ประกอบให้ทรัพยากรตอนถึงคิวมันจริง ๆ (Owner, PHASE 5)
 * ทุกฟิลด์ต้องมาจากขั้นก่อนหน้าในแผน ไม่ใช่จากข้อความดิบของ Owner อย่างเดียว
 */
export interface PreparedExecutionContext {
  objective: string;
  target: string | null;
  known_state: readonly string[];
  relevant_system: string | null;
  relevant_modules: readonly string[];
  relevant_source_pointers: readonly string[];
  files_already_read: readonly string[];
  evidence_already_found: readonly string[];
  failures_already_observed: readonly string[];
  constraints: readonly string[];
  allowed_actions: readonly string[];
  expected_output: string;
  verification_requirements: readonly string[];
}
