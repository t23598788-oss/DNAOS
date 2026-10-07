/**
 * หน้าที่: รูปของ "ความรู้เชิงปฏิบัติการ" ที่แปะทับ resource ซึ่งทะเบียน canonical
 * เป็นเจ้าของตัวตนอยู่แล้ว (Owner, LOCK_GENERIC_RESOURCE_TOOL_REGISTRY_RULE ข้อ 1-3).
 *
 * นี่ไม่ใช่ทะเบียนที่สอง — แบบเดียวกับ `control/durable-meaning/` ทุกแถวถูกคีย์ด้วย
 * `resource_id` ที่ `software/registry-database/` ออกให้แล้ว และไฟล์ canonical
 * ไม่เคยถูกเปิดเขียนจากที่นี่ ถ้าวันหนึ่งชั้นนี้หายไป ตัวตนของ resource ยังอยู่ครบ
 *
 * ทำไมทุกข้อเท็จจริงต้องเป็น `Fact<T>` ไม่ใช่ค่าดิบ: "ไม่รู้" กับ "รู้ว่าไม่มี" เป็น
 * คนละสถานะ และการยุบสองอย่างนี้เข้าด้วยกันคือวิธีที่ทะเบียนเริ่มโกหก ค่า UNKNOWN
 * จึงเป็นสถานะที่ถูกกฎหมาย และทุกค่าที่รู้ต้องบอกได้ว่ารู้มาจากไหนและพิสูจน์ระดับไหน
 *
 * ทำไมไม่มีฟิลด์ชื่อ provider/model: ชื่อพวกนั้นเป็น metadata ของ resource ไม่ใช่
 * แกนของโครงสร้าง — มันอยู่ได้ใน `resource_name`/`entrypoint` เท่านั้น และไม่มี
 * โค้ดใดในชั้นนี้ที่ตัดสินอะไรจากมัน
 *
 * Input: none (นิยามชนิดล้วน).
 * Output: `ExecutionProfile`, `Fact`, `EligibilityDecision` และชนิดประกอบ.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่ม field ที่ตั้งชื่อตาม provider, ห้ามทำให้ UNKNOWN
 * กลายเป็นค่าปริยายที่แปลว่า "ใช้ได้", ห้ามให้ชั้นนี้ถือ secret.
 */

/** สถานะความรู้ของหนึ่งข้อเท็จจริง — สามอย่าง ไม่มีอย่างที่สี่ที่แปลว่า "น่าจะ" */
export type FactState = "KNOWN" | "UNKNOWN" | "NOT_APPLICABLE";

/**
 * ระดับการพิสูจน์ของค่าที่รู้
 * DECLARED = อ่านจากคำประกาศในระบบ (registry/registrar/descriptor)
 * MEASURED  = วัดจาก runtime จริง (evidence id ชี้ได้)
 * DERIVED   = คำนวณจากสองอย่างข้างบนแบบ deterministic ไม่ใช่การเดา
 */
export type VerificationState = "DECLARED" | "MEASURED" | "DERIVED" | "UNVERIFIED";

export interface Fact<T> {
  state: FactState;
  /** null เสมอเมื่อ state ไม่ใช่ KNOWN — ไม่มีการเดาค่าไว้ก่อน */
  value: T | null;
  /** ที่มาจริงของค่านี้: path ของไฟล์/โมดูล หรือ evidence id — ไม่ใช่คำบรรยาย */
  source: string | null;
  verification_state: VerificationState;
}

export const unknown = <T>(reason: string): Fact<T> =>
  ({ state: "UNKNOWN", value: null, source: reason, verification_state: "UNVERIFIED" });
export const known = <T>(value: T, source: string, verification_state: VerificationState = "DECLARED"): Fact<T> =>
  ({ state: "KNOWN", value, source, verification_state });
export const notApplicable = <T>(reason: string): Fact<T> =>
  ({ state: "NOT_APPLICABLE", value: null, source: reason, verification_state: "DERIVED" });

/**
 * ข้อเท็จจริงเจ็ดอย่างที่ต้องไม่ถูกยุบเป็นอันเดียว (Owner ข้อ 3)
 *
 * โปรแกรมหนึ่งตัวติดตั้งอยู่ (INSTALLED) และยืนยันตัวตนได้ (AUTH_AVAILABLE)
 * ในขณะที่สถานะการเรียกเก็บเงินยังไม่รู้ (BILLING UNKNOWN) — เป็นสภาพที่ถูกต้อง
 * และเกิดขึ้นจริงกับเครื่องมือในระบบนี้วันนี้
 */
export interface ResourceFactSheet {
  installed: Fact<boolean>;
  auth_available: Fact<boolean>;
  service_reachable: Fact<boolean>;
  subscription_valid: Fact<boolean>;
  billing_active: Fact<boolean>;
  healthy: Fact<boolean>;
  available: Fact<boolean>;
}

export interface ExecutionProfile {
  /** ตัวตนมาจากทะเบียน canonical เท่านั้น ชั้นนี้ไม่เคยออก id ของตัวเอง */
  resource_id: string;
  /** ชื่อที่มนุษย์อ่าน — metadata ล้วน ไม่มีโค้ดใดตัดสินจากค่านี้ */
  resource_name: Fact<string>;
  purpose: Fact<string>;

  entrypoint: Fact<string>;
  execution_boundary: Fact<string>;
  workspace_policy: Fact<string>;
  concurrency_limit: Fact<number>;

  auth_method: Fact<string>;
  authority_owner: Fact<string>;
  credential_ref: Fact<string>;
  permission_requirements: Fact<readonly string[]>;

  service_plan: Fact<string>;
  billing_status: Fact<string>;
  subscription_required: Fact<boolean>;
  cost_policy: Fact<string>;

  availability: Fact<string>;
  health: Fact<string>;
  unavailable_reason: Fact<string>;

  data_input_method: Fact<string>;
  data_output_method: Fact<string>;
  external_access_policy: Fact<string>;

  verification_method: Fact<string>;
  success_evidence: Fact<readonly string[]>;
  failure_evidence: Fact<readonly string[]>;
  last_verified_at: Fact<string>;

  dependencies: Fact<readonly string[]>;
  limitations: Fact<readonly string[]>;

  /** capability_id ที่ทะเบียนผูกไว้กับ resource นี้แล้ว — อ่านจาก resource_capabilities */
  capability_ids: readonly string[];
  facts: ResourceFactSheet;
  /**
   * ความรู้เชิงปฏิบัติการ (Owner, PHASE 2.5 ข้อ 2) — "ใช้ยังไง" ไม่ใช่แค่ "คืออะไร"
   *
   * แยกจากฟิลด์ด้านบนเพราะมันตอบคนละคำถาม: ด้านบนคือคุณสมบัติของทรัพยากร
   * ส่วนตรงนี้คือวิธีที่ DNA OS ต้องทำเพื่อจะใช้มันได้จริง — ถ้าไม่มีส่วนนี้
   * ระบบรู้ว่ามีเครื่องมืออยู่ แต่เรียกใช้ไม่เป็น
   */
  operability: ResourceOperability;
  recorded_at: string;
}

export interface ResourceOperability {
  how_to_invoke: Fact<string>;
  workspace_creation_method: Fact<string>;
  write_scope: Fact<string>;
  concurrency_mode: Fact<string>;
  concurrency_isolation_method: Fact<string>;
  health_check_method: Fact<string>;
  availability_check_method: Fact<string>;
  failure_detection_method: Fact<string>;
  result_evidence: Fact<string>;
}

export type EligibilityVerdict = "ELIGIBLE" | "NOT_ELIGIBLE" | "UNKNOWN";

export interface EligibilityCheck {
  check: string;
  verdict: EligibilityVerdict;
  reason_code: string;
  detail: string;
}

export interface EligibilityDecision {
  resource_id: string;
  verdict: EligibilityVerdict;
  checks: readonly EligibilityCheck[];
  /** เหตุผลแรกที่ทำให้ไม่ผ่าน หรือ null เมื่อผ่าน */
  blocking_reason: string | null;
}

/** สิ่งที่ผู้เรียกบอกว่างานนี้ต้องการ — ไม่มีชื่อ provider อยู่ในนี้เลย */
export interface EligibilityRequest {
  required_capability_ids: readonly string[];
  /** งานนี้ต้องใช้บริการที่มีค่าใช้จ่ายหรือไม่ — ถ้า false สถานะ billing ไม่เกี่ยว */
  requires_paid_service: boolean;
  needs_workspace: boolean;
}
