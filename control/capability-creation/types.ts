/**
 * หน้าที่: type contracts for `control/capability-creation/` — กฎที่ทำให้
 * "เขียนโค้ดไว้ก่อน แล้วค่อยต่อทีหลัง" เป็นไปไม่ได้เชิงโครงสร้าง ไม่ใช่แค่
 * นโยบายที่ต้องมีคนจำ
 *
 * กฎเดียว (Owner, 2026-08-26): **การมี source code ไม่ทำให้สิ่งนั้นเป็น
 * capability** capability เกิดมาพร้อมขอบเขต input contract output contract
 * ตัวกระตุ้น ผู้บริโภคผล เส้นทางเรียกใช้ตอน runtime การลงทะเบียน และวิธีพิสูจน์
 * ถ้าตอบไม่ได้ = ยังไม่ได้เกิด
 *
 * Input: none (pure type definitions).
 * Output: `CapabilityCreationContract`, `CapabilityLifecycleState`,
 * `TriggerClass`, `CreationGateResult`, `PreWritePacket`, `MissingConnection`.
 * Dependency ที่อนุญาต: none — a leaf contract.
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเพิ่ม field ที่ยอมรับค่า "จะเติมทีหลัง" — field ที่ตอบไม่ได้ต้องเป็น
 *   `UNKNOWN` และ `UNKNOWN` คือการบล็อก ไม่ใช่คำเชิญให้ไปหาคำตอบเอง
 * - ห้ามให้ Agent เป็นผู้เลือกค่าใด ๆ ในนี้ — ทั้งหมดถูก resolve โดย DNA OS
 *   ก่อน Agent จะได้เห็น packet
 * - ห้ามเพิ่มสถานะ lifecycle ที่แปลว่า "เกือบใช้ได้" — มีแค่ OPERATIONAL
 *   กับสิ่งที่ยังไม่ใช่
 */

/** ค่าที่แปลว่า "ตอบไม่ได้" ห้ามถูกแทนด้วยการเดาที่ขั้นตอนใด */
export const UNKNOWN = "UNKNOWN" as const;

/**
 * ชนิดของสิ่งที่เรียก capability นี้ — ปิดชุด ห้ามมี "OTHER"
 * `MANUAL_AGENT_INVOCATION` ไม่อยู่ในรายการนี้โดยเจตนา: ถ้าทางเดียวที่มันจะถูก
 * เรียกคือมี Agent จำได้ว่าต้องเรียก แปลว่ามันยังไม่มี trigger
 */
export type TriggerClass =
  | "OWNER_COMMAND"
  | "SYSTEM_EVENT"
  | "RESOURCE_EVENT"
  | "INCIDENT"
  | "SCHEDULE"
  | "RUNTIME_STATE_CHANGE"
  | "NETWORK_STATE_CHANGE"
  | "VERIFICATION_RESULT"
  | "DEPENDENCY_AVAILABLE"
  | "PROVIDER_EVENT"
  | "FILE_OR_RESOURCE_CHANGE";

export const TRIGGER_CLASSES: readonly TriggerClass[] = [
  "OWNER_COMMAND", "SYSTEM_EVENT", "RESOURCE_EVENT", "INCIDENT", "SCHEDULE",
  "RUNTIME_STATE_CHANGE", "NETWORK_STATE_CHANGE", "VERIFICATION_RESULT",
  "DEPENDENCY_AVAILABLE", "PROVIDER_EVENT", "FILE_OR_RESOURCE_CHANGE",
];

/**
 * สถานะของ capability ตามลำดับเดียวที่เดินได้
 *
 * สองสถานะที่มีชื่อชัดเจนเพราะเคยถูกเรียกว่า "เสร็จแล้ว" มาก่อน:
 *   `IMPLEMENTED_NOT_REACHABLE`      มีโค้ด แต่ไม่มีอะไรเรียกถึงได้จริง
 *   `IMPLEMENTED_NOT_RUNTIME_PROVEN` มีเทสต์ผ่าน แต่ไม่เคยถูกเรียกจาก runtime จริง
 */
export type CapabilityLifecycleState =
  | "PROPOSED"
  | "RESOLVED"
  | "REGISTERED"
  | "INPUT_CONNECTED"
  | "OUTPUT_CONNECTED"
  | "ROUTABLE"
  | "INVOKABLE"
  | "RUNTIME_PROVEN"
  | "OPERATIONAL"
  | "IMPLEMENTED_NOT_REACHABLE"
  | "IMPLEMENTED_NOT_RUNTIME_PROVEN"
  | "BLOCKED";

/** ลำดับที่เดินได้จริง — ใช้ตรวจว่าไม่มีใครกระโดดข้าม */
export const LIFECYCLE_ORDER: readonly CapabilityLifecycleState[] = [
  "PROPOSED", "RESOLVED", "REGISTERED", "INPUT_CONNECTED", "OUTPUT_CONNECTED",
  "ROUTABLE", "INVOKABLE", "RUNTIME_PROVEN", "OPERATIONAL",
];

/**
 * สัญญาที่ capability ต้องมีครบ **ก่อน** จะมีใครได้รับอนุญาตให้เขียนไฟล์แรก
 * ทุก field เป็น string หรือ array ของ string เพื่อให้ตรวจ `UNKNOWN` ได้แบบ
 * deterministic โดยไม่ต้องรู้ความหมายของแต่ละ field
 */
export interface CapabilityCreationContract {
  // ---- IDENTITY ----
  capability_name: string;
  owner_domain: string;
  repository: string;
  capability_root: string;
  /** จาก Resource Graph ที่มีอยู่ ห้ามสร้างเลขใหม่ที่นี่ */
  resource_id: string;
  /** จาก Registry ที่มีอยู่ */
  capability_id: string;
  purpose: string;
  execution_owner: string;

  // ---- INPUT ----
  input_type: string;
  input_contract: readonly string[];
  /** ของจริงที่ส่ง input เข้ามา เช่น `control/command-router/router.ts#routeOwnerCommand` */
  input_source: string;
  trigger_type: TriggerClass | typeof UNKNOWN;
  trigger_owner: string;

  // ---- OUTPUT ----
  output_type: string;
  output_contract: readonly string[];
  /** ของจริงที่รับผลไปใช้ ไม่ใช่ไฟล์รายงานที่ไม่มีใครอ่าน */
  output_consumer: string;
  output_destination: string;

  // ---- RUNTIME ----
  runtime_type: string;
  /** service_id ใน `control/runtime-control#SERVICES` เมื่อมี runtime เป็นของตัวเอง */
  service_id: string;
  invocation_method: string;
  required_dependencies: readonly string[];
  credential_boundary: string;

  // ---- STATE ----
  work_id: string;
  persistent_state_owner: string;
  evidence_owner: string;

  // ---- VERIFICATION ----
  verification_commands: readonly string[];
  runtime_proof: string;
  completion_conditions: readonly string[];

  // ---- LIFECYCLE ----
  source_of_truth: string;
  temporary_or_persistent: "TEMPORARY" | "PERSISTENT" | typeof UNKNOWN;
  cleanup_owner: string;
  retention_status: string;
}

/** ชื่อ field ทุกตัวที่ห้ามเป็น UNKNOWN — ประกาศไว้ที่เดียว */
export const REQUIRED_CONTRACT_FIELDS: readonly (keyof CapabilityCreationContract)[] = [
  "capability_name", "owner_domain", "repository", "capability_root", "purpose", "execution_owner",
  "input_type", "input_source", "trigger_type", "trigger_owner",
  "output_type", "output_consumer", "output_destination",
  "runtime_type", "invocation_method", "credential_boundary",
  "work_id", "persistent_state_owner", "evidence_owner",
  "runtime_proof", "source_of_truth", "temporary_or_persistent", "cleanup_owner", "retention_status",
];

/** field ที่เป็น array และต้องไม่ว่าง */
export const REQUIRED_NONEMPTY_LISTS: readonly (keyof CapabilityCreationContract)[] = [
  "input_contract", "output_contract", "verification_commands", "completion_conditions",
];

/**
 * `resource_id`/`capability_id` ไม่อยู่ในรายการบังคับข้างบนโดยเจตนา:
 * ทั้งคู่ถูกมอบให้โดย Registry ตอน REGISTERED ซึ่งเกิด *หลัง* RESOLVED
 * การบังคับให้มีตั้งแต่ตอนเสนอ จะบังคับให้ใครสักคนแต่งเลขขึ้นมา ซึ่งแย่กว่า
 */
export const ASSIGNED_AT_REGISTRATION: readonly (keyof CapabilityCreationContract)[] = ["resource_id", "capability_id", "service_id"];

/** การเชื่อมต่อที่ยังขาด — บันทึกไว้เพื่อให้ event ที่มาทีหลังปลุกงานเดิมได้ */
export interface MissingConnection {
  /** อะไรขาด — เป็น "คำ" ที่ event เทียบเท่าได้ ไม่ใช่ประโยคที่ต้องตีความ */
  kind: "INPUT" | "OUTPUT" | "ROUTING" | "RUNTIME" | "REGISTRATION" | "VERIFICATION" | "CONTRACT_FIELD";
  detail: string;
  /**
   * dependency key ที่ถ้ามีของสิ่งนี้เกิดขึ้น งานนี้ควรถูกปลุก
   * รูปแบบเดียวกับ `control/work-continuation/` (namespaced key) เพื่อให้
   * evaluator ตัวเดียวกันใช้ได้ ไม่ต้องมีตัวที่สอง
   */
  blocked_on: string | null;
  required_input: string | null;
  required_resource: string | null;
  required_evidence: string | null;
  next_action: string;
}

export interface CreationGateResult {
  capability_name: string;
  state: CapabilityLifecycleState;
  /** ว่างเมื่อ OPERATIONAL เท่านั้น */
  missing: readonly MissingConnection[];
  /** สิ่งที่ตรวจแล้วผ่าน พร้อมหลักฐานว่าเช็คจากอะไร */
  satisfied: readonly { check: string; evidence: string }[];
  reason: string;
}

/**
 * สิ่งที่ Agent ได้รับ — ตัดสินใจเชิงสถาปัตยกรรมมาแล้วทั้งหมด
 * คำสั่งเดียวที่แนบไปคือ "implement only this bounded capability"
 */
export interface PreWritePacket {
  work_id: string;
  capability_root: string;
  allowed_write_scope: readonly string[];
  forbidden_write_scope: readonly string[];
  exact_files_allowed: readonly string[];
  input_contract: readonly string[];
  output_contract: readonly string[];
  trigger: string;
  consumer: string;
  components_to_reuse: readonly string[];
  forbidden_components: readonly string[];
  runtime_owner: string;
  verification_commands: readonly string[];
  registration_requirements: readonly string[];
  instruction: "Implement only this bounded capability.";
}
