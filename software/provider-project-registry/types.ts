/**
 * หน้าที่: type ของ Provider Project Registry — **ตัวตนอย่างเดียว**
 *
 * ทะเบียนนี้ตอบคำถามเดียว: "provider project instance นี้คืออันไหน"
 * มันไม่ใช่ที่เก็บคอนฟิกของ provider ไม่ใช่ที่เก็บสถานะ ไม่ใช่ที่เก็บ deployment
 *
 * สิ่งที่ห้ามเพิ่มลงในไฟล์นี้เด็ดขาด:
 *   - secret/token ทุกชนิด (pointer ก็ไม่เก็บ — credential มีทะเบียนของตัวเองแล้ว)
 *   - สถานะที่เปลี่ยนได้ เช่น connected/healthy/deploying
 *   - deployment state, version ที่รันอยู่, จำนวน service
 * ของเหล่านั้นมีเจ้าของอยู่แล้ว การคัดลอกมาไว้ที่นี่คือการสร้างเจ้าของชุดที่สอง
 *
 * Input: none (type ล้วน).
 * Dependency ที่อนุญาต: none.
 */

/**
 * ตัวระบุที่ผู้ให้บริการออกให้และตรวจสอบได้ เช่น
 *   railway  { project: "...", environment_id: "..." }
 *   supabase { project_ref: "..." }
 * เป็น map ทั่วไปโดยตั้งใจ — ห้ามทำ schema แยกรายผู้ให้บริการ
 */
export type ProviderIdentifiers = Readonly<Record<string, string>>;

export interface ProviderProjectRegistration {
  readonly provider_project_id: string;
  readonly provider_id: string;
  readonly identifiers: ProviderIdentifiers;
  /** ไฟล์/คำสั่งที่ตัวระบุเหล่านี้ถูกอ่านมาจริง — ไม่ใช่คำบรรยาย */
  readonly verified_by: readonly string[];
  readonly registered_at: string;
}

export interface RegisterProviderProjectInput {
  readonly provider_id: string;
  readonly identifiers: ProviderIdentifiers;
  readonly verified_by: readonly string[];
}

export type ProviderProjectStatus =
  | "REGISTERED"      // natural key ใหม่ หลักฐานครบ
  | "REUSED"          // มี identity นี้อยู่แล้ว คืนของเดิม ไม่เขียนซ้ำ
  | "DUPLICATE_EXACT" // natural key + identifiers ตรงกันทุกตัวอักษร
  | "CONFLICT"        // natural key เดียวกัน แต่ identifiers ต่างกัน — ต้องให้คนตัดสิน
  | "UNRESOLVED";     // ประกอบ natural key จากหลักฐานไม่ได้

export interface RegisterProviderProjectResult {
  readonly status: ProviderProjectStatus;
  readonly registration: ProviderProjectRegistration | null;
  readonly reason: string | null;
}
