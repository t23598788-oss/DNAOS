/**
 * Situation Layer — Type Definitions
 *
 * Situation = Representation ของสถานการณ์ปัจจุบัน
 * Reasoning จะวิเคราะห์จาก Situation ไม่ใช่จากข้อความดิบ
 */

// ═══════════════════════════════════════
// ENTITIES — สิ่งที่อยู่ในสถานการณ์
// ═══════════════════════════════════════

export interface Entity {
  id: string;
  type: EntityType;
  name: string;
  attributes: Record<string, unknown>;
  source: "user_input" | "session" | "database" | "inferred";
  confidence: number;
}

export type EntityType =
  | "customer"
  | "partner"
  | "vehicle"
  | "driver"
  | "material"
  | "document"
  | "job"
  | "debt"
  | "payment"
  | "location"
  | "amount"
  | "quantity"
  | "date";

// ═══════════════════════════════════════
// EVENTS — สิ่งที่เกิดขึ้น/กำลังเกิด
// ═══════════════════════════════════════

export interface SituationEvent {
  id: string;
  type: EventType;
  description: string;
  entities: string[];
  timestamp: string | null;
  status: "past" | "current" | "planned" | "overdue";
}

export type EventType =
  | "order_placed"
  | "delivery_scheduled"
  | "delivery_completed"
  | "payment_due"
  | "payment_received"
  | "payment_overdue"
  | "invoice_created"
  | "debt_notice_sent"
  | "vehicle_breakdown"
  | "price_changed"
  | "customer_inquiry"
  | "document_created";

// ═══════════════════════════════════════
// RESOURCE GRAPH — ความสัมพันธ์
// ═══════════════════════════════════════

export interface ResourceEdge {
  from: string;
  to: string;
  relation: RelationType;
}

export type RelationType =
  | "owns"
  | "owes"
  | "supplies"
  | "delivers_to"
  | "assigned_to"
  | "part_of"
  | "produced_by"
  | "located_at"
  | "refers_to";

export interface ResourceGraph {
  entities: Entity[];
  edges: ResourceEdge[];
}

// ═══════════════════════════════════════
// TIMELINE — ลำดับเวลา
// ═══════════════════════════════════════

export interface Timeline {
  events: SituationEvent[];
  current_time: string;
  next_deadline: SituationEvent | null;
  overdue_events: SituationEvent[];
}

// ═══════════════════════════════════════
// CONSTRAINTS — ข้อจำกัด
// ═══════════════════════════════════════

export interface Constraint {
  type: ConstraintType;
  description: string;
  entity_id: string | null;
  severity: "blocking" | "warning" | "info";
  resolution: string | null;
}

export type ConstraintType =
  | "vehicle_unavailable"
  | "insufficient_stock"
  | "over_credit_limit"
  | "overdue_payment"
  | "distance_too_far"
  | "capacity_exceeded"
  | "missing_data"
  | "pending_approval";

// ═══════════════════════════════════════
// WORLD STATE — สถานะของโลก
// ═══════════════════════════════════════

export interface WorldState {
  id: string;
  created_at: string;
  objective_id: string;

  primary_entity: Entity | null;
  entities: Entity[];
  graph: ResourceGraph;
  timeline: Timeline;
  constraints: Constraint[];

  context: {
    who: string | null;
    who_id: string | null;
    what: string | null;
    action: string | null;
    intent_type: string;
    session_history: string[];
  };

  data_completeness: number;
  has_blocking_constraints: boolean;
  suggested_focus: string;
}

// ═══════════════════════════════════════
// BUILDER INPUT/OUTPUT
// ═══════════════════════════════════════

export interface SituationInput {
  objective_id: string;
  intent_type: string;
  who: string | null;
  who_id: string | null;
  what: string | null;
  action: string | null;
  raw_input: string;
  session_history: string[];
  db_results: Record<string, unknown[]>;
}
