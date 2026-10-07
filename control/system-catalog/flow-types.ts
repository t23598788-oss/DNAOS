/**
 * หน้าที่: สัญญาของ runtime flow — บันทึกว่าระบบเดิม "ทำงานอย่างไรจริง"
 * ให้ DNA OS ตอบคำถามสถาปัตยกรรมได้โดยไม่ต้องเปิด source ทุกครั้ง
 *
 * Owner, 2026-09-05 ข้อ 18: Agent ห้ามประกาศ VERIFIED เอง — สถานะมาจาก
 * ./flow-verifier.ts ซึ่งตรวจว่าฟิลด์บังคับครบหรือไม่ ขาดข้อใดคือ PARTIAL
 *
 * ทุก step ต้องมี source_pointer ที่ชี้ไฟล์จริง เพราะ catalog นี้แทนการอ่าน
 * source ในการใช้งานปกติ แต่ต้องตรวจย้อนได้เสมอเมื่อจะแก้หรือสงสัย
 *
 * Input: none (นิยามชนิดล้วน)
 * Output: RuntimeFlow, FlowStep, ConnectorPort
 * Dependency ที่อนุญาต: none
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเติม step ที่ไม่ได้อ่านจาก source จริง
 * - ห้ามให้ flow เป็น VERIFIED โดยไม่ผ่าน verifier
 * - ห้ามรวม UNKNOWN เข้ากับ "ไม่มี"
 */

/**
 * ระดับความสมบูรณ์ของ flow — แยกสามชั้นตามที่ Owner กำหนด 2026-09-05
 *
 * STRUCTURALLY_COMPLETE = ฟิลด์ครบ แต่บางฟิลด์เชิงความหมายยังเป็น UNKNOWN
 * SEMANTICALLY_COMPLETE = ความหมาย resolve แล้ว แต่ schema ของ DB ยังไม่ยืนยัน
 * VERIFIED              = ครบทั้งสองชั้นและ schema ยืนยันแล้ว
 */
export type FlowStatus = "RUNTIME_VERIFIED" | "SCHEMA_VERIFIED" | "SEMANTICALLY_COMPLETE"
  | "STRUCTURALLY_COMPLETE" | "PARTIAL" | "UNKNOWN" | "INTERFACE_REQUIRED";

export interface ConnectorPort {
  readonly port_id: string;
  readonly direction: "IN" | "OUT";
  readonly protocol: "HTTPS_WEBHOOK" | "HTTPS_API" | "POSTGRES" | "EDGE_INVOKE" | "SDK" | "UNKNOWN";
  readonly schema_hint: string;
  readonly auth: string;
}

export interface FlowStep {
  readonly unit_id: string;
  readonly order: number;
  readonly description: string;
  readonly source_pointer: string;
  readonly input: string;
  readonly output: string;
  readonly data_read: readonly string[];
  readonly data_write: readonly string[];
  readonly external_call: readonly string[];
  readonly authority: string;
  readonly failure_path: string;
}

export interface RuntimeFlow {
  readonly flow_id: string;
  readonly title: string;
  readonly actor: string;
  readonly trigger: string;
  readonly entrypoint: string;
  readonly steps: readonly FlowStep[];
  readonly components: readonly string[];
  readonly data_reads: readonly string[];
  readonly data_writes: readonly string[];
  readonly external_calls: readonly string[];
  readonly authority: readonly string[];
  readonly output: string;
  readonly failure_paths: readonly string[];
  readonly ports: readonly ConnectorPort[];
  readonly evidence: readonly string[];
  /** ตั้งโดย verifier เท่านั้น — ค่าที่ผู้เขียน flow ใส่มาจะถูกคำนวณทับ */
  readonly status: FlowStatus;
  /**
   * ผลเทียบกับ live schema จริง — ตามข้อ 17 ห้ามใช้ migration แทนความจริงของ DB
   * MISMATCH = ตรวจแล้วและไม่ตรง ต่างจาก PENDING ที่ยังไม่ได้ตรวจ
   */
  readonly schema_verification: "PENDING" | "VERIFIED" | "MISMATCH";
  /**
   * FAILED = พิสูจน์แล้วว่า object ที่จำเป็นไม่มีใน live schema
   * UNKNOWN = ยังไม่ได้เทียบกับ live
   * ต่างจาก schema_verification ตรงที่ตัวนี้ตัดสินจาก "ที่จำเป็น" เท่านั้น
   */
  readonly schema_status?: "VERIFIED" | "FAILED" | "UNKNOWN";
  /**
   * NOT_ELIGIBLE = ต่อให้โค้ดถูก ก็รันไม่ผ่านเพราะ object ที่จำเป็นไม่มีจริง
   * แยกจาก runtime_verification ที่ถามว่า "รันแล้วถูกไหม"
   */
  readonly runtime_eligibility?: "ELIGIBLE" | "NOT_ELIGIBLE" | "UNKNOWN";
  /** ตารางที่ flow อ้างถึงแต่ไม่มีอยู่ใน live schema */
  readonly schema_missing_tables?: readonly string[];
  /**
   * object ที่ flow ทำงานต่อได้ถ้าไม่มี — ต้องประกาศชัดเจน ไม่ใช่ปล่อยให้ verifier เดา
   * ที่ไม่อยู่ในรายการนี้ถือว่าจำเป็นทั้งหมด
   */
  readonly optional_data_objects?: readonly string[];
  /** เส้นทางย่อยที่สถานะไม่เท่ากัน — ห้ามเหมารวมทั้ง flow ว่าเสีย */
  readonly sub_paths?: readonly FlowSubPath[];
  /** ต้องมีหลักฐานการรันจริงแยกต่างหาก — schema พิสูจน์แค่ว่ามีสัญญาอยู่ ไม่ใช่ว่าทำงานถูก */
  readonly runtime_verification?: "PENDING" | "VERIFIED";
}

export interface FlowSubPath {
  readonly sub_path_id: string;
  readonly description: string;
  readonly entrypoint: string;
  readonly required_objects: readonly string[];
  readonly missing_objects: readonly string[];
  readonly schema_status: "VERIFIED" | "FAILED" | "UNKNOWN";
  readonly runtime_eligibility: "ELIGIBLE" | "NOT_ELIGIBLE" | "UNKNOWN";
  readonly business_effect: string;
}
