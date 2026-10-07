/**
 * หน้าที่: สัญญาของทรัพยากรและนโยบายว่าใครเห็นข้อมูลอะไรได้
 *
 * Owner, 2026-09-05: "สถานะ unavailable ควรเปลี่ยนใน registry ไม่ใช่ไปแก้ router"
 * และ "provider ไม่มีวันได้สิทธิ์เพราะมันทำได้"
 *
 * ไฟล์นี้เติมของที่ยังขาด ไม่ได้แทนที่ control/assembly — capability, contract,
 * port และ availability ยังเป็นชนิดเดิมทั้งหมด ตัวที่เพิ่มจริงมีสามอย่าง:
 * นโยบายการเห็นข้อมูล · ที่มาของ availability · ต้นทุนกับตัวสำรอง
 *
 * Dependency ที่อนุญาต: control/assembly/types.ts (ใช้ชนิดเดิม ห้ามประกาศซ้ำ)
 * สิ่งที่ห้ามแตะ:
 * - ห้ามให้ค่าปริยายของนโยบายเป็นอนุญาต ต้องเป็นปฏิเสธเสมอ
 * - ห้ามให้ความสามารถของ provider แปลว่าได้รับสิทธิ์โดยอัตโนมัติ
 * - ห้ามให้ต้นทุนไปทับผลของสิทธิ์ นโยบาย หรือความเข้ากันของสัญญา
 */

import type { Availability } from "../assembly/types";

// ─── §5 ชนิดของข้อมูล — เท่าที่งานนี้ต้องใช้ ไม่สร้าง taxonomy ใหญ่เกิน ────────

export type DataClass =
  | "PUBLIC_DATA"
  | "BUSINESS_DOCUMENT"
  | "FINANCIAL_DOCUMENT"
  | "PAYMENT_EVIDENCE"
  | "FINANCIAL_DERIVED_DATA"
  | "CUSTOMER_MESSAGE"
  | "LOCATION_DATA"
  | "PERSONAL_DATA"
  | "CREDENTIAL"
  | "SECRET"
  | "CANONICAL_BUSINESS_STATE";

/** ชนิดที่ห้ามส่งออกนอกระบบเสมอ ไม่ว่านโยบายจะเขียนว่าอะไร */
export const NEVER_TRANSMITTABLE: readonly DataClass[] = ["CREDENTIAL", "SECRET"];

// ─── §3 DATA_ACCESS_POLICY_V1 ───────────────────────────────────────────────

export interface DataAccessPolicyV1 {
  readonly schema: "DATA_ACCESS_POLICY_V1";
  readonly policy_id: string;
  /** ผูกกับทรัพยากรตัวเดียว หรือกับกลุ่มทรัพยากรก็ได้ */
  readonly resource_id: string | null;
  readonly resource_class: string | null;

  readonly allowed_data_classes: readonly DataClass[];
  readonly denied_data_classes: readonly DataClass[];

  readonly allowed_fields: readonly string[];
  readonly denied_fields: readonly string[];

  readonly allowed_source_types: readonly string[];
  /** งานที่อนุญาตให้ใช้ข้อมูลนี้ทำ — นอกรายการถือว่าไม่อนุญาต */
  readonly purpose_constraints: readonly string[];

  readonly read_allowed: boolean;
  readonly write_allowed: boolean;
  readonly canonical_state_write_allowed: boolean;
  readonly external_transmission_allowed: boolean;

  readonly retention_policy: string;
  readonly redaction_policy: string;

  readonly authority_required: readonly string[];
  readonly evidence_required: boolean;
}

/**
 * §3 ค่าปริยายคือปฏิเสธ — ทรัพยากรที่ยังไม่มีนโยบายต้องใช้ตัวนี้
 * และตัวนี้ไม่อนุญาตอะไรเลย
 */
export const DEFAULT_DENY_POLICY: DataAccessPolicyV1 = {
  schema: "DATA_ACCESS_POLICY_V1",
  policy_id: "policy.default-deny",
  resource_id: null,
  resource_class: null,
  allowed_data_classes: [],
  denied_data_classes: [
    "PUBLIC_DATA", "BUSINESS_DOCUMENT", "FINANCIAL_DOCUMENT", "PAYMENT_EVIDENCE",
    "FINANCIAL_DERIVED_DATA", "CUSTOMER_MESSAGE", "LOCATION_DATA", "PERSONAL_DATA",
    "CREDENTIAL", "SECRET", "CANONICAL_BUSINESS_STATE",
  ],
  allowed_fields: [],
  denied_fields: [],
  allowed_source_types: [],
  purpose_constraints: [],
  read_allowed: false,
  write_allowed: false,
  canonical_state_write_allowed: false,
  external_transmission_allowed: false,
  retention_policy: "ห้ามเก็บ",
  redaction_policy: "ไม่ระบุ",
  authority_required: [],
  evidence_required: true,
};

// ─── §7 availability ที่มาจากสุขภาพจริง ─────────────────────────────────────

export type AvailabilityState =
  | "DECLARED_AVAILABLE" | "HEALTH_AVAILABLE" | "DEGRADED" | "UNAVAILABLE" | "UNKNOWN";

export type AvailabilitySource = "DECLARED" | "HEALTH_CHECK" | "SUBSCRIPTION" | "DEPENDENCY";

export interface HealthEvidence {
  readonly checked_at: string;
  readonly source: AvailabilitySource;
  readonly state: AvailabilityState;
  readonly detail: string;
  readonly evidence_ref: string | null;
}

// ─── §8 ต้นทุนและตัวสำรอง ───────────────────────────────────────────────────

export type CostClass = "FREE" | "PER_REQUEST" | "PER_HOUR" | "SUBSCRIPTION" | "UNKNOWN";

export interface CostPolicy {
  readonly cost_class: CostClass;
  readonly estimated_unit_cost: number | null;
  readonly currency: string;
  readonly billing_state: "ACTIVE" | "SUSPENDED" | "NO_BILLING" | "UNKNOWN";
  readonly budget_policy: string;
}

// ─── §4 ความสามารถของ provider แยกจากสิทธิ์ที่ DNA OS ให้ ────────────────────

/**
 * สองชั้นนี้ต้องไม่ปนกัน — adapter อ่านชั้นบนจาก provider ได้เอง
 * แต่ชั้นล่างมีแต่ DNA OS เท่านั้นที่เขียน
 */
export interface CapabilityGrant {
  readonly capability: string;
  readonly provider_supports: boolean;
  readonly dna_os_allows: boolean;
  readonly reason: string;
}

// ─── §2 RESOURCE_V1 ─────────────────────────────────────────────────────────

export interface ResourceV1 {
  readonly schema: "RESOURCE_V1";
  readonly resource_id: string;
  readonly resource_type: string;
  readonly name: string;
  readonly purpose: string;

  /** ชื่อ capability ชุดเดียวกับที่ control/assembly ใช้ ห้ามตั้งชื่อคนละระบบ */
  readonly capabilities: readonly CapabilityGrant[];

  /** อ้าง schema_id จาก control/assembly/data/data-contracts.json */
  readonly input_contracts: readonly string[];
  readonly output_contracts: readonly string[];

  readonly connection_method: string;
  readonly entrypoint: string | null;

  /** อ้างทะเบียน credential เดิม ห้ามเก็บ secret ที่นี่ */
  readonly credential_ref: string | null;

  readonly authority_owner: string;
  readonly permissions: readonly string[];

  readonly data_access_policy_ref: string;

  readonly availability: Availability;
  readonly availability_state: AvailabilityState;
  readonly availability_source: AvailabilitySource;
  readonly availability_reason: string | null;
  /** เหตุที่เจ้าของยืนยันเอง แยกจากหลักฐานทางเทคนิคเสมอ */
  readonly owner_asserted_cause: string | null;
  readonly technical_evidence: readonly string[];

  readonly health: HealthEvidence | null;
  readonly last_health_check: string | null;
  readonly last_verified: string | null;
  readonly evidence_refs: readonly string[];

  readonly billing_model: string;
  readonly cost_policy: CostPolicy;

  readonly fallback_group: string | null;
  readonly fallback_priority: number;

  readonly dependencies: readonly string[];
  readonly limitations: readonly string[];

  readonly supported_tasks: readonly string[];
  readonly unsupported_tasks: readonly string[];

  readonly service_plan: string | null;
  readonly subscription_state: "ACTIVE" | "INACTIVE" | "NONE" | "UNKNOWN";

  readonly source_pointer: string;
}

// ─── §6 ผลการตัดสินว่าใช้ทรัพยากรนี้ได้ไหม ──────────────────────────────────

export type EligibilityVerdict = "ELIGIBLE" | "INELIGIBLE" | "UNKNOWN";

export interface EligibilityCheck {
  readonly check: "CAPABILITY" | "CONTRACT" | "DATA_POLICY" | "AUTHORITY" | "AVAILABILITY" | "COST";
  readonly verdict: EligibilityVerdict;
  readonly detail: string;
}

export interface ResourceEligibility {
  readonly resource_id: string;
  readonly verdict: EligibilityVerdict;
  readonly checks: readonly EligibilityCheck[];
  readonly blocking: readonly string[];
}

/** สิ่งที่งานหนึ่งขอ — ใช้เป็นอินพุตของการตัดสิน */
export interface ResourceRequest {
  readonly capability: string;
  readonly data_classes: readonly DataClass[];
  readonly purpose: string;
  readonly required_output_contract: string | null;
  readonly requires_canonical_write: boolean;
  readonly granted_authority: readonly string[];
  readonly budget_ceiling: number | null;
}
