/**
 * R2 · นิยามขอบเขตแบบที่เครื่องอ่านได้และบังคับใช้ได้
 *
 * หลักที่ยึด: ค่าที่ไม่มีหลักฐานใน Registry ต้องคงเป็น UNRESOLVED
 * ห้ามเดา ห้ามอนุมาน และห้ามแปลง UNKNOWN ให้กลายเป็นข้อเท็จจริง
 *
 * ระเบียนนี้ *อ้างอิง* Registry ไม่ได้เขียนทับ — canonical registry ถูกสร้าง
 * โดยการรัน capability จริง ไม่ใช่การแก้ด้วยมือ
 */

/** ค่าที่ยังไม่มีหลักฐาน — ต่างจาก "ไม่มี" และต่างจาก "ว่าง" */
export const UNRESOLVED = "UNRESOLVED" as const;
export type Unresolved = typeof UNRESOLVED;
export type Resolved<T> = T | Unresolved;

export function isResolved<T>(v: Resolved<T>): v is T {
  return v !== UNRESOLVED;
}

export interface IdentityBoundary {
  readonly canonical_id: string;
  readonly canonical_name: string;
  readonly type: string;
  readonly owner: Resolved<string>;
}

export interface ExecutionBoundary {
  readonly execution_owner: Resolved<string>;
  readonly execution_environment: Resolved<string>;
  readonly entrypoint: Resolved<string>;
  readonly allowed_scope: Resolved<readonly string[]>;
  readonly forbidden_scope: Resolved<readonly string[]>;
  readonly side_effect_boundary: Resolved<readonly string[]>;
}

export interface InputContract {
  readonly accepted_input: Resolved<readonly string[]>;
  readonly required_fields: Resolved<readonly string[]>;
  readonly validation_requirements: Resolved<readonly string[]>;
  readonly caller_requirements: Resolved<readonly string[]>;
}

export interface OutputContract {
  readonly output_schema: Resolved<readonly string[]>;
  readonly result_return_path: Resolved<string>;
  readonly evidence_return_path: Resolved<string>;
  readonly error_contract: Resolved<readonly string[]>;
}

export interface DataBoundary {
  readonly readable: Resolved<readonly string[]>;
  readonly writable: Resolved<readonly string[]>;
  readonly prohibited: Resolved<readonly string[]>;
  readonly persistence: Resolved<readonly string[]>;
}

export interface AuthorityBoundary {
  readonly may_request: Resolved<readonly string[]>;
  readonly may_execute: Resolved<readonly string[]>;
  readonly required_permission: Resolved<readonly string[]>;
  readonly credential_reference: Resolved<readonly string[]>;
  readonly approval_requirement: Resolved<string>;
  readonly external_commit_authority: Resolved<string>;
}

export interface ResourceBoundary {
  readonly dependencies: Resolved<readonly string[]>;
  readonly availability_requirement: Resolved<string>;
  readonly service_requirement: Resolved<readonly string[]>;
  readonly concurrency_policy: Resolved<string>;
  readonly cost_policy: Resolved<string>;
}

export interface ExternalAccessBoundary {
  readonly network: Resolved<readonly string[]>;
  readonly filesystem: Resolved<readonly string[]>;
  readonly os_or_browser: Resolved<readonly string[]>;
  readonly external_service: Resolved<readonly string[]>;
  readonly explicitly_prohibited: Resolved<readonly string[]>;
}

export interface VerificationBoundary {
  readonly method: Resolved<string>;
  readonly required_evidence: Resolved<readonly string[]>;
  readonly last_verified_reference: Resolved<string>;
  readonly pass_fail_condition: Resolved<string>;
}

export interface BoundaryRecord {
  readonly identity: IdentityBoundary;
  readonly execution: ExecutionBoundary;
  readonly input: InputContract;
  readonly output: OutputContract;
  readonly data: DataBoundary;
  readonly authority: AuthorityBoundary;
  readonly resources: ResourceBoundary;
  readonly external_access: ExternalAccessBoundary;
  readonly verification: VerificationBoundary;
  /** ที่มาของทุกค่าที่ resolve ได้ — ฟิลด์ไหนมาจากหลักฐานอะไร */
  readonly derived_from: readonly string[];
  /** ฟิลด์ที่ยังไม่มีหลักฐาน — รายการนี้คือหนี้ที่ต้องปิดก่อน R2 จะจบ */
  readonly unresolved_fields: readonly string[];
}

/** ผลการตรวจต่อหนึ่งรายการ — fail closed เมื่อกำกวม */
export type BoundaryVerdict = "COMPLETE" | "PARTIAL" | "UNRESOLVED";
