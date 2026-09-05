/**
 * หน้าที่: แยกสิ่งที่ "สังเกตได้" ออกจากสิ่งที่ "เกิดขึ้นแล้ว" ตั้งแต่ชั้นสัญญา
 *
 * Owner, 2026-09-05: ปัญหาคือ input ทุกชนิดเข้าท่อเดียวแล้วถูกตีความเป็นงานขาย
 * เร็วเกินไป โครงนี้จึงบังคับให้ข้อความเริ่มต้นเป็น RAW_OBSERVATION ที่ยังไม่มี
 * โดเมนธุรกิจ แล้วค่อยผ่านการหาบริบท การจำแนก และตัวจัดเส้นทางที่กำหนดผลได้
 *
 * หลักฐานที่ทำให้ต้องแยก (2026-09-05):
 * ai-callback/index.ts:93 ส่งผลจากโมเดลเข้า buildEventFromExtraction ตรง ๆ
 * ซึ่ง insert business_events ทันที โดย ExtractedEvent มีแต่ฟิลด์ฝั่งการขาย
 * (material_text, quantity, destination, schedule_text) และฟิลด์ confidence
 * ที่มีอยู่ก็ไม่เคยถูกใช้ตัดสินอะไรเลย
 *
 * Dependency ที่อนุญาต: ไม่มี
 * สิ่งที่ห้ามแตะ:
 * - ห้ามให้ RAW_OBSERVATION มีฟิลด์ที่บอกโดเมนธุรกิจ
 * - ห้ามให้ผลการจำแนกเขียนสถานะใด ๆ
 * - ห้ามให้ตัวจัดเส้นทางมีค่าปริยายเป็นงานขาย
 */

// ─── §18 taxonomy ───────────────────────────────────────────────────────────

export type EventClass =
  | "OBSERVATION" | "COMMAND" | "DOMAIN_EVENT" | "QUERY"
  | "PROJECTION_EVENT" | "EXTERNAL_ACTION_RESULT";

export type BusinessDomain =
  | "SALES" | "DOCUMENT" | "FINANCE" | "ACCOUNTING" | "AUTHORIZATION"
  | "LOGISTICS" | "LOCATION" | "RESOURCE" | "SUPPORT" | "GENERAL_CONVERSATION";

// ─── §1 RAW_OBSERVATION ─────────────────────────────────────────────────────

/** ยังไม่มีโดเมนธุรกิจ และต้องไม่มี — นี่คือ "มีอะไรเข้ามา" ไม่ใช่ "แปลว่าอะไร" */
export interface RawObservationV1 {
  readonly schema: "RAW_OBSERVATION_V1";
  readonly event_class: "OBSERVATION";
  readonly observation_id: string;
  readonly channel: string;
  readonly sender_identity: string;
  readonly conversation_id: string;
  readonly timestamp: string;
  readonly payload_type: "text" | "image" | "file" | "location" | "audio" | "postback" | "system";
  /** ตัวชี้ไปยังของจริง ไม่ใช่เนื้อข้อมูล — catalog ต้องไม่ถือข้อมูลธุรกิจไว้เอง */
  readonly raw_payload_ref: string;
}

// ─── §2 CONTEXT_ENVELOPE ────────────────────────────────────────────────────

/** ขั้นนี้อ่านอย่างเดียว ห้ามเปลี่ยนสถานะธุรกิจใด ๆ */
export interface ContextEnvelopeV1 {
  readonly schema: "CONTEXT_ENVELOPE_V1";
  readonly observation_id: string;
  readonly person: string | null;
  readonly company_id: string | null;
  readonly role: string | null;
  readonly permissions: readonly string[];
  readonly conversation_state: string | null;
  readonly related_order_id: string | null;
  readonly related_document_id: string | null;
  readonly related_payment_id: string | null;
  readonly related_resource_id: string | null;
  readonly resolution_gaps: readonly string[];
  readonly read_only: true;
}

// ─── §3 CLASSIFICATION_RESULT ───────────────────────────────────────────────

export interface DomainCandidate {
  readonly domain: BusinessDomain;
  readonly confidence: number;
  readonly evidence: readonly string[];
}

/**
 * ผลจากตัวจำแนก (จะเป็นกฎหรือโมเดลก็ได้) — คืนได้หลายโดเมน
 * §13: มีสิทธิ์คืนได้แค่ข้อสังเกต ห้ามสร้างสถานะ ฟิลด์ทั้งหมดในนี้จึงเป็นข้อเสนอ
 */
export interface ClassificationResultV1 {
  readonly schema: "CLASSIFICATION_RESULT_V1";
  readonly event_class: "OBSERVATION";
  readonly observation_id: string;
  readonly domains: readonly DomainCandidate[];
  readonly candidate_intents: readonly { intent_id: string; confidence: number; evidence: readonly string[] }[];
  readonly candidate_data: Readonly<Record<string, unknown>>;
  readonly ambiguity: readonly string[];
  readonly classifier_type: "RULE" | "MODEL" | "HYBRID";
  /** ต้องเป็น 0 เสมอ — ตัวจำแนกเขียนสถานะไม่ได้ */
  readonly state_writes: 0;
}

// ─── §15 ROUTING_DECISION ───────────────────────────────────────────────────

export interface RoutingDecisionV1 {
  readonly schema: "ROUTING_DECISION_V1";
  readonly observation_id: string;
  readonly candidate_domains: readonly BusinessDomain[];
  readonly selected_domains: readonly BusinessDomain[];
  readonly candidate_intents: readonly string[];
  readonly resolved_command_ids: readonly string[];
  readonly rejected_domains: readonly { domain: BusinessDomain; reason: string }[];
  readonly reason: string;
  readonly evidence_refs: readonly string[];
  readonly resolver_type: "DETERMINISTIC_POLICY";
  readonly confidence: number;
  readonly requires_human_resolution: boolean;
  readonly outcome: "ROUTED" | "NEEDS_RESOLUTION" | "OBSERVATION_ONLY";
}

// ─── §4/§8 intent ───────────────────────────────────────────────────────────

export type IntentKind = "COMMAND" | "CLAIM" | "QUERY" | "CONVERSATION";

export interface IntentSpec {
  readonly intent_id: string;
  readonly kind: IntentKind;
  readonly domain: BusinessDomain;
  readonly description: string;
  /** command ที่ตัวจัดเส้นทางจะเลือก — null แปลว่าจบที่การบันทึกข้อสังเกต */
  readonly canonical_command: string | null;
  /** เหตุการณ์ที่จะเกิด "หลัง" ตัวจัดการที่กำหนดผลได้ยืนยันแล้วเท่านั้น */
  readonly emits_domain_event: string | null;
  readonly required_context: readonly string[];
  readonly min_confidence: number;
}

// ─── §5 BUSINESS_LANE ───────────────────────────────────────────────────────

export interface BusinessLaneV1 {
  readonly schema: "BUSINESS_LANE_V1";
  readonly lane_id: string;
  readonly domain: BusinessDomain;
  readonly accepted_intents: readonly string[];
  readonly required_context: readonly string[];
  readonly allowed_commands: readonly string[];
  readonly state_machine: string | null;
  readonly owned_data: readonly string[];
  readonly financial_effects: readonly string[];
  readonly output_events: readonly string[];
  /** lane ที่เขียนสถานะธุรกิจได้ต้องมีตัวจัดการที่กำหนดผลได้เสมอ */
  readonly deterministic_handler: string | null;
}

// ─── §16 การจัดชั้นใหม่ให้ของเดิม ───────────────────────────────────────────

export type RecordClassification =
  | "TRUE_DOMAIN_EVENT" | "RAW_OBSERVATION" | "CLASSIFICATION_RESULT"
  | "COMMAND" | "QUERY_RESULT" | "PROJECTION_UPDATE" | "MISCLASSIFIED_EVENT";
